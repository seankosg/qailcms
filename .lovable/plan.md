
## 목표

Task Management Raw Data 페이지에서 각 사용자가 조절한 컬럼 표시/순서/너비/고정/정렬/필터/검색어 설정을, 새로고침·재로그인·기기 변경 시에도 그대로 유지되도록 서버(Lovable Cloud) 저장 방식으로 전환한다.

## 배경

- 현재 `TaskManagementRawDataPage.tsx`는 `qail.task-management.raw-data.v1:{userId}` 키로 localStorage에만 저장.
- 재로그인·다른 브라우저·시크릿 모드·캐시 초기화 시 손실.
- 또한 `currentUser`가 늦게 도착하면 `storageKey`가 늦게 설정되어 초기화 레이스가 발생.

## 스토리지 설계

### 새 테이블 `public.user_view_preferences`

행 단위 = 사용자 × 화면(view). 여러 페이지에서 재사용 가능하도록 일반화.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `user_id` | uuid | FK `auth.users.id` (PK 일부) |
| `view_key` | text | PK 일부. 예: `task-management.raw-data.v1` |
| `state` | jsonb | `{ sorting, sizing, visibility, columnFilters, globalFilter, order, frozenExtras }` |
| `updated_at` | timestamptz | trigger `set_updated_at` |

- PK: `(user_id, view_key)`
- RLS 정책 4종: SELECT/INSERT/UPDATE/DELETE 모두 `auth.uid() = user_id`
- GRANT: `authenticated` 에 SELECT/INSERT/UPDATE/DELETE, `service_role` ALL
- `anon` 접근 없음

### Server Functions (createServerFn, `requireSupabaseAuth`)

`src/lib/task-management/user-view-preferences.functions.ts`
- `getUserViewPreference({ viewKey })` → `state | null`
- `upsertUserViewPreference({ viewKey, state })` → `ok`

### 클라이언트 훅

`src/hooks/useUserViewPreference.ts`
- TanStack Query 로 `["user-view-pref", viewKey, userId]` 캐시
- 로컬 캐시(localStorage) 를 `initialData` 로 사용 → 서버 응답 도착 전 즉시 이전 설정 렌더 (오프라인/느린 네트워크에서도 깜빡임 없음)
- `mutate(state)` 는 300–500ms debounce 로 서버 upsert + 로컬 캐시 동기화
- 서버 우선 정책: 서버 응답이 도착하면 로컬 캐시를 덮어써 다른 기기 변경분을 반영

## 페이지 통합

`src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
- 기존 localStorage load/save `useEffect` 2개 제거
- `useUserViewPreference("task-management.raw-data.v1")` 로 교체
- 로드 완료 시 기존과 동일한 검증/병합 로직(신규 컬럼 자동 삽입, 유효 키 필터, 3개 이하 freeze 제한 등)을 재사용 → helper 로 분리해 훅 안에서 실행
- `collapsedParents` 는 계정 무관 UI 상태이므로 localStorage 유지

## 마이그레이션 (호환성)

- 첫 로드 시 서버 응답이 `null` 이면 기존 localStorage 값을 읽어 서버에 upsert 후 사용 → 사용자별 기존 튜닝 손실 방지

## 인프라 확인 사항

- `src/start.ts` 의 `functionMiddleware` 에 Supabase bearer attacher 가 이미 등록되어 있는지 확인, 없으면 append.
- Raw Data 페이지는 `_authenticated/` 하위에 있으므로 loader가 아닌 컴포넌트에서 호출 → 안전.

## 파일 변경 목록

- 신규 migration: `user_view_preferences` 테이블 + GRANT + RLS + 정책 + `set_updated_at` 트리거
- 신규: `src/lib/task-management/user-view-preferences.functions.ts`
- 신규: `src/hooks/useUserViewPreference.ts`
- 수정: `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` (persist 로직 훅으로 교체)
- (필요 시) 수정: `src/start.ts` — bearer middleware 등록 확인
