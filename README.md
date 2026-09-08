# WalkMap

네이버 지도에 직접 그린 도보 경로와 방문 장소·체류시간을 기록하는 개인/소규모 포토워크 웹 앱입니다.
Firebase(인증, Firestore, Cloud Functions)를 백엔드로 사용하고 GitHub Pages를 정적 프론트엔드 호스팅으로 사용하도록 전환되었습니다.

> **안내**: 전용 Firebase 프로젝트 생성 및 클라우드 배포는 추후 진행됩니다. 현재 저장소에는 실제 프로젝트 ID나 비밀값이 포함되어 있지 않으며, 빌드/배포 시점에 주입됩니다.

---

## 1. 아키텍처 개요

- **정적 프론트엔드**: GitHub Pages (`main` 브랜치 자동 배포, 커스텀 도메인 `walkmap.gaemi.kim` CNAME 포함)
- **인증 (Authentication)**: Firebase Authentication (Email/Password 제공자)
  - 기존 아이디/비밀번호 UX 유지를 위해 결정론적 내부 이메일 매핑(`username` → `${username.toLowerCase()}@walkmap.internal`)을 사용합니다. 비밀번호는 자체 보관하거나 노출하지 않습니다.
- **데이터베이스 (Firestore)**: Cloud Firestore
  - 코스는 사용자별 경로 `/users/{uid}/courses/{courseId}` 아래에 저장되며, 보안 규칙으로 소유자 격리 및 순차적 버전 증가(`version == resource.data.version + 1`)를 강제합니다.
  - 트랜잭션을 통해 다른 창에서의 동시 수정을 감지하고 무단 덮어쓰기를 차단합니다.
- **장소 검색 (Cloud Functions)**: Firebase 2nd Gen Callable HTTPS Function (`searchPlaces`)
  - 네이버 API HUB 지역 검색 비밀키(`NAVER_SEARCH_CLIENT_SECRET`)를 Cloud Secret Manager를 통해 서버 측에만 안전하게 보관합니다.
  - 로그인한 사용자(`request.auth`)만 검색 함수를 호출할 수 있습니다.
- **레거시 런타임 (SQLite / Node server)**:
  - 기존 `server.mjs`, `manage.mjs` 및 `tests/core.test.mjs`는 테스트 및 로컬 참조용으로 격리 유지되며, GitHub Pages 빌드 아티팩트에는 포함되지 않습니다.

---

## 2. 로컬 개발 및 테스트

Node.js **24 이상**이 필요합니다.

### 정적 사이트 빌드
```sh
npm run build
```
- `public/` 정적 파일을 `dist/` 디렉토리로 복사하고, `CNAME`(walkmap.gaemi.kim) 및 SPA 폴백(`404.html`)을 생성합니다.
- 환경변수(`FIREBASE_CONFIG`, `NAVER_MAPS_CLIENT_ID`)가 주입된 경우 `dist/config.js`를 구성하며, 없을 경우 안전한 플레이스홀더 템플릿을 복사합니다.
- 서버 런타임 파일(Node 서버, SQLite, .env)은 `dist/`에서 엄격히 배제됩니다.

### 테스트 실행
```sh
npm test
```
- `node --test tests/*.test.mjs`를 실행합니다.
- 모델 로직, 이력 복원, Firestore 동시성 충돌 방지 시뮬레이션, 결정론적 이메일 매핑, 검색 정규화 및 빌드 무결성을 검증합니다.

### 비밀값 누출 검사
```sh
node tests/secrets-check.mjs
```
- Git 추적 파일 및 공개 파일에 알려진 API 키나 비공개 데이터가 포함되어 있지 않은지 검사합니다.

---

## 3. 추후 필요한 Firebase 콘솔 설정

Firebase 전용 프로젝트가 생성되면 아래 순서로 콘솔에서 설정을 진행합니다.

