## 목표
1. TM Dashboard의 Data Date 시맨틱을 **(B) Actual 유지, Plan/gap만 재계산**으로 정정한다.
2. 같은 시맨틱을 **MWS / MTWS / Task Summary** 에도 확장하여, Dashboard에서 지정한 세션 Data Date가 전 TM 페이지에 일관되게 적용되게 한다.

## 현재 상태(코드 실측)
- DB RPC 두 종류가 존재
  - `tm_judge_at_date` — Actual 은 현재값, Plan/gap/judgment 만 as-of 재계산 ← **채택**
  - `tm_judge_snapshot_at_date` — Actual 도 스냅샷으로 이동 (미채택, DB에는 보존)
- `TmDashboardPage` 는 직전 턴 배선 오류로 스냅샷 RPC 를 사용 중 → 수정 대상
- `useMyTasks` (MWS/MTWS) 는 `auto_judgment` 컬럼을 그대로 신뢰, `useTmDataDate` 미연결 → 항상 최신 기준
- `TaskTreePage` (Task Summary) 는 `asOfDate = routeSearch.dataDate || latestDataDate` 로 이미 asOf 인지하지만, `useTmDataDate` 세션과 무관하며 과거일 재판정을 `computeJudgment` 클라이언트 계산으로 처리 (SSOT 미준수)

## 변경 사항

### Part A — Dashboard 시맨틱 정정
1) `src/hooks/useTmJudgmentAtDate.ts`
   - 호출 RPC 를 `tm_judge_snapshot_at_date` → `tm_judge_at_date` 로 변경
   - 반환 타입에서 `effective_actual_progress` 제거, queryKey 정정
2) `src/components/task-management/dashboard/TmDashboardPage.tsx`
   - `effectiveItems` 병합에서 `actual_progress` / `actual_finish` 덮어쓰기 제거
   - 병합 필드: `auto_judgment`, `gap_pct`, `cum_plan_pct`, `delay_days`, `alarm_reason`

### Part B — MWS / MTWS 파리티
3) `src/hooks/useMyWorkspaceData.ts`
   - `useMyTasks` 반환값에 세션 Data Date 기반 판정 오버라이드를 병합할 수 있도록 확장 (또는 페이지 측에서 병합)
   - `latestDataDate` 판별 로직 재사용
4) `src/components/my-work-space/MyWorkSpacePage.tsx`
   - `useTmDataDate()` 로 세션 Data Date 구독
   - 과거 날짜일 때 `useTmJudgmentAtDate(asOf, isPast)` 결과를 `useMyTasks` 결과와 id 기준 병합 (Actual 은 원본 유지, 판정/gap/plan/delay/alarm 만 교체)
   - Delayed/Alarm KPI, Delay 리스트 등 하위 계산이 병합된 값을 참조하도록 확인
   - MTWS 경로(같은 페이지 컴포넌트 재사용)에도 자동 적용

### Part C — Task Summary 파리티
5) `src/components/task-management/tree/TaskTreePage.tsx`
   - `asOfDate` 소스에 `useTmDataDate` 세션을 추가 (우선순위: routeSearch.dataDate > 세션 > latestDataDate)
   - 과거일 때 `useTmJudgmentAtDate` 로 서버 판정 병합. Sub 행은 병합된 `auto_judgment` 사용
   - Main 롤업 판정은 자식 판정을 참조하는 구조라 자연히 파생됨. `resolveMainJudgment` / `resolveRowJudgment` 는 병합된 `auto_judgment` 를 우선 사용하도록 유지
   - `computeVariance` 는 asOf 기반 Plan 재계산 유지 (표시용) — DB 의 `gap_pct` 와 값이 일치하는지 검증

### Part D — 미사용 자원 정리 검토
6) `useTaskProgressSnapshot` 사용처는 Dashboard 정정 후 0. 삭제 여부는 안전을 위해 유지, 주석에 `@deprecated` 추가만 진행
7) `tm_judge_snapshot_at_date` RPC 는 DB 에 그대로 두되(재사용 여지), 클라이언트 참조 없음 상태 유지

## 검증 절차
1. **Dashboard**: 과거 Data Date 선택 시 Actual% 는 그대로, Plan% 하락, gap 증감, 판정 이동 확인 (EL-C-12-06 사례로 검증)
2. **MWS**: Dashboard에서 Data Date 를 과거로 지정 후 MWS 이동 → 상단 KPI 카드 / Delay 리스트가 세션 Data Date 기준으로 재판정되는지 확인. Actual 표시값 변동 없어야 함
3. **MTWS**: 팀 스코프에서 동일 동작 확인
4. **Task Summary**: routeSearch.dataDate 없음 + 세션 값 있음 → 세션 반영. Sub 판정 뱃지가 서버 값과 일치
5. **최신으로 복귀**: 어느 페이지에서든 세션 초기화 시 DB 저장 파생값(`auto_judgment` 컬럼)과 완전히 일치

## 기술 노트
- `tm_judge_at_date(p_data_date, p_task_ids)` 는 `_task_ids=NULL` 이면 전체 활성 행 반환. MWS/MTWS/Summary 는 이미 페이지 단에서 필터된 소수 id 집합만 넘겨 부하 최소화 (id 배열 전달)
- 훅은 오늘/미래 날짜에는 RPC 호출하지 않고 DB 저장 파생값을 그대로 사용 (기존 SSOT 유지)
- Actual 관련 컬럼(`actual_progress`, `actual_start`, `actual_finish`) 은 어떤 상황에서도 클라이언트에서 재작성하지 않는다 — 이 규칙을 병합 헬퍼에 명시
