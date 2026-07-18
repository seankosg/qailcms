# HDEC/Subcontractor/Sub-Sub Owner 통합 권한 로직 (확정본 v2)

## 배경

- `profiles.name`, `hdec_pic_name`, `hdec_eng_name`, `subcontractor_name`, `subsub_name` 이미 존재.
- 4개 Raw 테이블(`abd_items_raw`, `defect_items_raw`, `spare_parts_raw`, `task_management_raw`)에 대응 이름 컬럼 존재.
- 서버 mutation은 `assertAdmin`만 사용 → 클라 UI와 서버 정책 불일치.
- Import는 현재 admin/superuser 전용.

## 확정된 결정사항

1. 업로드 owner 밖 행: **자동 스킵 + rejected 로그**.
2. 레거시 `user_type='hdec'`: 즉시 `hdec_pic`/`hdec_eng`로 자동 분류. 사용자 편집 화면에서 재편집 가능.
3. 상위 rank(admin/superuser/d_superuser)가 HDEC/Sub 계정을 겸직하면 **rank 우선, owner 제한 미적용**.
4. `d_superuser` 전체 편집 승격, `senior_user`의 전체 편집 회수.
5. **`owner_user_id` FK 도입** (이름 문자열 매칭 병행 유지).
6. **Subcontractor / Sub-Sub owner 규칙 포함** (하부 포함).

## 역할 서열 재정의 (`src/types/enums.ts`)

| Role | 기존 | 신규 |
|---|---|---|
| admin | 100 | 100 |
| superuser | 90 | 90 |
| **d_superuser** | **0** | **80** |
| senior_user | 70 | 70 |
| user | 50 | 50 |
| super_guest | 30 | 30 |
| guest | 10 | 10 |

`UserType` enum: `hdec_pic`, `hdec_eng`, `subcontractor`(기존 유지), `subsub`(기존 유지) 유지. `hdec_pic`, `hdec_eng` 신규 추가.

## Owner 정의 (단일 소스)

행 owner ≡ 다음 중 하나 (OR):

- `owner_user_id = auth.uid()` (신규 FK — 우선 매칭)
- `user_type='hdec_pic'` AND `profile.name = row.hdec_pic_name`
- `user_type='hdec_eng'` AND `profile.name = row.hdec_eng_name`
- `user_type='subcontractor'` AND `profile.subcontractor_name = row.subcontractor_name`
- `user_type='subsub'` AND `profile.subsub_name = row.subsub_name`
- (하위호환 — 마이그레이션 후 잔여) `user_type='hdec'` AND (`profile.hdec_pic_name` 또는 `hdec_eng_name` 매칭)

## 권한 매트릭스

| 역할 | 편집/삭제 | 업로드 |
|---|---|---|
| admin / superuser / d_superuser | 전체 | 전체 |
| senior_user (HDEC/Sub 겸직) | owner 행만 | owner 행만, 그 외 자동 스킵 |
| user (HDEC/Sub 겸직) | owner 행만 | **불가** |
| super_guest / guest | 불가 | 불가 |

## 구현 계획

### 1. 타입/enum

- `src/types/enums.ts`
  - `ROLE_RANK.d_superuser = 80`.
  - `UserType`에 `"hdec_pic" | "hdec_eng"` 추가.

### 2. DB 마이그레이션 (`supabase--migration`, 단일 파일)

**Step A. enum 확장**
- `user_type`에 `hdec_pic`, `hdec_eng` 값 추가.

**Step B. `owner_user_id` FK 컬럼 추가 (4개 Raw 테이블)**
- `abd_items_raw`, `defect_items_raw`, `spare_parts_raw`, `task_management_raw` 각각:
  - `owner_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL`
  - `CREATE INDEX idx_<table>_owner_user_id ON public.<table>(owner_user_id)`

**Step C. 백필**
- 각 Raw 테이블에서 이름 컬럼으로 `profiles`와 조인해 `owner_user_id` 채움.
  - 우선순위: `hdec_pic_name` → `hdec_eng_name` → `subcontractor_name` → `subsub_name`.
  - 매칭 다중이면 (동명이인) `owner_user_id` NULL 유지, 이름 매칭 fallback 사용.

**Step D. 레거시 `hdec` 재분류 (profiles UPDATE)**
- `hdec_pic_name` 유효 → `hdec_pic`.
- `hdec_eng_name`만 유효 → `hdec_eng`.
- 둘 다 유효 → `hdec_pic` 통일(관리자 목록에 배지 노출용 플래그는 미도입, `admin/users`에서 편집 유도).
- 둘 다 무효 → `hdec_pic` 유지(name 매칭 fallback).