### 1) Firebase 프로젝트 생성
1. [Firebase Console](https://console.firebase.google.com/)에서 새 프로젝트를 만듭니다.
2. Cloud Functions 외부 API 호출을 위해 요금제를 **Blaze(종량제)**로 전환합니다.

### 2) Authentication 설정
1. **Build > Authentication > Sign-in method**로 이동합니다.
2. **이메일/비밀번호(Email/Password)** 제공자를 활성화합니다 (이메일 링크는 비활성화).
3. **Users** 탭에서 WalkMap 사용자 계정을 추가합니다:
   - 이메일: `<아이디>@walkmap.internal` (예: `walkmap@walkmap.internal`)
   - 비밀번호: 12자 이상의 안전한 비밀번호

### 3) Cloud Firestore 설정
1. **Build > Firestore Database**에서 데이터베이스를 만듭니다 (프로덕션 모드).
2. 위치는 서울 리전(`asia-northeast3`)을 권장합니다.
3. 보안 규칙 배포:
   ```sh
   firebase deploy --only firestore:rules
   ```

### 4) 웹 앱 등록 및 클라이언트 설정 확보
1. **Project settings > General > Your apps**에서 웹 앱(`</>`)을 등록합니다.
2. 발급된 `firebaseConfig` 객체를 복사합니다:
   ```json
   {
     "apiKey": "AIzaSy...",
     "authDomain": "<project-id>.firebaseapp.com",
     "projectId": "<project-id>",
     "storageBucket": "<project-id>.firebasestorage.app",
     "messagingSenderId": "...",
     "appId": "..."
   }
   ```

---

## 4. Cloud Functions 네이버 검색 비밀키 설정

네이버 API HUB 지역 검색 비밀키는 Cloud Functions 서버 환경에 비밀값으로 등록합니다.

```sh
# Firebase CLI 로그인 및 프로젝트 선택
firebase login
firebase use <project-id>

# Secret Manager에 비밀키 저장
firebase functions:secrets:set NAVER_SEARCH_CLIENT_ID
# 프롬프트가 나타나면 네이버 API HUB Client ID 입력

firebase functions:secrets:set NAVER_SEARCH_CLIENT_SECRET
# 프롬프트가 나타나면 네이버 API HUB Client Secret 입력

# 함수 배포
firebase deploy --only functions
```

---

## 5. GitHub Pages 배포 워크플로우

`.github/workflows/pages.yml` 워크플로우가 `main` 브랜치 푸시 시 자동으로 정적 프론트엔드를 빌드하여 GitHub Pages에 배포합니다.

### GitHub Repository Secrets / Variables 설정
GitHub 저장소의 **Settings > Secrets and variables > Actions**에서 다음 값을 설정합니다:

| 이름 | 종류 | 설명 |
| --- | --- | --- |
| `NAVER_MAPS_CLIENT_ID` | Secret 또는 Variable | 네이버 Dynamic Map v3 Client ID |
| `FIREBASE_CONFIG` | Secret | Firebase 웹 앱 설정 JSON 문자열 (전체 객체) |
| `FIREBASE_FUNCTIONS_REGION` | Variable (선택) | Functions 리전 (기본값: `asia-northeast3`) |

---

## 6. 커스텀 도메인 (`walkmap.gaemi.kim`) 설정

빌드 산출물에 `CNAME` 파일(`walkmap.gaemi.kim`)이 포함되어 있습니다. 도메인 활성화 및 DNS 설정은 준비가 완료된 후 진행합니다.

1. **DNS CNAME 레코드 추가**:
   - 호스트: `walkmap`
   - 대상(Target): `<your-github-username>.github.io`
   > **주의**: 현재는 DNS가 설정되어 있지 않으며 도메인이 활성화되어 있지 않습니다.
2. **GitHub 저장소 Pages 설정**:
   - **Settings > Pages > Custom domain**에 `walkmap.gaemi.kim` 입력 및 저장.
   - DNS 전파 확인 후 **Enforce HTTPS** 활성화.
3. **네이버 클라우드 플랫폼 허용 URL 등록**:
   - [NAVER Cloud Console](https://console.ncloud.com/) > **AI·NAVER API > Application**에서 해당 애플리케이션 선택.
   - Web 서비스 URL에 `https://walkmap.gaemi.kim` 및 로컬 테스트용 URL을 등록합니다.

---

## 7. 보안 경계 및 불변 조건

- **자격 증명 미추적**: 실제 API 키, 시크릿, 비밀번호는 저장소에 커밋되지 않습니다.
- **프로덕션 인증 우회 금지**: `WALKMAP_NO_AUTH`는 프론트엔드 코드에 존재하지 않으며 프로덕션에서 허용되지 않습니다.
- **공개 쓰기 차단**: Firestore는 인증된 본인 UID 경로 외의 모든 읽기/쓰기를 거부합니다.
- **검색 시크릿 보호**: 브라우저는 네이버 검색 API를 직접 호출하지 않으며, Functions를 통해서만 안전하게 호출합니다.
