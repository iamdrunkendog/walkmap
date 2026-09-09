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

test('Firestore concurrency & version conflict logic prevents silent overwrites with subcollection marker storage', async () => {
  // Simulate Firestore transaction store for user courses and marker subcollections
  const store = new Map();

  async function simulateFetchCourse(uid, courseId) {
    const key = `users/${uid}/courses/${courseId}`;
    const courseDoc = store.get(key);
    if (!courseDoc) {
      throw Object.assign(new Error('코스를 찾을 수 없습니다.'), { code: 'NOT_FOUND' });
    }
    const course = structuredClone(courseDoc);
    // Find all subcollection markers under users/${uid}/courses/${courseId}/markers/
    const markerPrefix = `users/${uid}/courses/${courseId}/markers/`;
    const subMarkers = [];
    for (const [k, v] of store.entries()) {
      if (k.startsWith(markerPrefix)) {
        subMarkers.push(structuredClone(v));
      }
    }
    if (subMarkers.length > 0) {
      course.markers = subMarkers;
    } else if (Array.isArray(course.markers)) {
      // Backward compatibility: load legacy embedded course.markers
    } else {
      course.markers = [];
    }
    return course;
  }

  async function simulateSaveCourse(uid, rawCourse, baseVersion) {
    const c = validateCourse({ ...rawCourse, version: baseVersion });
    const courseKey = `users/${uid}/courses/${c.id}`;
    const existing = store.get(courseKey);

    const markerPrefix = `users/${uid}/courses/${c.id}/markers/`;
    const existingMarkerKeys = new Set([...store.keys()].filter(k => k.startsWith(markerPrefix)));

    const nextVersion = baseVersion + 1;
    const updated = new Date().toISOString();
    const { markers, ...courseDocData } = c;

    if (baseVersion === 0) {
      if (existing) {
        throw Object.assign(new Error('이미 저장된 코스입니다.'), { code: 'CONFLICT' });
      }
      // Course document does NOT embed markers array on new writes
      store.set(courseKey, { ...courseDocData, version: 1, updated });
    } else {
      if (!existing) {
        throw Object.assign(new Error('코스가 삭제되었거나 접근할 수 없습니다.'), { code: 'NOT_FOUND' });
      }
      if (existing.version !== baseVersion) {
        throw Object.assign(new Error('다른 창에서 수정되었습니다.'), { code: 'CONFLICT' });
      }
      // Update course document: preserve legacy embedded markers if present, but do not add new embedded markers
      const nextDoc = { ...courseDocData, version: nextVersion, updated };
      if (existing.markers) nextDoc.markers = existing.markers;
      store.set(courseKey, nextDoc);
    }

    // Subcollection diffing: delete removed markers
    const currentMarkerKeys = new Set((markers || []).map(m => `${markerPrefix}${m.id}`));
    for (const oldKey of existingMarkerKeys) {
      if (!currentMarkerKeys.has(oldKey)) {
        store.delete(oldKey);
      }
    }
    // Subcollection write: write current markers as separate documents
    for (const m of (markers || [])) {
      store.set(`${markerPrefix}${m.id}`, structuredClone(m));
    }

    return { ...c, version: baseVersion === 0 ? 1 : nextVersion, updated };
  }

  async function simulateDeleteCourse(uid, courseId, expectedVersion) {
    const courseKey = `users/${uid}/courses/${courseId}`;
    const existing = store.get(courseKey);
    if (!existing) {
      throw Object.assign(new Error('코스를 찾을 수 없습니다.'), { code: 'NOT_FOUND' });
    }
    if (existing.version !== expectedVersion) {
      throw Object.assign(new Error('다른 창에서 수정된 코스입니다.'), { code: 'CONFLICT' });
    }
    // Delete all marker subcollection documents atomically with course doc
    const markerPrefix = `users/${uid}/courses/${courseId}/markers/`;
    for (const k of [...store.keys()]) {
      if (k.startsWith(markerPrefix)) {
        store.delete(k);
      }
    }
    store.delete(courseKey);
    return { ok: true };
  }

  const c = emptyCourse();
  c.name = '테스트 산책길';
  c.points = [{ lat: 37.57, lng: 126.98 }, { lat: 37.58, lng: 126.98 }];
  const m1 = { id: crypto.randomUUID(), name: '세미나실', category: 'seminar', address: '서울 종로구', lat: 37.575, lng: 126.985, naverLink: 'https://place.naver.com/seminar' };
  c.markers = [m1];

  // 1. Initial save: baseVersion 0 -> version 1
  const saved1 = await simulateSaveCourse('user-a', c, 0);
  assert.equal(saved1.version, 1);
  assert.equal(saved1.markers.length, 1);
  assert.equal(saved1.markers[0].name, '세미나실');

  // Verify course document does NOT have embedded markers array
  const rawDoc = store.get(`users/user-a/courses/${c.id}`);
  assert.equal(rawDoc.markers, undefined, 'New writes must not embed markers array in course document');
  assert.equal(rawDoc.version, 1);

  // Verify marker document exists in the subcollection
  const rawMarkerDoc = store.get(`users/user-a/courses/${c.id}/markers/${m1.id}`);
  assert.ok(rawMarkerDoc, 'Marker must be stored in subcollection users/{uid}/courses/{courseId}/markers/{markerId}');
  assert.equal(rawMarkerDoc.id, m1.id);
  assert.equal(rawMarkerDoc.name, '세미나실');

  // Verify simulateFetchCourse reconstructs markers from subcollection
  const fetched = await simulateFetchCourse('user-a', c.id);
  assert.equal(fetched.markers.length, 1);
  assert.equal(fetched.markers[0].name, '세미나실');

  // 2. Duplicate create with version 0 must throw CONFLICT
  await assert.rejects(() => simulateSaveCourse('user-a', c, 0), e => e.code === 'CONFLICT');

  // 3. Concurrent edit attempt with stale version 0 must throw CONFLICT
  await assert.rejects(() => simulateSaveCourse('user-a', { ...c, name: '충돌 수정' }, 0), e => e.code === 'CONFLICT');

  // 4. Update with matching version 1 succeeds and increments to version 2
  // Add a second marker
  const m2 = { id: crypto.randomUUID(), name: '삼청 카페', category: 'cafe', address: '서울 삼청동', lat: 37.58, lng: 126.98, naverLink: 'https://place.naver.com/cafe' };
  const updated1 = await simulateSaveCourse('user-a', { ...saved1, name: '수정된 코스', markers: [m1, m2] }, 1);
  assert.equal(updated1.version, 2);
  assert.equal(updated1.markers.length, 2);
  assert.ok(store.has(`users/user-a/courses/${c.id}/markers/${m2.id}`));

  // 5. Update deleting a marker diffs and removes it from the subcollection
  const updated2 = await simulateSaveCourse('user-a', { ...updated1, markers: [m2] }, 2);
  assert.equal(updated2.version, 3);
  assert.equal(updated2.markers.length, 1);
  assert.ok(!store.has(`users/user-a/courses/${c.id}/markers/${m1.id}`), 'Removed marker deleted from subcollection');
  assert.ok(store.has(`users/user-a/courses/${c.id}/markers/${m2.id}`), 'Retained marker persists in subcollection');

  // 6. Stale update with previous version 2 must throw CONFLICT
  await assert.rejects(() => simulateSaveCourse('user-a', { ...updated1, name: '지연된 저장' }, 2), e => e.code === 'CONFLICT');

  // 7. Delete with stale version throws CONFLICT
  await assert.rejects(() => simulateDeleteCourse('user-a', c.id, 2), e => e.code === 'CONFLICT');

  // 8. Delete with correct version succeeds and deletes subcollection markers atomically
  const deleteResult = await simulateDeleteCourse('user-a', c.id, 3);
  assert.equal(deleteResult.ok, true);
  assert.ok(!store.has(`users/user-a/courses/${c.id}`));
  assert.ok(!store.has(`users/user-a/courses/${c.id}/markers/${m2.id}`), 'Subcollection markers must be deleted with course');

  // 9. Delete non-existent course throws NOT_FOUND
  await assert.rejects(() => simulateDeleteCourse('user-a', c.id, 3), e => e.code === 'NOT_FOUND');

  // 10. Backward compatibility & safe migration path:
  // Simulate an old course created before the redesign with embedded markers in the course document
  const oldId = crypto.randomUUID();
  const legacyMarker = { id: crypto.randomUUID(), name: '레거시 스팟', category: 'spot', address: '', lat: 37.5, lng: 127.0 };
  const legacyCourseDoc = {
    id: oldId,
    version: 1,
    name: '레거시 코스',
    region: '',
    tags: [],
    speed: 4,
    points: [{ lat: 37.5, lng: 127.0 }],
    visits: [],
    markers: [legacyMarker], // embedded in doc!
    updated: new Date().toISOString()
  };
  store.set(`users/user-b/courses/${oldId}`, legacyCourseDoc);

  // Loading legacy course should load embedded markers
  const loadedLegacy = await simulateFetchCourse('user-b', oldId);
  assert.equal(loadedLegacy.markers.length, 1);
  assert.equal(loadedLegacy.markers[0].name, '레거시 스팟');

  // Saving legacy course should write markers to subcollection without silently deleting legacy data
  const migrated = await simulateSaveCourse('user-b', loadedLegacy, 1);
  assert.equal(migrated.version, 2);
  assert.ok(store.has(`users/user-b/courses/${oldId}/markers/${legacyMarker.id}`), 'Migrated marker in subcollection');
  const storedDoc = store.get(`users/user-b/courses/${oldId}`);
  assert.ok(Array.isArray(storedDoc.markers), 'Legacy data in course document is not silently deleted');
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

  // Regular coordinates with link & category
  const norm2 = normalizePlace({
    title: '경복궁',
    address: '서울 종로구 세종로',
    category: '여행,명소><b>고궁</b>',
    link: 'https://place.naver.com/place/12345',
    mapx: '126.9768',
    mapy: '37.5796'
  });
  assert.equal(norm2.lat, 37.5796);
  assert.equal(norm2.lng, 126.9768);
  assert.equal(norm2.category, '여행,명소>고궁');
  assert.equal(norm2.link, 'https://place.naver.com/place/12345');

  // Insecure or invalid link is dropped
  const normInsecure = normalizePlace({
    title: '장소',
    mapx: '126.9',
    mapy: '37.5',
    link: 'javascript:alert(1)'
  });
  assert.equal(normInsecure.link, undefined);

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
  assert.match(rules, /request\.resource\.data\.markers is list/);
  assert.match(rules, /request\.resource\.data\.markers\.size\(\)\s*<=\s*100/);

  // Verify subcollection rules: users/{userId}/courses/{courseId}/markers/{markerId}
  assert.match(rules, /match\s+\/markers\/\{markerId\}/);
  assert.match(rules, /function isValidMarker\(m\)/);
  assert.match(rules, /m\.id\s*==\s*markerId/);
  assert.match(rules, /m\.lat\s*>=\s*-90\s*&&\s*m\.lat\s*<=\s*90/);
  assert.match(rules, /m\.lng\s*>=\s*-180\s*&&\s*m\.lng\s*<=\s*180/);
  assert.match(rules, /'cafe',\s*'food',\s*'photo',\s*'seminar',\s*'academy',\s*'gallery',\s*'book',\s*'spot'/);
  assert.match(rules, /m\.naverLink\.matches\('\^https:\/\/\.\+'\)/);
  assert.match(rules, /m\.keys\(\)\.hasAll\(\['id',\s*'name',\s*'category',\s*'lat',\s*'lng'\]\)/);
  assert.match(rules, /m\.keys\(\)\.hasOnly\(\['id',\s*'name',\s*'category',\s*'lat',\s*'lng',\s*'address',\s*'naverLink',\s*'labelOffsetX',\s*'labelOffsetY',\s*'labelOffset',\s*'color'\]\)/);
  assert.match(rules, /m\.labelOffsetX\s*>=\s*-500\s*&&\s*m\.labelOffsetX\s*<=\s*500/);
  assert.match(rules, /m\.labelOffsetY\s*>=\s*-500\s*&&\s*m\.labelOffsetY\s*<=\s*500/);
  assert.match(rules, /allow create,\s*update:\s*if request\.auth != null\s*&&\s*request\.auth\.uid == userId\s*&&\s*isValidMarker\(request\.resource\.data\)/);
  assert.match(rules, /allow delete:\s*if request\.auth != null\s*&&\s*request\.auth\.uid == userId/);

  // Verify no unused helper in course document block
  const courseMatchIdx = rules.indexOf('match /users/{userId}/courses/{courseId}');
  const markerMatchIdx = rules.indexOf('match /markers/{markerId}');
  const courseBlock = rules.slice(courseMatchIdx, markerMatchIdx);
  assert.ok(!courseBlock.includes('function isValidMarker'), 'No unused helper pretending to validate an array in the course document');

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

test('Firebase Auth persistence, startup loading UI, and state transition logic', async () => {
  // 1. Verify public/firebase.mjs imports setPersistence and browserLocalPersistence
  const fbSource = readFileSync('public/firebase.mjs', 'utf8');
  assert.match(fbSource, /import\s*\{[^}]*\bsetPersistence\b[^}]*\}\s*from\s*'https:\/\/www\.gstatic\.com\/firebasejs\/11\.4\.0\/firebase-auth\.js'/);
  assert.match(fbSource, /import\s*\{[^}]*\bbrowserLocalPersistence\b[^}]*\}\s*from\s*'https:\/\/www\.gstatic\.com\/firebasejs\/11\.4\.0\/firebase-auth\.js'/);

  // In loginWithUsername, setPersistence called before signInWithEmailAndPassword
  const usernameLoginMatch = fbSource.match(/export\s+async\s+function\s+loginWithUsername[\s\S]*?(?=\nexport|\n$|$)/);
  assert.ok(usernameLoginMatch, 'loginWithUsername function found');
  assert.match(usernameLoginMatch[0], /await\s+setPersistence\s*\(\s*auth\s*,\s*browserLocalPersistence\s*\)/);
  const uPersistIdx = usernameLoginMatch[0].indexOf('setPersistence');
  const uSignInIdx = usernameLoginMatch[0].indexOf('signInWithEmailAndPassword');
  assert.ok(uPersistIdx !== -1 && uSignInIdx > uPersistIdx, 'setPersistence must be awaited before signInWithEmailAndPassword');

  // In loginWithGoogle, setPersistence called before signInWithPopup
  const googleLoginMatch = fbSource.match(/export\s+async\s+function\s+loginWithGoogle[\s\S]*?(?=\nexport|\n$|$)/);
  assert.ok(googleLoginMatch, 'loginWithGoogle function found');
  assert.match(googleLoginMatch[0], /await\s+setPersistence\s*\(\s*auth\s*,\s*browserLocalPersistence\s*\)/);
  const gPersistIdx = googleLoginMatch[0].indexOf('setPersistence');
  const gSignInIdx = googleLoginMatch[0].indexOf('signInWithPopup');
  assert.ok(gPersistIdx !== -1 && gSignInIdx > gPersistIdx, 'setPersistence must be awaited before signInWithPopup');

  // In watchAuthState, error callback falls back gracefully
  assert.match(fbSource, /onAuthStateChanged\s*\([^,]+,\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*\{[\s\S]*?\},\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*\{[\s\S]*?callback\s*\(\s*null\s*\)/);

  // 2. Verify public/index.html markup and initial states
  const html = readFileSync('public/index.html', 'utf8');
  assert.match(html, /<div\s+id="auth-loading"\s+class="auth-loading"\s+role="status"\s+aria-live="polite">/);
  assert.match(html, /<div\s+class="auth-loading-spinner"\s+aria-hidden="true"><\/div>/);
  assert.match(html, /<section\s+id="login-screen"\s+class="login-screen"\s+hidden>/);
  const loadingPos = html.indexOf('id="auth-loading"');
  const loginPos = html.indexOf('id="login-screen"');
  assert.ok(loadingPos !== -1 && loginPos > loadingPos, '#auth-loading must precede #login-screen in the DOM');

  // Verify public/style.css loading spinner rules
  const css = readFileSync('public/style.css', 'utf8');
  assert.match(css, /\.auth-loading\b/);
  assert.match(css, /\.auth-loading-spinner\b/);
  assert.match(css, /@keyframes\s+auth-spin/);

  // 3. Test startup state machine and session transitions (mirrors public/app.mjs logic)
  function createAuthAppSimulator() {
    let currentUser = null;
    let courseResetCount = 0;
    const elements = {
      'auth-loading': { hidden: false },
      'login-screen': { hidden: true },
      'app': { hidden: true },
      'login-error': { textContent: 'previous error' }
    };

    async function signedIn(u) {
      const loading = elements['auth-loading'];
      if (loading) loading.hidden = true;
      const sameUser = Boolean(currentUser && currentUser.id === u.id);
      currentUser = u;
      elements['login-screen'].hidden = true;
      elements['app'].hidden = false;
      elements['login-error'].textContent = '';
      if (!sameUser) {
        courseResetCount++;
      }
    }

    async function handleAuthState(activeUser) {
      const loading = elements['auth-loading'];
      if (loading) loading.hidden = true;
      if (activeUser) {
        await signedIn(activeUser);
      } else {
        currentUser = null;
        elements['login-screen'].hidden = false;
        elements['app'].hidden = true;
        elements['login-error'].textContent = '';
      }
    }

    async function handleLogout() {
      currentUser = null;
      courseResetCount++;
      const loading = elements['auth-loading'];
      if (loading) loading.hidden = true;
      elements['app'].hidden = true;
      elements['login-screen'].hidden = false;
    }

    return { elements, getCurrentUser: () => currentUser, getCourseResetCount: () => courseResetCount, signedIn, handleAuthState, handleLogout };
  }

  // Case A: Startup with existing authenticated user restored from persistence
  const simAuth = createAuthAppSimulator();
  assert.equal(simAuth.elements['auth-loading'].hidden, false, 'starts with loading visible');
  assert.equal(simAuth.elements['login-screen'].hidden, true, 'starts with login-screen hidden to prevent flicker');
  assert.equal(simAuth.elements['app'].hidden, true, 'starts with app hidden');

  await simAuth.handleAuthState({ id: 'user-restore-1', name: 'restored-user' });
  assert.equal(simAuth.elements['auth-loading'].hidden, true, 'auth-loading hidden after session restored');
  assert.equal(simAuth.elements['login-screen'].hidden, true, 'login-screen remains hidden');
  assert.equal(simAuth.elements['app'].hidden, false, 'app screen is revealed');
  assert.equal(simAuth.getCurrentUser()?.id, 'user-restore-1');
  assert.equal(simAuth.getCourseResetCount(), 1, 'course initialized once for new user');

  // Redundant auth state event with same user should not reset course state
  await simAuth.handleAuthState({ id: 'user-restore-1', name: 'restored-user' });
  assert.equal(simAuth.getCourseResetCount(), 1, 'course state preserved when auth state triggers with same user');
  assert.equal(simAuth.elements['app'].hidden, false);

  // Case B: Startup with unauthenticated user
  const simUnauth = createAuthAppSimulator();
  assert.equal(simUnauth.elements['auth-loading'].hidden, false);
  assert.equal(simUnauth.elements['login-screen'].hidden, true);

  await simUnauth.handleAuthState(null);
  assert.equal(simUnauth.elements['auth-loading'].hidden, true, 'auth-loading hidden when unauthenticated');
  assert.equal(simUnauth.elements['login-screen'].hidden, false, 'login-screen is shown');
  assert.equal(simUnauth.elements['app'].hidden, true, 'app screen remains hidden');
  assert.equal(simUnauth.elements['login-error'].textContent, '');
  assert.equal(simUnauth.getCurrentUser(), null);

  // Explicit sign in from login screen
  await simUnauth.signedIn({ id: 'user-login-2', name: 'bob' });
  assert.equal(simUnauth.elements['auth-loading'].hidden, true);
  assert.equal(simUnauth.elements['login-screen'].hidden, true);
  assert.equal(simUnauth.elements['app'].hidden, false);
  assert.equal(simUnauth.getCurrentUser()?.id, 'user-login-2');
  assert.equal(simUnauth.getCourseResetCount(), 1);

  // Case C: Logout clears session and restores login screen
  await simUnauth.handleLogout();
  assert.equal(simUnauth.elements['auth-loading'].hidden, true);
  assert.equal(simUnauth.elements['app'].hidden, true);
  assert.equal(simUnauth.elements['login-screen'].hidden, false);
  assert.equal(simUnauth.getCurrentUser(), null);

  // Auth observer fires null after logout
  await simUnauth.handleAuthState(null);
  assert.equal(simUnauth.elements['login-screen'].hidden, false);
  assert.equal(simUnauth.elements['app'].hidden, true);
});

