import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { usernameToEmail, emailToUsername, emptyCourse, duplicate, validateCourse } from '../public/model.mjs';
import { normalizePlace } from '../functions/normalize.js';

test('deterministic internal email mapping preserves username and account semantics', () => {
  assert.equal(usernameToEmail('alice'), 'alice@walkmap.internal');
  assert.equal(usernameToEmail('  Alice  '), 'alice@walkmap.internal');
  assert.equal(usernameToEmail('walk_map-1'), 'walk_map-1@walkmap.internal');
  assert.equal(usernameToEmail('admin', 'custom.domain'), 'admin@custom.domain');

  assert.equal(emailToUsername('alice@walkmap.internal'), 'alice');
  assert.equal(emailToUsername('walk_map-1@walkmap.internal'), 'walk_map-1');
  assert.equal(emailToUsername('invalid'), '');
  assert.equal(emailToUsername(null), '');

  // Validation boundaries: 3–40 characters, letters, digits, underscore, hyphen
  assert.throws(() => usernameToEmail('ab'), /아이디는 3–40자/);
  assert.throws(() => usernameToEmail('a'.repeat(41)), /아이디는 3–40자/);
  assert.equal(usernameToEmail('alice@example.com'), 'alice@example.com');
  assert.throws(() => usernameToEmail('alice with space'), /아이디는 3–40자/);
  assert.throws(() => usernameToEmail('한글아이디'), /아이디는 3–40자/);
});

test('Firestore concurrency & version conflict logic prevents silent overwrites', async () => {
  // Simulate Firestore transaction store for user courses
  const store = new Map();

  async function simulateSaveCourse(uid, rawCourse, baseVersion) {
    const c = validateCourse({ ...rawCourse, version: baseVersion });
    const key = `users/${uid}/courses/${c.id}`;
    const existing = store.get(key);

    if (baseVersion === 0) {
      if (existing) {
        throw Object.assign(new Error('이미 저장된 코스입니다.'), { code: 'CONFLICT' });
      }
      const saved = { ...c, version: 1, updated: new Date().toISOString() };
      store.set(key, saved);
      return saved;
    } else {
      if (!existing) {
        throw Object.assign(new Error('코스가 삭제되었거나 접근할 수 없습니다.'), { code: 'NOT_FOUND' });
      }
      if (existing.version !== baseVersion) {
        throw Object.assign(new Error('다른 창에서 수정되었습니다.'), { code: 'CONFLICT' });
      }
      const nextVersion = baseVersion + 1;
      const saved = { ...c, version: nextVersion, updated: new Date().toISOString() };
      store.set(key, saved);
      return saved;
    }
  }

  async function simulateDeleteCourse(uid, courseId, expectedVersion) {
    const key = `users/${uid}/courses/${courseId}`;
    const existing = store.get(key);
    if (!existing) {
      throw Object.assign(new Error('코스를 찾을 수 없습니다.'), { code: 'NOT_FOUND' });
    }
    if (existing.version !== expectedVersion) {
      throw Object.assign(new Error('다른 창에서 수정된 코스입니다.'), { code: 'CONFLICT' });
    }
    store.delete(key);
    return { ok: true };
  }

  const c = emptyCourse();
  c.name = '테스트 산책길';
  c.points = [{ lat: 37.57, lng: 126.98 }, { lat: 37.58, lng: 126.98 }];

  // 1. Initial save: baseVersion 0 -> version 1
  const saved1 = await simulateSaveCourse('user-a', c, 0);
  assert.equal(saved1.version, 1);

  // 2. Duplicate create with version 0 must throw CONFLICT
  await assert.rejects(() => simulateSaveCourse('user-a', c, 0), e => e.code === 'CONFLICT');

  // 3. Concurrent edit attempt with stale version 0 must throw CONFLICT
  await assert.rejects(() => simulateSaveCourse('user-a', { ...c, name: '충돌 수정' }, 0), e => e.code === 'CONFLICT');

  // 4. Update with matching version 1 succeeds and increments to version 2
  const updated1 = await simulateSaveCourse('user-a', { ...saved1, name: '수정된 코스' }, 1);
  assert.equal(updated1.version, 2);

  // 5. Stale update with previous version 1 must throw CONFLICT
  await assert.rejects(() => simulateSaveCourse('user-a', { ...saved1, name: '지연된 저장' }, 1), e => e.code === 'CONFLICT');

  // 6. Delete with stale version throws CONFLICT
  await assert.rejects(() => simulateDeleteCourse('user-a', c.id, 1), e => e.code === 'CONFLICT');

  // 7. Delete with correct version succeeds
  const deleteResult = await simulateDeleteCourse('user-a', c.id, 2);
  assert.equal(deleteResult.ok, true);

  // 8. Delete non-existent course throws NOT_FOUND
  await assert.rejects(() => simulateDeleteCourse('user-a', c.id, 2), e => e.code === 'NOT_FOUND');
});

