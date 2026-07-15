
# SHAW CMS 권한·사용자 시스템 이식 최종 계획 v2 (확정판)

## Phase 0 최종 확정 사항

1. **RLS 데이터 스코핑 적용** (Phase 7 필수)
2. **비밀번호 정책 = SHAW 기준**: `/^(?=.*[A-Za-z])(?=.*\d).{6,}$/`, `DEFAULT_PASSWORD='Qail@2026!'`. 기존 사용자 강제 재설정 없음 (다음 변경 시부터 신 정책 적용)
3. **Raw Data 편집 권한 = 하이브리드**: rank ≥ `senior_user` 전체 편집. `user` 는 PIC(hdec_pic_name / hdec_eng_name / subcontractor_name / subsub_name 중 profile 값과 일치) 행만 편집
4. **Field-Level Role Gate 관리 UI 구현** (Phase 6, §7)
5. **Team = team_master 테이블화** (Raw Data 4종 + profiles 와 연동, 향후 추가/편집 가능, 대소문자 무관 매칭)
6. **Admin 접근 = admin/superuser 만** (`d_superuser` 는 admin 접근 불가 유지)
7. **Team 마스터 초기 시딩 = 현재 DB 4개 Raw 테이블의 distinct team 값 자동 시딩** (대문자 canonicalize 후 upsert)

---

## 1. DB 스키마 (Phase 1)

**Enum 확장**
- `app_role` : + `super_guest, senior_user, d_superuser` → 7단계 rank
- `user_type` : + `subsub, guest`

**신규 `team_master`**
```sql
create table public.team_master (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index team_master_code_lower_uk on public.team_master (lower(code));

GRANT SELECT ON public.team_master TO authenticated;
GRANT ALL ON public.team_master TO service_role;
ALTER TABLE public.team_master ENABLE ROW LEVEL SECURITY;
-- SELECT: authenticated 전원, INSERT/UPDATE/DELETE: admin/superuser
```

**초기 시딩 (자동)**
```sql
insert into public.team_master (code, name)
select upper(trim(team)) as code, upper(trim(team)) as name
  from (
    select team from public.abd_items_raw where team is not null and team <> ''
    union select team from public.defect_items_raw where team is not null and team <> ''
    union select team from public.spare_parts_raw where team is not null and team <> ''
    union select team from public.task_management_raw where team is not null and team <> ''
  ) s
 group by upper(trim(team))
on conflict (lower(code)) do nothing;
```
+ Raw 4개 테이블 및 profiles.team 값 대문자 canonicalize (`update ... set team = upper(trim(team))`).

**정합성 트리거** `validate_team_code()` — profiles + 4개 Raw 테이블 BEFORE INSERT/UPDATE OF team: 대문자 정규화 + team_master 존재 검증

**profiles 컬럼 추가**: `name text`, `team text`, `subsub_name text`, `hdec_eng_name text`

**subcontractor_master 확장**: `type ('sub'|'subsub')`, `parent_subcontractor_id`, `owner_code`, 부모 검증 트리거

**신규 `hdec_eng_master`** (hdec_pic_master 구조 복제)

**4개 field_config 테이블 role 배열**
- `visible_to_roles app_role[] NOT NULL DEFAULT '{}'`
- `editable_to_roles app_role[] NOT NULL DEFAULT '{}'`

**신규 RPC** `can_edit_row(_user_id uuid, _table_name text, _row_id uuid)` — profile 조회 + rank + PIC 규칙 판정

---

## 2. Auth / 라우팅 인프라 (Phase 2)

