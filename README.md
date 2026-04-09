# bahEMR2 사전접수 포털

관계사(협력사)가 EMR 정식 접수 전 대상자 데이터를 수집·제출하는 웹 포털입니다.  
Cloudflare Workers + D1 (SQLite) + R2 (파일 스토리지) 기반으로 구동됩니다.

---

## 📁 전체 파일 구조

```
bahemr2/
├── wrangler.toml              ← Cloudflare Workers 설정
├── schema.sql                 ← D1 데이터베이스 스키마 (초기 실행용)
├── src/
│   ├── index.js               ← Workers 메인 라우터
│   ├── utils/
│   │   └── auth.js            ← JWT 서명/검증, 비밀번호 해시, 권한 헬퍼
│   └── routes/
│       ├── auth.js            ← 로그인, 회원가입, 관계사 공개 목록
│       ├── users.js           ← 사용자 CRUD (역할 변경, 비밀번호 변경)
│       ├── companies.js       ← 관계사 CRUD
│       ├── boards.js          ← 게시판 CRUD (슈퍼관리자 생성)
│       ├── posts.js           ← 게시글 CRUD + 접수 데이터 + CSV 내보내기
│       ├── comments.js        ← 댓글 CRUD (대댓글 지원)
│       ├── attachments.js     ← 파일 업로드(R2) / 다운로드 / 삭제
│       └── stats.js           ← 대시보드 통계 API
└── public/
    ├── index.html             ← 로그인 페이지
    ├── signup.html            ← 회원가입 페이지
    ├── dashboard.html         ← 대시보드 (SPA)
    ├── css/
    │   ├── auth.css           ← 로그인/회원가입 스타일
    │   └── dashboard.css      ← 대시보드 전체 스타일
    └── js/
        ├── api.js             ← API 클라이언트 (fetch 래퍼, JWT 자동 첨부)
        ├── auth.js            ← 로그인 스크립트
        ├── signup.js          ← 회원가입 스크립트
        └── dashboard.js       ← 대시보드 SPA 전체 컨트롤러
```

---

## 🚀 설치 및 배포 방법

### 1. 사전 준비

```bash
npm install -g wrangler
wrangler login
```

### 2. D1 데이터베이스 생성

```bash
wrangler d1 create bahemr-db
```

출력된 `database_id` 값을 `wrangler.toml`의 `database_id`에 붙여넣기:

```toml
[[d1_databases]]
binding = "DB"
database_name = "bahemr2-db"
database_id = "여기에_붙여넣기"
```

### 3. R2 버킷 생성

```bash
wrangler r2 bucket create bahemr-files
```

### 4. 스키마 초기화

```bash
# 로컬 개발용
wrangler d1 execute bahemr2-db --local --file=schema.sql

# 프로덕션 배포용
wrangler d1 execute bahemr-db --file=schema.sql
```

### 5. JWT 시크릿 설정 (프로덕션)

`wrangler.toml`의 `[vars]` 항목 JWT_SECRET을 강력한 랜덤 문자열로 교체하거나,  
Cloudflare 대시보드 > Workers > Settings > Environment Variables에 `JWT_SECRET` 설정

```bash
# 또는 CLI로 시크릿 설정
wrangler secret put JWT_SECRET
```

### 6. 배포

```bash
# 로컬 테스트
wrangler dev

# 프로덕션 배포
wrangler deploy
```

### 7. 슈퍼관리자 비밀번호 초기화

배포 후 슈퍼관리자 계정(`admin@bahemr.com`)의 초기 비밀번호를 설정해야 합니다.

```bash
# 비밀번호 해시 생성 스크립트 실행 (Node.js 환경)
node -e "
const pw = 'YOUR_ADMIN_PASSWORD';
const data = new TextEncoder().encode(pw + ':bahemr-salt');
crypto.subtle.digest('SHA-256', data).then(buf =>
  console.log(btoa(String.fromCharCode(...new Uint8Array(buf))))
);
"
```

생성된 해시를 D1에 업데이트:

```bash
wrangler d1 execute bahemr-db --command="UPDATE users SET password='생성된_해시' WHERE email='admin@bahemr.com'"
```

---

## 👤 역할(Role) 체계

| 역할 | 권한 |
|------|------|
| `superadmin` | 전체 관리, 게시판 생성, 사용자 역할 변경 |
| `admin` | 사용자 조회, 게시글 관리, 상태 변경 |
| `staff` | 접수 현황 조회, 상태 변경, 담당자 배정 |
| `partner` | 자기 소속 관계사 게시글만 열람/작성 |
| `pending` | 로그인 불가 (관리자 승인 대기) |

---

## 📋 주요 기능

### 게시판 기능
- **슈퍼관리자**: 게시판 생성/수정/삭제 (유형: 일반/공지/접수)
- **게시글**: 작성, 수정, 삭제, 조회수, 고정(핀)
- **첨부파일**: R2 업로드/다운로드, 파일 타입 검증, 20MB 제한, 게시글당 10개
- **댓글**: 작성, 수정, 소프트 삭제, 대댓글 지원

### 접수(Reception) 게시판 특화 기능
- **구조화된 접수 폼**: 환자명, 생년월일, 성별, 연락처, 국적
- **신분증 종류**: 여권, 외국인등록증, 신분증, Shore Pass (상륙증)
- **해운 특화**: 선박명, 입항지 필드
- **접수 상태 관리**: 제출 → 검토중 → 접수완료 / 반려
- **담당자 배정**: staff/admin 계정으로 배정
- **처리 이력**: 상태 변경 시간/담당자 로그
- **CSV 내보내기**: Excel 호환 UTF-8 BOM, 전체 접수 데이터

### 관계사 격리
- `partner` 역할 사용자는 자신의 소속 관계사 게시글만 열람/작성
- `staff` 이상은 전체 관계사 데이터 열람 가능

### 대시보드
- 전체 통계 (사용자 수, 게시판 수, 게시글 수)
- 접수 상태별 현황 바 차트
- 최근 게시글 목록

---

## 🔒 보안 고려사항

1. **비밀번호**: SHA-256 기반 해싱 (실무 배포 시 bcryptjs 교체 권장)
2. **JWT**: HS256, 7일 만료, 서버 시크릿으로 서명
3. **파일 업로드**: MIME 타입 화이트리스트, 20MB 제한
4. **권한 분리**: API 레벨에서 역할 기반 접근 제어
5. **XSS 방지**: 프론트엔드 `esc()` 함수로 모든 출력 이스케이프
6. **관계사 격리**: partner 역할은 company_id 기반 데이터 분리

---

## 📡 API 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/signup` | 회원가입 |
| GET | `/api/auth/companies-public` | 관계사 목록 (비인증) |
| GET | `/api/users` | 사용자 목록 (admin+) |
| PATCH | `/api/users/:id` | 사용자 수정 (superadmin) |
| GET | `/api/companies` | 관계사 목록 (admin+) |
| POST | `/api/companies` | 관계사 생성 (superadmin) |
| GET | `/api/boards` | 게시판 목록 |
| POST | `/api/boards` | 게시판 생성 (superadmin) |
| GET | `/api/posts?board_id=` | 게시글 목록 |
| POST | `/api/posts` | 게시글 작성 |
| GET | `/api/posts/:id` | 게시글 상세 |
| PATCH | `/api/posts/:id` | 게시글 수정/상태변경 |
| DELETE | `/api/posts/:id` | 게시글 삭제 |
| GET | `/api/posts/export` | CSV 내보내기 (staff+) |
| GET | `/api/comments?post_id=` | 댓글 목록 |
| POST | `/api/comments` | 댓글 작성 |
| PATCH | `/api/comments/:id` | 댓글 수정 |
| DELETE | `/api/comments/:id` | 댓글 삭제 |
| POST | `/api/attachments/upload` | 파일 업로드 |
| GET | `/api/attachments/:id/download` | 파일 다운로드 |
| DELETE | `/api/attachments/:id` | 파일 삭제 |
| GET | `/api/stats/dashboard` | 대시보드 통계 |