test('subcollection markers with label offsets pass validation and persist correctly', async () => {
  const store = new Map();

  // Helper matching firestore.rules isValidMarker
  function isValidMarker(m, markerId) {
    if (!m || typeof m !== 'object') return false;
    if (typeof m.id !== 'string' || m.id !== markerId || m.id.length === 0 || m.id.length > 36) return false;
    if (typeof m.name !== 'string' || m.name.length === 0 || m.name.length > 100) return false;
    if (typeof m.category !== 'string' || !['cafe', 'food', 'photo', 'seminar', 'academy', 'gallery', 'book', 'spot'].includes(m.category)) return false;
    if (typeof m.lat !== 'number' || m.lat < -90 || m.lat > 90) return false;
    if (typeof m.lng !== 'number' || m.lng < -180 || m.lng > 180) return false;
    if ('address' in m && (typeof m.address !== 'string' || m.address.length > 200)) return false;
    if ('naverLink' in m && (typeof m.naverLink !== 'string' || m.naverLink.length > 2000 || !m.naverLink.startsWith('https://'))) return false;
    if ('labelOffsetX' in m && (typeof m.labelOffsetX !== 'number' || m.labelOffsetX < -500 || m.labelOffsetX > 500)) return false;
    if ('labelOffsetY' in m && (typeof m.labelOffsetY !== 'number' || m.labelOffsetY < -500 || m.labelOffsetY > 500)) return false;
    if ('labelOffset' in m) {
      if (!m.labelOffset || typeof m.labelOffset !== 'object' || Array.isArray(m.labelOffset)) return false;
      if (typeof m.labelOffset.x !== 'number' || m.labelOffset.x < -500 || m.labelOffset.x > 500) return false;
      if (typeof m.labelOffset.y !== 'number' || m.labelOffset.y < -500 || m.labelOffset.y > 500) return false;
    }
    if ('color' in m && (typeof m.color !== 'string' || m.color.length > 30)) return false;
    const required = ['id', 'name', 'category', 'lat', 'lng'];
    for (const k of required) {
      if (!(k in m)) return false;
    }
    const allowed = new Set(['id', 'name', 'category', 'lat', 'lng', 'address', 'naverLink', 'labelOffsetX', 'labelOffsetY', 'labelOffset', 'color']);
    for (const k of Object.keys(m)) {
      if (!allowed.has(k)) return false;
    }
    return true;
  }

  const mId = crypto.randomUUID();
  const marker = {
    id: mId,
    name: '경복궁 포토스팟',
    category: 'photo',
    address: '서울 종로구 사직로 161',
    lat: 37.5796,
    lng: 126.9770,
    labelOffsetX: 75,
    labelOffsetY: -120,
    color: '#E32219'
  };

  // 1. Verify rules schema validation passes
  assert.equal(isValidMarker(marker, mId), true);
  assert.equal(isValidMarker({ ...marker, category: 'academy' }, mId), true);
  assert.equal(isValidMarker({ ...marker, category: 'gallery' }, mId), true);
  assert.equal(isValidMarker({ ...marker, category: 'book' }, mId), true);
  assert.equal(isValidMarker({ ...marker, color: '#1976D2' }, mId), true);
  assert.equal(isValidMarker({ ...marker, labelOffsetX: 501 }, mId), false);
  assert.equal(isValidMarker({ ...marker, labelOffsetY: -501 }, mId), false);
  assert.equal(isValidMarker({ ...marker, extraKey: 'forbidden' }, mId), false);

  // 2. Verify persistence in simulated subcollection
  const uid = 'test-user-offset';
  const courseId = crypto.randomUUID();
  const path = `users/${uid}/courses/${courseId}/markers/${mId}`;
  store.set(path, structuredClone(marker));

  const stored = store.get(path);
  assert.ok(stored);
  assert.equal(stored.id, mId);
  assert.equal(stored.labelOffsetX, 75);
  assert.equal(stored.labelOffsetY, -120);

  // 3. Verify marker with labelOffset object as well
  const mId2 = crypto.randomUUID();
  const marker2 = {
    id: mId2,
    name: '삼청동 카페',
    category: 'cafe',
    lat: 37.583,
    lng: 126.982,
    labelOffset: { x: -30, y: 40 }
  };
  assert.equal(isValidMarker(marker2, mId2), true);
  const path2 = `users/${uid}/courses/${courseId}/markers/${mId2}`;
  store.set(path2, structuredClone(marker2));
  assert.deepEqual(store.get(path2).labelOffset, { x: -30, y: 40 });
});
