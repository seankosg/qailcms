
## 목표
SHAW PROJECT CMS의 사용자·권한 체계를 QAIL CMS에 이식한다. 역할은 기존 3단계에 `guest`만 추가, 소속(`user_type`)은 SHAW와 동일(subcontractor/hdec/pm_pd/admin), 모듈 세분 권한은 도입하지 않고 역할로만 통제, 로그인은 login_id 기반 + 최초 비밀번호 강제 변경(이메일은 시스템 내부 더미).

---

## 1. DB 마이그레이션

### 1-1. app_role enum 확장
- `guest` 값 추가 (`ALTER TYPE ... ADD VALUE 'guest'`)
- 최종 값: `guest / user / superuser / admin`

### 1-2. user_type enum 신설
- `CREATE TYPE public.user_type AS ENUM ('subcontractor','hdec','pm_pd','admin')`

### 1-3. profiles 컬럼 확장
- `login_id text UNIQUE NOT NULL` (기존 계정은 email local-part로 백필)
- `user_type public.user_type NOT NULL DEFAULT 'hdec'`
- `subcontractor_name text`, `hdec_pic_name text`
- `must_change_password boolean NOT NULL DEFAULT true`
- `is_active boolean NOT NULL DEFAULT true`
- 서브콘 1업체 1계정 partial unique: `WHERE user_type='subcontractor'`

### 1-4. Master 테이블 (계정 생성 시 name 선택용)
- `subcontractor_master(name unique, is_active)`
- `hdec_pic_master(name unique, is_active)`
- RLS: authenticated read, admin/superuser manage. GRANT 세트 포함.

### 1-5. 헬퍼 함수
- `has_any_role(_user_id, app_role[])` 추가
- 기존 `is_admin_or_super` 유지 (superuser 포함)

### 1-6. 트리거 갱신 (`handle_new_user`)
- `raw_user_meta_data`에서 `login_id / user_type / subcontractor_name / hdec_pic_name / must_change_password / role` 흡수
- profiles insert, user_roles insert (role 기본 `guest`)
- 첫 가입자만 admin (기존 로직 유지)

### 1-7. RLS 정책 업데이트 (모든 도메인 테이블)
- 대상: `spare_parts_raw`, `task_management_raw`, 각 `_import_logs`, `_import_row_logs`, `spare_part_change_log`, `task_management_status_history`, `spare_part_comments`, `spare_part_custom_fields`, `spare_part_status_history` 등
- 원칙:
  - **SELECT**: `authenticated` 전체 허용 (guest 포함, 읽기)
  - **INSERT/UPDATE**: `has_any_role(auth.uid(), ARRAY['user','superuser','admin'])`
  - **DELETE / rollback / master 관리 / mapping 관리**: `is_admin_or_super(auth.uid())`
  - guest는 편집/import/삭제 전부 차단
- profiles: 본인 SELECT + admin SELECT/UPDATE, self UPDATE는 `must_change_password/password` 관련만
- user_roles: 본인 SELECT, admin manage

---

## 2. Admin 서버 함수 (계정 라이프사이클)

`src/lib/admin/users.functions.ts` (모두 `requireSupabaseAuth` + admin 체크, 내부에서 `supabaseAdmin` 지연 로드)

- `createAppUser({ login_id, name, user_type, subcontractor_name?, hdec_pic_name?, role, temp_password })`
  - 더미 이메일 조립: `${login_id}@qail.local`
  - `supabaseAdmin.auth.admin.createUser({ email, password, email_confirm:true, user_metadata:{...} })`
  - 트리거가 profiles/user_roles 채움. 최종 role은 `user_roles`에 upsert로 지정
- `resetUserPassword({ user_id, temp_password })` — admin API로 password 재설정 + `must_change_password=true`
- `updateUserRole({ user_id, role })`
- `updateUserType({ user_id, user_type, subcontractor_name?, hdec_pic_name? })`
- `setUserActive({ user_id, is_active })`
- `deleteAppUser({ user_id })` — profiles/user_roles/auth.users 정리
- Master 관리: `addSubcontractor / addHdecPic / toggleActive / rename`

