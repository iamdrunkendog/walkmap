import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
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
  setDoc,
  deleteDoc,
  writeBatch,
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
import { usernameToEmail, emailToUsername, validateCourse, validateMarker } from './model.mjs';

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
  }, (err) => {
    console.warn('onAuthStateChanged error:', err);
    callback(null);
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
    await setPersistence(auth, browserLocalPersistence);
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

export async function loginWithGoogle() {
  if (!isConfigured()) throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  const { auth } = initFirebase();
  try {
    await setPersistence(auth, browserLocalPersistence);
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    return { id: cred.user.uid, name: cred.user.displayName || emailToUsername(cred.user.email) || 'user' };
  } catch (err) {
    if (err.code === 'auth/popup-closed-by-user') return null;
    if (err.code === 'auth/popup-blocked') throw Object.assign(new Error('Google 로그인 창이 차단되었습니다. 팝업을 허용해 주세요.'), { code: 'POPUP_BLOCKED' });
    throw Object.assign(new Error(err.message || 'Google 로그인에 실패했습니다.'), { code: err.code || 'GOOGLE_LOGIN' });
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
  const items = await Promise.all(snapshot.docs.map(async (d) => {
    const course = d.data();
    try {
      const markersSnap = await getDocs(collection(db, 'users', uid, 'courses', course.id, 'markers'));
      if (!markersSnap.empty) {
        course.markers = markersSnap.docs.map(mDoc => mDoc.data());
      } else if (!Array.isArray(course.markers)) {
        course.markers = [];
      }
    } catch {
      if (!Array.isArray(course.markers)) course.markers = [];
    }
    return course;
  }));
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
  const courseData = snap.data();

  // Load markers from subcollection: users/{uid}/courses/{courseId}/markers
  try {
    const markersRef = collection(db, 'users', uid, 'courses', courseId, 'markers');
    const markersSnap = await getDocs(markersRef);
    if (!markersSnap.empty) {
      courseData.markers = markersSnap.docs.map(d => d.data());
    } else if (Array.isArray(courseData.markers)) {
      // Preserve backward compatibility: load legacy embedded course.markers
    } else {
      courseData.markers = [];
    }
  } catch {
    if (!Array.isArray(courseData.markers)) {
      courseData.markers = [];
    }
  }

  return courseData;
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

  // Prepare course document data without embedding markers array on new writes
  const { markers, ...courseDocData } = c;
  const nextData = { ...courseDocData, version: nextVersion, updated };

  // For updates, query existing subcollection marker documents for deletion diffing
  const markersColRef = collection(db, 'users', uid, 'courses', c.id, 'markers');
  let existingMarkerIds = new Set();
  if (baseVersion > 0) {
    try {
      const existingSnap = await getDocs(markersColRef);
      existingMarkerIds = new Set(existingSnap.docs.map(d => d.id));
    } catch (err) {
      console.warn('Could not read existing markers for diffing:', err);
    }
  }

  const currentMarkerIds = new Set((markers || []).map(m => m.id));
  const markerIdsToDelete = [...existingMarkerIds].filter(id => !currentMarkerIds.has(id));

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
      // tx.update only updates fields in nextData, preserving legacy course.markers on the doc if present
      tx.update(docRef, nextData);
    }

    // Atomically delete removed marker documents from the subcollection
    for (const id of markerIdsToDelete) {
      const mDocRef = doc(db, 'users', uid, 'courses', c.id, 'markers', id);
      tx.delete(mDocRef);
    }

    // Atomically write all current marker documents to the subcollection
    for (const m of (markers || [])) {
      const mDocRef = doc(db, 'users', uid, 'courses', c.id, 'markers', m.id);
      tx.set(mDocRef, m);
    }
  });

  return { ...c, version: nextVersion, updated };
}

export async function deleteCourse(uid, courseId, expectedVersion) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const { db } = initFirebase();
  const docRef = doc(db, 'users', uid, 'courses', courseId);
  const markersColRef = collection(db, 'users', uid, 'courses', courseId, 'markers');

  // Query existing subcollection markers so they are deleted atomically with course doc
  let markerDocs = [];
  try {
    const markersSnap = await getDocs(markersColRef);
    markerDocs = markersSnap.docs;
  } catch (err) {
    console.warn('Could not query markers for deletion:', err);
  }

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) {
      throw Object.assign(new Error('코스를 찾을 수 없습니다.'), { code: 'NOT_FOUND' });
    }
    const current = snap.data();
    if (current.version !== expectedVersion) {
      throw Object.assign(new Error('다른 창에서 수정된 코스입니다. 다시 불러온 뒤 삭제해 주세요.'), { code: 'CONFLICT' });
    }
    // Delete all marker subcollection documents atomically
    for (const mDoc of markerDocs) {
      tx.delete(mDoc.ref);
    }
    tx.delete(docRef);
  });

  return { ok: true };
}

export async function fetchMarkers(uid, courseId) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const { db } = initFirebase();
  const colRef = collection(db, 'users', uid, 'courses', courseId, 'markers');
  const snap = await getDocs(colRef);
  return snap.docs.map(d => d.data());
}

export async function saveMarker(uid, courseId, rawMarker) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const valid = validateMarker(rawMarker);
  const { db } = initFirebase();
  const markerRef = doc(db, 'users', uid, 'courses', courseId, 'markers', valid.id);
  await setDoc(markerRef, valid);
  return valid;
}

export async function deleteMarker(uid, courseId, markerId) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const { db } = initFirebase();
  const markerRef = doc(db, 'users', uid, 'courses', courseId, 'markers', markerId);
  await deleteDoc(markerRef);
  return { ok: true };
}

export async function searchPlaces(query) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Firebase 설정이 필요합니다. README의 설정을 확인해 주세요.'), { code: 'CONFIG_MISSING' });
  }
  const clean = (query || '').trim();
  if (!clean || clean.length > 100) {
    throw Object.assign(new Error('검색어는 1–100자로 입력해 주세요.'), { code: 'QUERY' });
  }
  const { functions } = initFirebase();
  const callable = httpsCallable(functions, 'searchPlaces');
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(Object.assign(new Error('검색 서버 응답 시간이 초과되었습니다.'), { code: 'functions/deadline-exceeded' }));
    }, 6000);
  });
  try {
    const result = await Promise.race([callable({ query: clean }), timeoutPromise]);
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
    if (err.code === 'functions/unavailable' || err.code === 'functions/deadline-exceeded') {
      throw Object.assign(new Error('검색 서버에 연결할 수 없거나 응답 시간이 초과되었습니다.'), { code: 'SEARCH_NETWORK' });
    }
    throw Object.assign(new Error(err.message || '검색 중 오류가 발생했습니다.'), { code: 'SEARCH_ERROR' });
  } finally {
    clearTimeout(timerId);
  }
}
