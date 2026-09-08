# WalkMap

네이버 지도에 직접 그린 도보 경로와 방문 장소·체류시간을 기록하는 개인/소규모 포토워크 웹 앱입니다.
Firebase Authentication·Firestore를 백엔드로 사용하고 GitHub Pages를 정적 프론트엔드 호스팅으로 사용하도록 전환되었습니다. 현재 무료 플랜을 유지하기 위해 Cloud Functions 기반 네이버 장소 검색은 비활성화되어 있으며, 지도에서 위치를 직접 선택합니다.

> **현재 배포**: Firebase 프로젝트 `walkmap-gaemi-kim`과 GitHub Pages `https://walkmap.gaemi.kim`을 사용합니다. Firebase 웹 설정값은 공개 클라이언트 설정으로 GitHub Actions Variables에서 주입합니다.

---

## 1. 아키텍처 개요

- **정적 프론트엔드**: GitHub Pages (`main` 브랜치 자동 배포, 커스텀 도메인 `walkmap.gaemi.kim` CNAME 포함)
- **인증 (Authentication)**: Firebase Authentication (Email/Password 제공자)
  - 기존 아이디/비밀번호 UX 유지를 위해 결정론적 내부 이메일 매핑(`username` → `${username.toLowerCase()}@walkmap.internal`)을 사용합니다. 비밀번호는 자체 보관하거나 노출하지 않습니다.
- **데이터베이스 (Firestore)**: Cloud Firestore
  - 코스는 사용자별 경로 `/users/{uid}/courses/{courseId}` 아래에 저장되며, 보안 규칙으로 소유자 격리 및 순차적 버전 증가(`version == resource.data.version + 1`)를 강제합니다.
  - 트랜잭션을 통해 다른 창에서의 동시 수정을 감지하고 무단 덮어쓰기를 차단합니다.
- **참고 마커 (Reference Markers)**:
  - 방문 순서나 체류시간이 없는 독립 참조 마커(식당, 카페, 포토스팟, 세미나실 등)를 지원합니다.
  - 코스 문서 내 배열 임베딩 대신, 독립된 Firestore 서브컬렉션 `/users/{uid}/courses/{courseId}/markers/{markerId}` 문서로 저장됩니다 (기존 방문 장소 및 경로는 코스 문서에 유지).
  - Firestore 보안 규칙이 문서 수준에서 strict 스키마(경로 일치 ID, 이름 길이, 카테고리 허용목록 `['cafe', 'food', 'photo', 'seminar', 'spot']`, 좌표 범위, 선택적 주소 및 HTTPS 링크, 키 제한)를 직접 검증합니다.
  - 트랜잭션을 통한 원자적 저장을 적용하여 코스 버전과 마커 변경(추가/수정/삭제)이 부분 저장 없이 일괄 반영되며 동시성 충돌을 보호합니다.
  - 하위 호환성: 기존 코스 문서에 저장된 레거시 `course.markers` 배열을 안전하게 불러오며, 저장 시 서브컬렉션으로 안전하게 마이그레이션하고 레거시 데이터를 무단 삭제하지 않습니다.
  - 장소 검색 결과에서 “마커로 저장”하거나 지도에서 직접 추가할 수 있으며, 카테고리별 구분 아이콘(CSS/HTML)을 제공합니다.
- **장소 검색**: 무료 플랜 유지로 현재 비활성화되어 있습니다. 네이버 검색은 브라우저에 비밀키를 노출할 수 없으므로, 검색 기능을 다시 켜려면 Blaze 플랜과 Cloud Functions Secret Manager가 필요합니다.
- **경로 편집 모드 및 진행방향 표시 (Route Editing & Direction)**:
  - **편집 모드 경계 (Route Editing Mode Boundaries)**: 일반 지도 탐색(pan) 모드에서는 경로 점 드래그와 중간 삽입(+) 컨트롤이 비활성화되며 점 클릭 시 사이드바에서 선택만 수행됩니다. 경로 편집/추가 모드(`draw`)에서만 점 끌어 이동 및 중간 삽입이 활성화됩니다. `#draw`/`#pan` 버튼 상태 및 `aria-pressed`, 모드 힌트 안내, 포커스 전환(`draw` 진입 시 `#finish` 포커스, 완료/취소 시 `#draw` 복귀), `Escape` 키보드 단축키를 통한 안전한 편집 종료를 지원합니다.
  - **진행방향 안내 (Segment Direction Arrows)**: 출발점에서 도착점으로 이어지는 경로 세그먼트의 진행 방향을 화면 투영 각도(`segmentAngle`)로 계산하여 화살표 배지(세그먼트 58% 지점)로 표시합니다. 8m 미만의 초단거리 세그먼트는 화살표를 생략하며, 선택된 편집점에 연결된 세그먼트는 강조색(`--accent-red`)으로 표시됩니다.
- **분리형 핀-라벨 리더선 (Detachable Pin-to-Label Connectors)**:
  - 방문 장소 및 참고 마커의 지리적 좌표 핀은 고정된 채 라벨을 드래그하여 오프셋(`labelOffsetX`, `labelOffsetY`, 범위 `[-400, 400]`)을 조절할 수 있습니다.
  - 핀과 라벨 사이를 SVG 점선 리더선(`stroke-dasharray: 3 3`)으로 실시간 연결하며, 12px 미만으로 이동 시 리더선과 분리 핀이 숨겨지는 기본 밀착 레이아웃으로 자동 전환됩니다.
  - 4px 이하 터치/클릭은 편집 다이얼로그를 열고, 4px 초과 이동 시 오프셋을 자동 영구 저장합니다.
  - 사이드바 카드("라벨 초기화") 및 편집 다이얼로그("라벨 위치 초기화")에서 기본 위치로 원클릭 복원할 수 있습니다.
  - Firestore 보안 규칙 및 데이터 모델(`validateCourse`, `validateMarker`)에서 `[-500, 500]` 경계 검증을 지원합니다.
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

## 3. Firebase 콘솔 설정

Firebase 전용 프로젝트 `walkmap-gaemi-kim`에 아래 설정을 적용합니다.

### 1) Firebase 프로젝트 생성
1. [Firebase Console](https://console.firebase.google.com/project/walkmap-gaemi-kim)에서 프로젝트를 엽니다.
2. Cloud Firestore를 **Standard**, 위치 `asia-northeast3`로 생성합니다.

### 2) Authentication 설정
1. **Build > Authentication > Sign-in method**로 이동합니다.
2. **이메일/비밀번호(Email/Password)** 제공자를 활성화합니다 (이메일 링크는 비활성화).
3. **Users** 탭에서 WalkMap 사용자 계정을 추가합니다:
   - 이메일: `<아이디>@walkmap.internal` (예: `walkmap@walkmap.internal`)
   - 비밀번호: 12자 이상의 안전한 비밀번호

### 3) Cloud Firestore 설정
1. **Build > Firestore Database**에서 데이터베이스를 만듭니다 (프로덕션 모드).
2. 보안 규칙 배포:
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

## 4. 선택 기능: Cloud Functions 네이버 검색

이 기능은 Blaze(종량제) 전환을 원할 때만 활성화합니다. 현재는 무료 플랜 유지를 위해 배포하지 않습니다.

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