---

## 3. 로그인 흐름 재설계

### 3-1. 로그인 페이지 (`/auth`)
- Email 필드 → **ID** 필드로 교체 (`login_id`)
- 서버 함수 `resolveLoginEmail(login_id)` — profiles에서 email 조회 후 반환 (RLS는 anon SELECT용 좁은 view 또는 SECURITY DEFINER 함수)
- 그 email로 `supabase.auth.signInWithPassword({ email, password })`

### 3-2. 최초 비밀번호 강제 변경
- 신규 `/change-password` 페이지 (public 라우트, 세션 필요)
- `AuthGate` 계층에서 `profile.must_change_password === true`면 다른 어떤 라우트로도 이동 불가, 강제 리디렉트
- 변경 성공 시 `supabase.auth.updateUser({password})` + `must_change_password=false` 서버 함수

### 3-3. Signup 차단
- `supabase--configure_auth`로 `disable_signup=true` 설정. admin만 계정 생성 가능.

---

## 4. Guest 역할 UX 처리

- 사이드바에서 편집·Import·Admin 메뉴 숨김 (role check 유틸)
- 편집 셀·rollback 버튼·delete 버튼·import 화면 진입 시 role 가드
- Raw Data는 조회 전용으로 완전 사용 가능

프론트 훅: `useCurrentProfile()` — profile + roles 캐시 (React Query)
헬퍼: `canEdit()`, `canImport()`, `canAdmin()`

---

## 5. Admin > Users 화면 (신규)

`/admin/users` 라우트
- 사용자 목록 테이블: login_id, name, user_type, role, subcontractor/hdec_pic, is_active, must_change_password
- 필터: user_type, role, active
- 행 액션: 역할 변경, 소속/이름 편집, 임시 PW 재발급, 비활성/활성, 삭제
- 상단 "신규 계정" 버튼 → 폼 다이얼로그
  - subcontractor 선택 시 `subcontractor_master` 드롭다운, HDEC 선택 시 `hdec_pic_master` 드롭다운
  - 서브콘 unique 위반은 서버에서 friendly 에러
- 하단 탭: Subcontractor Master / HDEC PIC Master 관리

---

## 6. 롤아웃 순서
1. 마이그레이션 (enum·profiles·master·RLS·트리거)
2. Admin 서버 함수 + 프론트 훅
3. `/auth` 페이지 리팩터 + `/change-password`
4. `AuthGate` 강제 PW 변경 로직
5. `/admin/users` 화면 + 마스터 관리
6. 사이드바 role 가드 + 편집/Import/Rollback 버튼 가드
7. `disable_signup=true` 적용

---

## 파일 변경 예상
- 신규 마이그레이션 SQL 1개 (대규모)
- 신규 라우트: `src/routes/_authenticated/admin/users.tsx`, `src/routes/change-password.tsx`
- 신규: `src/lib/admin/users.functions.ts`, `src/lib/auth/resolveLoginEmail.functions.ts`, `src/hooks/useCurrentProfile.ts`, `src/lib/auth/roleGuards.ts`, `src/components/admin/UsersTable.tsx`, `SubcontractorMasterTable.tsx`, `HdecPicMasterTable.tsx`, `NewUserDialog.tsx`
- 수정: `src/routes/auth.tsx` (또는 현행 로그인 라우트), `src/components/layout/AppLayout.tsx` (메뉴 가드), 각 Raw Data 페이지의 편집/삭제/import 가드, `TaskManagementImportContext.tsx` / `SparePartImportContext.tsx` 진입 가드, 각 rollback/delete 버튼

---

## 검토 필요 사항
- 이메일 도메인 더미값: `@qail.local` 로 고정 (변경 원하면 알려주세요)
- guest 기본값: 신규 가입 자체를 막으므로 `handle_new_user`의 기본 role은 `guest`로 설정, admin이 즉시 조정. 첫 사용자만 admin.