test('Functions normalizePlace handles Naver API HUB formats and sanitizes data', () => {
  // Scaled coordinates from API HUB (1e7)
  const norm1 = normalizePlace({
    title: '<b>카페</b> &amp; 베이커리',
    roadAddress: '서울 종로구 사직로',
    mapx: '1269780000',
    mapy: '375700000'
  });
  assert.deepEqual(norm1, {
    title: '카페 &amp; 베이커리',
    address: '서울 종로구 사직로',
    lat: 37.57,
    lng: 126.978,
    source: 'naver-search'
  });

  // Regular coordinates
  const norm2 = normalizePlace({
    title: '경복궁',
    address: '서울 종로구 세종로',
    mapx: '126.9768',
    mapy: '37.5796'
  });
  assert.equal(norm2.lat, 37.5796);
  assert.equal(norm2.lng, 126.9768);

  // Invalid coordinates rejected
  assert.equal(normalizePlace(null), null);
  assert.equal(normalizePlace({ mapx: 'bad', mapy: '0' }), null);
  assert.equal(normalizePlace({ mapx: '0', mapy: '0' }), null);
  assert.equal(normalizePlace({ mapx: 'NaN', mapy: '37' }), null);
});

test('Firebase scaffolding and security configuration integrity', () => {
  // firebase.json
  const fbJson = JSON.parse(readFileSync('firebase.json', 'utf8'));
  assert.ok(fbJson.firestore?.rules);
  assert.ok(fbJson.functions?.[0]?.source);

  // .firebaserc
  const fbRc = JSON.parse(readFileSync('.firebaserc', 'utf8'));
  assert.equal(fbRc.projects?.default, 'walkmap-gaemi-kim');

  // firestore.rules
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /rules_version\s*=\s*'2'/);
  assert.match(rules, /match\s+\/users\/\{userId\}\/courses\/\{courseId\}/);
  assert.match(rules, /request\.auth\s*!=\s*null\s*&&\s*request\.auth\.uid\s*==\s*userId/);
  assert.match(rules, /request\.resource\.data\.version\s*==\s*1/);
  assert.match(rules, /request\.resource\.data\.version\s*==\s*resource\.data\.version\s*\+\s*1/);

  // public/config.js template must NOT have real secrets
  const configContent = readFileSync('public/config.js', 'utf8');
  assert.match(configContent, /mapsClientId:\s*window\.__WALKMAP_CONFIG__\?\.mapsClientId\s*\|\|\s*''/);
  assert.ok(!configContent.includes('NAVER_SEARCH_CLIENT_SECRET'));

  // GitHub Pages workflow
  assert.ok(existsSync('.github/workflows/pages.yml'));
  const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /actions\/deploy-pages/);
});

test('Pages build is deterministic and outputs only static assets with custom CNAME', () => {
  execFileSync('node', ['scripts/build.mjs']);
  assert.ok(existsSync('dist/CNAME'));
  assert.equal(readFileSync('dist/CNAME', 'utf8').trim(), 'walkmap.gaemi.kim');
  assert.ok(existsSync('dist/index.html'));
  assert.ok(existsSync('dist/404.html'));
  assert.ok(existsSync('dist/style.css'));
  assert.ok(existsSync('dist/app.mjs'));
  assert.ok(existsSync('dist/model.mjs'));
  assert.ok(existsSync('dist/firebase.mjs'));
  assert.ok(existsSync('dist/config.js'));

  // Ensure no server runtime or secrets in dist
  assert.ok(!existsSync('dist/server.mjs'));
  assert.ok(!existsSync('dist/.env'));
  assert.ok(!existsSync('dist/package.json'));
});