**신규**
- `src/types/enums.ts` — `AppRole, UserType, ROLE_LABELS, USER_TYPE_LABELS, PASSWORD_REGEX(SHAW), PASSWORD_HINT, DEFAULT_PASSWORD, FAKE_EMAIL_DOMAIN='qail.local', loginIdToEmail, ROLE_RANK`
- `src/lib/team/team-master.ts` — `useTeamOptions()` (5분 캐시), `normalizeTeamCode(raw)`, `matchTeamCode(raw, options)`
- `src/lib/auth/roles.ts` — `canAccessRoute, canEditRawRow, highestRank`
- `src/lib/auth/field-role-gate.ts` — `isAllowedByRoles(allowedRoles, userRoles)` (빈 배열 = 제한없음, admin 항상 통과)

**수정**
- `useCurrentUser` shape 확장 (rank flags + team + master 이름 필드 + canEdit)
- `_authenticated/route.tsx` — rank 기반 route 체크
- `AppLayout` nav rank 기반 통합
- `change-password.tsx` — SHAW 정책
- `admin/users.functions.ts` — profile 신규 필드 반영

**Team 셀렉트 통합**: Admin Users 편집, ABD tabs, Snag/SP/Task 필터 등 하드코딩된 팀 리스트 전부 `useTeamOptions()` 로 대체

---

## 3. Admin UI (Phase 3)

**`/admin/users`** — SHAW UsersTab 수준 재작성
- 컬럼: Login ID / Name / User Type / Team / Linked Master / Owner Code / Role / Active / Actions
- Login ID 인라인 편집, PW 재발급(신 정책), Excel Export, 완전 삭제
- user_type 별 조건부 렌더

**`/admin/masters`** — Sub / SubSub / HDEC PIC / HDEC Eng / **Team** 통합 UI
- Team 탭: code/name/sort_order/is_active. 신규 등록 시 대문자 canonicalize. 사용중 team 비활성화 시 사용 건수 안내 후 확인.

**신규 서버 함수**: `updateLoginId`, `addMasterName/toggleMasterActive/deleteMasterName` (`kind: 'subcontractor'|'subsub'|'hdec_pic'|'hdec_eng'|'team'`), `updateFieldConfigRoles`

---

## 4. Import 마스터 정합성 (Phase 4)

- `src/lib/master/master-name-match.ts` (Levenshtein, normalize)
- `src/lib/master/subcontractor-master-sync.ts`
- `SimilarMasterDecisionDialog.tsx` — 4개 Import 파이프라인(ABD/Snag/SP/Task)
- **Team 컬럼**: Import 시 `normalizeTeamCode` 로 대문자화 → team_master 미존재 시 관리자에게 "새 team 추가?" 다이얼로그 → 승인 시 team_master upsert

---

## 5. 컴포넌트 게이팅 정렬 (Phase 5)

**canAccessRoute 매핑**
- `/*/dashboard, /outstanding/dashboard, /closeout/dashboard` → guest+
- `/closure/*/raw-data, /tree, /records/*, /detail/*` → super_guest+
- `/import-log/*, /closure/*/import, aconex-sync` → user+
- `/closure/*/settings, /admin/*` → superuser+ (d_superuser 불가)

**편집 게이트**: 4개 Raw Data 의 `EditCellPopover, BulkEditBar, CriticalBulkBar, ColumnOrderMenu` 등에서 `me?.isAdmin` → `me?.canEdit || canEditRawRow(me, row)` 로 대체. Bulk selection 은 프론트 필터 + 서버 재검증

---

## 6. RLS 데이터 스코핑 (Phase 7)

**Security Definer RPC** `can_view_row / can_edit_row`

**4개 Raw 테이블 정책**
- SELECT: admin/superuser/senior_user/user/super_guest/guest 전체 · d_superuser team 일치 · subcontractor 회사 일치 · subsub 일치
- UPDATE/DELETE: admin/superuser/senior_user 전체 · d_superuser team 일치 · user PIC 일치 · 나머지 불가
- INSERT: admin/superuser/senior_user

**서버 함수 검증**: `updateDefectField/bulkUpdate*/updateAbdField/updateSparePartField/updateTaskField` 에서 `assertAdmin` → `assertCanEdit(supabase, userId, table, rowId)`

