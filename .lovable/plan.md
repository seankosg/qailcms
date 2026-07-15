# Phase 2 계획: Auth / 라우팅 인프라 + spare_parts_raw Team 컬럼 확장

## 0. 선행 DB 보강 (Phase 1 마감 작업)

Phase 1은 완료되었으나, 사용자 지시에 따라 **spare_parts_raw에 team 컬럼을 지금 추가**합니다. 향후 Import·RLS·Field Config·Team 마스터 시딩 파이프라인이 spare_parts_raw도 동등하게 처리하도록 만들기 위함입니다.

- `alter table public.spare_parts_raw add column team text` (nullable, canonicalize 정책은 다른 Raw 4종과 동일하게 대문자)
- `create index idx_spare_parts_raw_team on public.spare_parts_raw (team)`
- `create trigger trg_spare_parts_raw_validate_team before insert or update of team on public.spare_parts_raw for each row execute function public.validate_team_code()` — 다른 Raw 테이블과 동일한 검증(대문자 canonicalize + team_master 존재 검증, null 허용)
- team_master 자동 시딩 SQL 및 Phase 4 Import canonicalize 파이프라인의 UNION 대상에 spare_parts_raw를 다시 포함(현재는 컬럼 부재로 제외됨). 초기값은 전부 NULL이므로 시딩 결과 변화 없음.
- Phase 7 RLS 재작성 시 spare_parts_raw도 team 기반 스코핑(`d_superuser` team 일치 등) 적용 대상에 편입.
- Field Config 및 컬럼 정의(`SPARE_PART_COLUMNS`)에는 아직 team을 노출하지 않음 — 사용자가 “이후에 구축”한다고 했으므로 스키마·정합성 인프라만 미리 심고, UI 노출은 별도 요청 시 진행.

## 1. 신규 파일

- `src/types/enums.ts`
  - `AppRole = 'admin'|'superuser'|'senior_user'|'user'|'super_guest'|'guest'|'d_superuser'`
  - `UserType = 'admin'|'pm_pd'|'hdec'|'subcontractor'|'subsub'|'guest'`
  - `ROLE_RANK: Record<AppRole, number>` — admin=100, superuser=90, senior_user=70, user=50, super_guest=30, guest=10, d_superuser=0 (별도 축)
  - `ROLE_LABELS`, `USER_TYPE_LABELS`
  - `PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{6,}$/`, `PASSWORD_HINT`, `DEFAULT_PASSWORD='Qail@2026!'`
  - `FAKE_EMAIL_DOMAIN='qail.local'`, `loginIdToEmail(loginId)`
- `src/lib/team/team-master.ts`
  - `useTeamOptions()` — React Query, staleTime 5분, `team_master` where `is_active=true` order by `sort_order, code`
  - `normalizeTeamCode(raw): string | null` — `upper(trim())`, 빈문자 → null
  - `matchTeamCode(raw, options): TeamOption | null` — 대소문자 무관 일치
- `src/lib/auth/roles.ts`
  - `highestRank(roles: AppRole[]): number`
  - `hasRank(user, minRole): boolean`
  - `canAccessRoute(user, path): boolean` — Phase 5 라우팅 매핑 대비 최소 매트릭스만 구현
  - `canEditRawRow(user, tableName, row): boolean` — 클라이언트 사전판정용 (서버는 `assertCanEdit`, Phase 7)
- `src/lib/auth/field-role-gate.ts`
  - `isAllowedByRoles(allowed: AppRole[] | null | undefined, userRoles: AppRole[]): boolean` — 빈배열/NULL = 제한없음, `admin` 항상 통과

## 2. 수정 파일

- `src/hooks/useCurrentUser.ts` — shape 확장
  - `name, team, subsubName, hdecEngName, subcontractorName, hdecPicName`
  - rank flags: `isAdmin, isSuperUser, isSeniorUser, isUser, isSuperGuest, isGuest, isDSuperUser`
  - `rank: number`, `canEdit: boolean`(rank ≥ senior_user)
  - `userType: UserType`, 기존 API 후방호환 유지
- `src/routes/_authenticated/route.tsx` — rank 기반 확장 여지만 확보(현재 auth 여부·is_active·must_change_password 체크는 유지). `d_superuser`는 통과, admin 하위 라우트에서 별도 차단은 admin route에서 처리.
- `src/routes/_authenticated/admin/route.tsx` — 기존 admin/superuser 허용 유지, `d_superuser` 차단 유지(계획 §Phase 0-6 재확인)
- `src/routes/change-password.tsx` — 비밀번호 정책을 `PASSWORD_REGEX`(SHAW 기준)로 통일. 힌트 문구 갱신. 기존 사용자 강제 재설정은 하지 않음(next-change 부터 적용).
- `src/lib/admin/users.functions.ts` — profile 신규 컬럼(`name, team, subsub_name, hdec_eng_name`) 조회·업데이트 반영. UI 재작성은 Phase 3에서 진행하므로 여기서는 서버 함수 시그니처만 확장.
- Team 하드코딩 셀렉트를 사용하는 곳(ABD 탭, Snag/SP/Task 필터 등)은 Phase 2에서 **정리 목록만 확정**하고, 실제 치환은 Phase 3~5 각 UI 재작성 시점에 함께 처리(하드코딩과 useTeamOptions가 잠깐 병존 허용).

## 3. Auth 미들웨어 / 클라이언트 부착

- `src/start.ts`의 `functionMiddleware`는 이미 project-specific bearer attacher가 있는지 확인 후, 없으면 `attachSupabaseAuth` 유지. 신규 도입 없음.
- 생성된 `auth-middleware.ts`, `auth-attacher.ts`, `client.ts`, `types.ts`는 편집 금지.

## 4. 검증

- 타입체크: `tsgo`
- 스모크: 로그인 → `/change-password` 정책 문구 확인, `useCurrentUser`가 확장 필드 반환하는지 devtools에서 확인
- Team 옵션 훅: `team_master`에서 ARCH/ELEC/MECH 3건 로드 확인
- spare_parts_raw: `insert ... team='mech'` 시 `MECH`로 정규화되고, 미등록 코드는 트리거가 거부하는지 확인
- 기존 admin 페이지·라우팅 회귀 없음

## 실행 순서

1. 마이그레이션: spare_parts_raw team 컬럼 + 인덱스 + 트리거 (Phase 1 마감)
2. `src/types/enums.ts`, `src/lib/team/team-master.ts`, `src/lib/auth/roles.ts`, `src/lib/auth/field-role-gate.ts` 신규 생성
3. `useCurrentUser` 확장, `change-password.tsx` 정책 갱신, `users.functions.ts` 필드 확장
4. 타입체크 + 스모크

## 다음 단계 예고

Phase 3(Admin Users/Masters UI 재작성 + Team 탭)에서 useTeamOptions와 확장된 useCurrentUser를 실제 화면에 연결합니다. spare_parts_raw team 컬럼의 UI 노출(Field Config 등록, 컬럼/필터/편집)은 별도 요청 시 진행합니다.