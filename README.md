# 논증 탐정단

중학교 국어 수업에서 25명 내외의 학생이 6개 모둠으로 참여하는 실시간 협동 논증 게임입니다. 교사는 모둠별 진행 상황을 관찰하고 힌트를 보내며, 학생들은 문장 배열과 논증 방법을 함께 해결한 뒤 개인 설명을 제출합니다.

## 주요 기능

- 교사 수업 생성, 입장 코드, 제한 시간, 모둠 수 설정
- `[1모둠] ... #연역` 형식의 논증 글 파싱 및 문장 자동 섞기
- Firestore `onSnapshot` 기반 모둠 문장 배열·진행 상태 실시간 동기화
- 드래그앤드롭 문장 카드와 연역·귀납·유추 선택
- 모둠당 1회 힌트 요청 및 교사 힌트 전송
- 학생별 ROUND 2 이유 선택과 짧은 설명 저장
- 100점 만점 자동 채점, 힌트 감점, 종료 후 결과와 배지 공개
- Firebase 설정 전에도 한 기기에서 확인 가능한 데모 모드

## 설치와 로컬 실행

Node.js 20 이상을 권장합니다.

```bash
npm install
copy .env.local.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. Firebase 환경변수를 입력하지 않은 상태에서는 홈 화면의 `교사 데모`, `학생 데모` 버튼으로 화면을 확인할 수 있습니다.

## Firebase 설정

1. [Firebase Console](https://console.firebase.google.com/)에서 프로젝트를 만듭니다.
2. 프로젝트 설정에서 웹 앱을 추가하고 Firebase SDK 설정값을 확인합니다.
3. `Authentication > Sign-in method`에서 `익명` 로그인을 사용 설정합니다.
4. `Firestore Database`를 프로덕션 또는 테스트 모드로 생성합니다.
5. `.env.local.example`을 `.env.local`로 복사하고 값을 채웁니다.

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

예시 값(`your_api_key`, `your-project-id` 등)이 하나라도 남아 있으면 앱은 안전하게 데모 모드로 실행됩니다. 여섯 값을 모두 실제 Firebase 웹 앱 설정값으로 바꾼 뒤 개발 서버를 다시 시작해야 Firebase 모드가 활성화됩니다.

6. Firebase CLI를 사용한다면 저장소의 `firebase.json`과 `firestore.rules`를 사용해 규칙을 배포합니다.

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

현재 규칙은 로그인한 수업 참여자가 수업과 모둠 데이터를 읽고 갱신할 수 있도록 한 교실용 시작 규칙입니다. 실제 학교 운영에서는 교사 역할을 Custom Claims로 구분하고 수업 수정·채점 권한을 교사에게만 허용하는 방식으로 강화하는 것을 권장합니다.

## 입력 형식

문장은 위에서부터 정답 순서로 입력합니다.

```text
[1모둠]
모든 포유류는 숨을 쉰다.
고래는 포유류이다.
따라서 고래는 숨을 쉰다.
#연역

[2모둠]
지난 월요일에 본 백조는 흰색이었다.
오늘 본 백조도 흰색이었다.
따라서 백조는 대체로 흰색일 것이다.
#귀납
```

모둠 제목은 `[숫자모둠]`, 마지막 줄은 `#연역`, `#귀납`, `#유추` 중 하나여야 합니다.

## Firestore 구조

```text
classes/{classId}
classes/{classId}/teams/{teamId}
classes/{classId}/teams/{teamId}/members/{studentId}
classes/{classId}/teams/{teamId}/reports/{studentId}
```

모둠 문서의 `currentOrder`가 바뀌면 같은 모둠 학생과 교사 화면이 실시간으로 갱신됩니다.

교사와 학생은 서로 다른 브라우저나 기기에서 같은 입장 코드를 사용할 수 있습니다. 학생이 입장하면 `members`, 문장을 이동하거나 답을 선택하면 `teams`, 개인 설명을 제출하면 `reports`에 저장되며 모든 접속 화면이 `onSnapshot`으로 즉시 갱신됩니다.

## 점수 기준

| 항목 | 점수 |
|---|---:|
| 문장 배열 정확도 | 35점 |
| 논증 방법 정답 | 25점 |
| ROUND 2 이유 선택 | 20점 |
| ROUND 2 짧은 설명(10자 이상) | 10점 |
| 남은 시간 비례 보너스 | 최대 10점 |
| 힌트 사용 | -5점 |

ROUND 2 점수는 제출 학생들의 평균으로 계산합니다. 게임 중에는 순위를 표시하지 않고 교사가 게임을 종료한 뒤에만 결과를 공개합니다.

## Vercel 배포

1. 프로젝트를 GitHub 저장소에 올립니다.
2. [Vercel](https://vercel.com/)에서 저장소를 Import합니다.
3. Framework Preset은 `Next.js`를 선택합니다.
4. Project Settings의 Environment Variables에 `.env.local`과 같은 Firebase 환경변수를 등록합니다.
5. Deploy를 누릅니다.

Firebase Console의 `Authentication > Settings > Authorized domains`에 배포된 `*.vercel.app` 도메인이 포함되어 있는지 확인하세요.

### 배포 전 점검표

- Node.js 20 이상을 사용합니다. `package.json`의 `engines`에도 이 조건이 지정되어 있습니다.
- Vercel의 Production, Preview, Development 환경에 Firebase 환경변수 6개를 등록합니다.
- Firebase Authentication에서 익명 로그인을 활성화합니다.
- `firebase deploy --only firestore:rules`로 저장소의 Firestore 규칙을 배포합니다.
- Firebase Authentication의 승인된 도메인에 실제 Vercel 도메인을 추가합니다.
- `npm run build`가 로컬에서 성공하는지 확인합니다.
- `.env.local`은 Git에 올리지 않습니다. 저장소의 `.gitignore`에 이미 포함되어 있습니다.

## Firebase 실시간 동작 테스트

실제 수업 전에 교사 창과 학생 창을 서로 다른 브라우저 또는 시크릿 창으로 열어 다음 순서로 확인합니다.

1. 개발 서버를 실행합니다.

```bash
npm run dev
```

2. 첫 번째 브라우저에서 `http://localhost:3000`을 열고 `교사 수업 만들기`를 누릅니다.
3. 중복되지 않는 입장 코드와 모둠별 논증 글을 입력해 수업을 만듭니다.
4. 두 번째 브라우저 또는 시크릿 창에서 같은 주소를 열고 `학생 입장하기`를 누릅니다.
5. 교사가 만든 입장 코드, 학생 이름, 캐릭터와 모둠을 선택해 입장합니다.
6. 교사 화면의 해당 모둠에 학생 이름이 즉시 표시되는지 확인합니다.
7. 교사 화면에서 `ROUND 1 시작`을 누릅니다.
8. 학생 화면에서 문장 카드를 다른 위치로 드래그합니다.
9. 교사 화면의 문장 순서가 새로고침 없이 같은 순서로 바뀌는지 확인합니다.

Firebase Console에서는 다음 문서가 만들어졌는지 확인할 수 있습니다.

```text
classes/{classId}
classes/{classId}/teams/{teamId}
classes/{classId}/teams/{teamId}/members/{studentId}
classes/{classId}/teams/{teamId}/reports/{studentId}
```

홈 화면에 `Firebase 미설정` 안내나 데모 버튼이 보인다면 `.env.local`의 여섯 값을 확인하고 개발 서버를 다시 시작합니다.

## 명령어

```bash
npm run dev
npm run build
npm run start
```