**사전 정규화**: subcontractor/hdec_pic/hdec_eng/subsub/team 값 canonicalize

**성능 인덱스**: 각 Raw 테이블에 `(team), (subcontractor_name), (hdec_pic_name), (hdec_eng_name), (subsub_name)` 인덱스

---

## 7. Field-Level Role Gate 관리 UI (Phase 6)

### 7-1. 저장 스키마
각 `*_field_config` 테이블에 `visible_to_roles app_role[]`, `editable_to_roles app_role[]` (DEFAULT `'{}'`).
빈 배열/NULL = 제한없음, 배열 값 있으면 배열 포함 role 만 통과, `admin` 은 항상 통과 (하드코딩).

### 7-2. 위치
기존 `/admin/mapping` 하위 4개 Field Config 테이블(`FieldConfigTable, DefectFieldConfigTable, SparePartFieldConfigTable, TmFieldConfigTable`) 을 확장. 새 라우트 없음.

### 7-3. UI 컬럼
Sort Order / Field Name(RO) / Display Name / Group / Visible / **Visible Roles** / **Editable Roles** / Note / Actions

**RoleMultiSelect 컴포넌트**: Popover + Command 체크박스, 선택된 role Badge chip, `Clear all / Select all editors / Select all viewers` 프리셋, `admin` always allowed 회색+툴팁, 변경 시 debounce 500ms → `updateFieldConfigRoles`, optimistic + rollback

**Preview as role**: admin 전용, 특정 role 시점에서 필드 상태(숨김/읽기/편집) 미리보기

### 7-4. Raw Data 연동
- `buildColumns` 시 visible gate 실패 → 컬럼 제거 (ColumnOrderMenu 에서도 숨김)
- editable gate 실패 → EditCellPopover 진입 차단, BulkEditBar field 옵션 제외

### 7-5. Detail Sheet / Export
동일 gate 적용. Admin 은 항상 전체 export 가능.

### 7-6. 초기 시딩
모든 필드 두 컬럼 빈 배열 → 기존 동작 100% 후방호환. 이후 관리자가 점진적으로 좁힘.

---

## 8. Raw Data 기존 로직 영향

| 영역 | 조치 |
|---|---|
| Team 하드코딩 목록 | `useTeamOptions()` 로 대체 |
| Nav / route guard | rank 통합 + fallback |
| 4개 Raw Data 편집 게이트 | `canEditRow` 대체, 서버 `assertCanEdit` |
| Bulk 편집/삭제 | selection 필터 + 서버 재검증 |
| Import | 마스터+team canonicalize, 유사이름/신규team 다이얼로그 |
| RLS | 4개 Raw 정책 재작성, 사전 데이터 정규화 필수 |
| Field Config UI | Roles 컬럼 2개 추가 |
| Detail Sheet / Export | field gate 연동 |
| Change Password | 정책 통일 (강제 재설정 없음) |
| Admin Users/Masters | SHAW 수준 재작성 + Team 탭 |

---

## 9. 실행 순서

1. **Phase 1** DB: enum + team_master + profile 컬럼 + subcontractor 확장 + hdec_eng_master + field_config roles + validate 트리거 → types.ts 재생성 → team/master 자동 시딩
2. **Phase 2** enums.ts / roles.ts / field-role-gate.ts / team-master hook / useCurrentUser / route guard / change-password
3. **Phase 3** Admin Users 재작성 + Masters(Team 포함) UI
4. **Phase 4** Master + Team canonicalize 라이브러리 → Import 다이얼로그 통합
5. **Phase 5** 편집 게이트 정렬
6. **Phase 6** Field-Level Role Gate UI
7. **Phase 7** 데이터 정규화 → RLS 정책 재작성 → assertCanEdit → 회귀 테스트

각 Phase 독립 커밋. 매 단계마다 4개 Raw Data + Detail + Import + Admin 회귀 검증.
