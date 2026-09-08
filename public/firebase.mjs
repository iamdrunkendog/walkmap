import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  orderBy,
  runTransaction,
  connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js';
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-functions.js';
import { config } from './config.js';
import { usernameToEmail, emailToUsername, validateCourse } from './model.mjs';

let app = null, auth = null, db = null, functions = null;

export function isConfigured() {
  return Boolean(config.firebase && config.firebase.projectId && config.firebase.apiKey);
}

export function initFirebase() {
  if (!isConfigured()) return null;
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(config.firebase);
    auth = getAuth(app);
    db = getFirestore(app);
    functions = getFunctions(app, config.functionsRegion || 'asia-northeast3');
    if (config.useEmulator) {
      try {
        connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        connectFirestoreEmulator(db, '127.0.0.1', 8080);
        connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      } catch (e) {
        console.warn('Firebase emulator connection warning:', e.message);
      }
    }
  }
  return { app, auth, db, functions };
}

export function getMapsClientId() {
  return config.mapsClientId || '';
}

export function watchAuthState(callback) {
  if (!isConfigured()) {
    callback(null);
    return () => {};
  }
  const services = initFirebase();
  return onAuthStateChanged(services.auth, (user) => {
    if (!user) {
      callback(null);
      return;
    }
    callback({
      id: user.uid,
      name: user.displayName || emailToUsername(user.email) || 'user'
    });
  });
}

export async function loginWithUsername(username, password) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const email = usernameToEmail(username);
  if (!password || password.length < 12 || password.length > 200) {
    throw Object.assign(new Error('비밀번호는 12–200자여야 합니다.'), { code: 'LOGIN_INPUT' });
  }
  const { auth } = initFirebase();
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return {
      id: cred.user.uid,
      name: cred.user.displayName || emailToUsername(cred.user.email) || username
    };
  } catch (err) {
    if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(err.code)) {
      throw Object.assign(new Error('아이디 또는 비밀번호가 올바르지 않습니다.'), { code: 'LOGIN' });
    }
    if (err.code === 'auth/too-many-requests') {
      throw Object.assign(new Error('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'), { code: 'RATE_LIMIT' });
    }
    if (err.code === 'auth/network-request-failed') {
      throw Object.assign(new Error('인증 서버에 연결할 수 없습니다. 네트워크 연결을 확인해 주세요.'), { code: 'NETWORK' });
    }
    throw Object.assign(new Error(err.message || '로그인에 실패했습니다.'), { code: err.code || 'LOGIN' });
  }
}

export async function logoutUser() {
  if (!isConfigured()) return;
  const { auth } = initFirebase();
  await fbSignOut(auth);
}

export async function fetchCourses(uid) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const { db } = initFirebase();
  const colRef = collection(db, 'users', uid, 'courses');
  let snapshot;
  try {
    const q = query(colRef, orderBy('updated', 'desc'));
    snapshot = await getDocs(q);
  } catch {
    snapshot = await getDocs(colRef);
  }
  const items = snapshot.docs.map(d => d.data());
  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  return items;
}

export async function fetchCourse(uid, courseId) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const { db } = initFirebase();
  const docRef = doc(db, 'users', uid, 'courses', courseId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    throw Object.assign(new Error('코스를 찾을 수 없습니다.'), { code: 'NOT_FOUND' });
  }
  return snap.data();
}

export async function saveCourse(uid, rawCourse, baseVersion) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  let c;
  try {
    c = validateCourse({ ...rawCourse, version: baseVersion });
  } catch (e) {
    throw Object.assign(new Error(e.message), { code: 'VALIDATION' });
  }
  const { db } = initFirebase();
  const docRef = doc(db, 'users', uid, 'courses', c.id);
  const nextVersion = baseVersion + 1;
  const updated = new Date().toISOString();
  const nextData = { ...c, version: nextVersion, updated };

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (baseVersion === 0) {
      if (snap.exists()) {
        throw Object.assign(new Error('이미 저장된 코스입니다. 현재 편집 내용을 복제해 저장할 수 있습니다.'), { code: 'CONFLICT' });
      }
      tx.set(docRef, nextData);
    } else {
      if (!snap.exists()) {
        throw Object.assign(new Error('코스가 삭제되었거나 접근할 수 없습니다. 편집 내용을 복제해 저장할 수 있습니다.'), { code: 'NOT_FOUND' });
      }
      const current = snap.data();
      if (current.version !== baseVersion) {
        throw Object.assign(new Error('다른 창에서 수정되었습니다. 현재 내용은 유지됩니다. 복제하여 별도로 저장해 주세요.'), { code: 'CONFLICT' });
      }
      tx.update(docRef, nextData);
    }
  });

  return nextData;
}

export async function deleteCourse(uid, courseId, expectedVersion) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const { db } = initFirebase();
  const docRef = doc(db, 'users', uid, 'courses', courseId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) {
      throw Object.assign(new Error('코스를 찾을 수 없습니다.'), { code: 'NOT_FOUND' });
    }
    const current = snap.data();
    if (current.version !== expectedVersion) {
      throw Object.assign(new Error('다른 창에서 수정된 코스입니다. 다시 불러온 뒤 삭제해 주세요.'), { code: 'CONFLICT' });
    }
    tx.delete(docRef);
  });

  return { ok: true };
}

export async function searchPlaces(query) {
  throw Object.assign(new Error('장소 검색은 현재 무료 플랜에서 사용할 수 없습니다. 지도에서 위치를 직접 선택해 주세요.'), { code: 'SEARCH_UNAVAILABLE' });
  /* Blaze 플랜을 선택할 때만 Cloud Functions 검색을 활성화합니다.
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const clean = (query || '').trim();
  if (!clean || clean.length > 100) {
    throw Object.assign(new Error('검색어는 1–100자로 입력해 주세요.'), { code: 'QUERY' });
  }
  const { functions } = initFirebase();
  const callable = httpsCallable(functions, 'searchPlaces');
  try {
    const result = await callable({ query: clean });
    return result.data?.items || [];
  } catch (err) {
    if (err.code === 'functions/unauthenticated') {
      throw Object.assign(new Error('로그인이 필요합니다.'), { code: 'AUTH' });
    }
    if (err.code === 'functions/resource-exhausted') {
      throw Object.assign(new Error('검색 호출 한도를 초과했습니다. 나중에 다시 시도해 주세요.'), { code: 'SEARCH_QUOTA' });
    }
    if (err.code === 'functions/permission-denied') {
      throw Object.assign(new Error('검색 인증 실패: API HUB의 지역 API 선택과 인증 정보를 확인해 주세요.'), { code: 'SEARCH_AUTH' });
    }
    if (err.code === 'functions/unavailable') {
      throw Object.assign(new Error('검색 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'), { code: 'SEARCH_NETWORK' });
    }
    throw Object.assign(new Error(err.message || '검색 중 오류가 발생했습니다.'), { code: 'SEARCH_ERROR' });
  }
  */
}