**Step E. SQL 헬퍼 함수**
- `is_full_access(_user_id uuid) returns boolean` — admin/superuser/d_superuser 판정 (SECURITY DEFINER, search_path=public, EXECUTE TO authenticated).
- `is_row_owner(_user_id uuid, _owner_user_id uuid, _hdec_pic text, _hdec_eng text, _subcon text, _subsub text) returns boolean` — 위 owner 정의 구현.
- `has_any_role(_user_id uuid, _roles app_role[]) returns boolean` — 이미 있으면 재사용, 없으면 생성.

**Step F. `owner_user_id` 자동 유지 트리거 (INSERT/UPDATE)**
- 4개 테이블 각각 BEFORE INSERT/UPDATE 트리거:
  - `owner_user_id`가 명시적으로 세팅되지 않았거나 관련 이름 컬럼이 변경된 경우, `profiles`에서 유일하게 매칭되는 사용자를 찾아 자동 세팅. 다중 매칭 시 NULL.

### 3. 서버 헬퍼

`src/lib/auth/roles.ts`:
- `isFullAccess(user)` — admin/superuser/d_superuser.
- `isOwnerOfRow(user, row)` — `owner_user_id === user.id` 우선, 이후 user_type별 이름 매칭 (HDEC PIC/ENG/Subcon/Subsub 포함).
- `canEditRawRow(user, table, row)`: full-access true, senior/user는 owner, 그 외 false.
- `canDeleteRawRow` 동일.
- `canImportOwnRow(user, incomingRow)`: full-access true, senior_user는 owner, user 이하 false.

`src/lib/auth/roles.server.ts` (신규 또는 확장):
- `assertCanEditRow(ctx, table, rowId)` — 행 조회 후 full-access/owner 판정. RPC `is_row_owner` 사용.
- `assertCanEditRowsBulk(ctx, table, ids)` — 대량 시 owner 필터 SQL로 처리, 스킵 id 반환.

### 4. 서버 mutation 재검증

`assertAdmin` → `assertCanEditRow`/`assertCanEditRowsBulk`로 교체:
- `src/lib/defect-management/mutations.functions.ts`
- `src/lib/abd/mutations.functions.ts`
- Spare Part / Task Management 동등 함수

대량 UPDATE/DELETE는:
```sql
UPDATE ... WHERE id = ANY($ids) AND (is_full_access($uid) OR is_row_owner(...))
```
로 owner 필터를 SQL 레벨에서 적용하고 실제 반영된 id / 스킵 id를 반환.

### 5. Import Context 4종

- 시작 시 `useCurrentUser()`로 판단:
  - `user` 단독 → 업로드 버튼 비활성.
  - `guest/super_guest` → 차단.
- 배치 upsert 직전 각 행에 `canImportOwnRow` 판정. false 행은 rejected 배열로 이동 + `*_import_row_logs`에 `action_taken='rejected'`, `reason='ownership_mismatch'` 로그.
- 파일 카드에 "권한 밖 스킵" 카운트 표시.

### 6. Raw Data UI (4개 도메인)

- 인라인 편집/벌크 편집/삭제: `canEditRawRow` 반영. 비owner 셀은 비활성 + 툴팁("본인이 HDEC PIC/ENG 또는 Subcontractor/Sub-Sub로 지정된 행만 편집 가능합니다.").
- 벌크 선택 시 비owner 행 안내 배너("선택 N건 중 M건 권한 없음, 자동 제외").

### 7. 관리자 사용자 편집 (`admin/users.tsx`)

- `user_type` 옵션에 `hdec_pic`, `hdec_eng` 추가.
- 편집 폼에 `hdec_pic_name`, `hdec_eng_name`, `subcontractor_name`, `subsub_name` 노출/저장.
- `user_type` 선택에 따라 관련 이름 필드만 필수/강조 표시.
- 레거시 `hdec` 계정: 리스트 배지 "재분류 필요", 편집 저장 시 `user_type`을 신규 값으로 강제.

### 8. useCurrentUser 확장

- 반환값에 `isFullAccess` 추가.

### 9. 검증

- admin/superuser/d_superuser: 전체 편집/삭제/업로드 통과.
- senior_user + hdec_pic(`name='홍길동'`): `hdec_pic_name='홍길동'` OR `owner_user_id=본인` 행만 접근 가능.
- senior_user + subcontractor: `subcontractor_name` 일치 또는 owner_user_id 일치 행만.
- user + subsub: 편집/삭제만, 업로드 불가.
- 대량 편집에서 스킵 id 결과 확인.
- 백필 후 `owner_user_id` NOT NULL 비율 스팟체크(SELECT count(*) FILTER (WHERE owner_user_id IS NOT NULL)).
- `tsgo` 통과.

## 스코프 밖

- RLS 정책 재작성(현 단계는 서버 함수 재검증 + `owner_user_id` FK 도입까지. RLS 강화는 후속).
- Cat A / HDEC Verification lock 필드 규칙(현행 유지).
- 동명이인 owner 자동 매칭 UI 툴(다중 매칭 시 NULL, 관리자가 사용자 편집 화면에서 명시적으로 이름 정정).
