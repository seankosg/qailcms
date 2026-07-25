# MWS/MTWS Snag 데이터 근원 해결 (Step 1 + Step 2 + 전체 탭 리다이렉트)

## 목표
- Admin/일반 사용자 모두 MWS/MTWS의 Snag(SM) 카드에서 오늘/지연/임박/진행중 카운트가 **정확**하도록 개선.
- 대용량(수만 건)에서도 브라우저 부담 없이 **서버에서 판정/카운트**.
- **전체(All) 탭은 UI에 유지**하되, 클릭 시 즉시 **SM Raw Data 페이지로 이동** (별도 안내 문구 없음, PIC/Team 필터 자동 적용).

## 범위
- 대상 카드: MWS(`scope="pic"`), MTWS(`scope="team"`)의 **Snag(SM)** 컴포넌트만.
- TM, ABD 카드는 이번 범위에서 **변경 없음**.

## 구현 단계

### Step 1 — 즉시 증상 완화 (Snag 상한 제거)
- `src/hooks/useMyWorkspaceData.ts`
  - `useMyDefects`가 사용하는 `TM_LIMIT_USER=2000 / TM_LIMIT_ADMIN=5000` 상한 제거 (Snag만, TM/ABD는 유지).
  - 페이지 루프를 상한 없이 끝까지 진행 (마지막 페이지 감지 시 종료).
- 목적: Step 2 배포 전이라도 Admin이 최소한 5,000건 상한에 걸려 잘리는 문제를 해소.

### Step 2 — 서버 판정 RPC 도입 (근본 해결)
DB에서 오늘/지연/임박/진행중을 계산해 **필요한 행만** 반환.

#### 2-1. RPC 신설 (migration)
- `sm_my_workspace_counts(_mode text, _filter_value text, _today date)`
  - 반환: `today_count`, `delayed_count`, `upcoming_count`, `in_progress_count`, `completed_count`, `total_count`.
  - 판정 로직은 프론트의 `smIsCompleted / smIsDelayed / smIsInProgress / smIsUpcoming / smTodayKinds`와 1:1 매칭.
- `sm_my_workspace_rows(_mode text, _filter_value text, _today date, _bucket text, _limit int, _offset int)`
  - `_bucket ∈ ('today','delayed','upcoming','in_progress','completed')`.
  - 각 버킷에 해당하는 행만 반환 (기존 `SmMyRow`와 동일한 컬럼셋).
  - Admin(`_mode='admin'`)일 때 필터 미적용, 아니면 `hdec_pic_name` 또는 `team` 기준 필터.
- 판정 상수:
  - `SM_CLOSED = ('closed','verified')`, `SM_RECTIFIED = ('rectified','complete','completed')`, 진행중 상태 문자열도 SQL LOWER/TRIM으로 동일하게 매칭.
  - `upcoming_days = 3` (프론트 기본값과 동일).
- GRANT: `authenticated`, `service_role`.
- RLS: `defect_items_raw`의 기존 정책을 그대로 상속 (SECURITY INVOKER).

#### 2-2. 훅 재설계
- `src/hooks/useMyWorkspaceData.ts`
  - `useMyDefectsCounts(mode, filterValue, isAdmin, today)` → `sm_my_workspace_counts` 호출.
  - `useMyDefectsBucket(mode, filterValue, isAdmin, today, bucket, enabled)` → `sm_my_workspace_rows` 호출 (탭 활성 시에만 fetch).
  - 기존 `useMyDefects` 훅은 **전체 탭 제거가 아닌 리다이렉트 방식**을 채택하므로, 다른 사용처 확인 후 남겨두거나 내부적으로 카운트/버킷 조합으로 대체.

#### 2-3. Snag 카드 UI 갱신
- `src/components/my-work-space/*` (Snag 담당 컴포넌트, 예: `ModuleKpiCard` / `ModuleRowList` 및 상위 페이지)
  - 탭별 카운트는 `sm_my_workspace_counts` 결과 사용.
  - 각 탭의 리스트는 해당 탭이 선택된 순간에만 `sm_my_workspace_rows`로 fetch (staleTime 60초 유지).

### Step 3 — 전체(All) 탭 리다이렉트
- MWS/MTWS의 Snag 카드에서 **탭 UI 자체는 유지**.
- "전체(All)" 탭을 클릭하면:
  - `scope="pic"` → `/closure/snag-management/raw-data?hdecPic=<현재 사용자>`
  - `scope="team"` → `/closure/snag-management/raw-data?team=<현재 팀>`
  - Admin: 별도 필터 없이 `/closure/snag-management/raw-data`.
- 라우팅은 `@tanstack/react-router`의 `useNavigate` 또는 `<Link to params search>` 사용, 별도 안내 문구/모달 없음.
- 전체 탭에서는 카운트/리스트를 fetch하지 않음 (클릭 시 즉시 이동).

## 검증
- Admin 로그인 후 MTWS Snag 카드:
  - 오늘/지연/임박 카운트가 SM Raw Data의 실제 값과 일치하는지 spot check.
  - 각 탭 클릭 시 서버에서 해당 버킷만 내려오는지 네트워크 확인.
  - "전체" 탭 클릭 시 SM Raw Data로 이동, 팀/PIC 필터가 URL search에 반영되는지 확인.
- 일반 사용자(PIC) 로그인:
  - MWS Snag 카드가 본인 항목만, 카운트/리스트 정확성 확인.
- 5,000건 상한 이슈 재현되지 않는지 확인.

## 기술 노트
- 서버 판정으로 옮기는 유일한 모듈은 SM. TM/ABD의 기존 `useMyTasks / useMyAbd`는 변경하지 않음.
- 데이터 정합성을 위해 `today`는 프론트에서 `todayInDoha()`로 계산해 RPC에 전달 (서버 TZ 의존 배제).
- 마이그레이션은 순수 `CREATE OR REPLACE FUNCTION` + `GRANT`만 포함 (테이블 변경 없음).
