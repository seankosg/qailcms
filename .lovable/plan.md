# TM 지연 판정 3-스테이지(Start/WIP/Finish) 통일 계획 (T.Plan 앱-계산 반영)

## 확정된 정의

- **스테이지 = Start / WIP / Finish** (현재 코드의 start/completion 2단계는 재구성 필요)
- **T.Plan (Target Plan %)** — Data Date 당일의 계획 진도율. **앱에서 자동 계산**(DB의 `plan_progress` 컬럼은 참조 안 함).
  - `T.Plan(row) = clamp((data_date − plan_start) / plan_days, 0, 1)`
  - `data_date`가 없으면 `current_date` 사용.
  - `plan_start`나 `plan_days`가 없으면 T.Plan은 undefined → WIP 판정에서 "계획 없음(정상)" 처리.
- **Actual% = `actual_progress`** — 누계 실적 진도율.
- **gap = Actual% − T.Plan** (WIP 스테이지 지연 판단 축)
- **지연 판정: 스테이지별 이질 기준**
- **행 auto_judgment = 스테이지 worst**, 단 이미 착수(`actual_start` 존재)한 행에서는 Start 스테이지를 worst 후보에서 제외("지연시작"은 마커로만 표기하고 최종 판정에는 반영하지 않음).
- **임계값은 기존 값 재사용**: `behind_warn_gap=-0.05`, `behind_late_gap=-0.15`, `slip_warn_days=3`, `slip_late_days=14`.

---

## 스테이지별 판정 규칙

### Start
- `actual_start`가 있으면 → **완료**. 다만 `actual_start > plan_start`이면 `startedLate` 플래그(마커용).
- `actual_start` 없음:
  - `plan_start` 없거나 `plan_start > data_date` → **정상**
  - 미착수 지연일 `d = data_date − plan_start`
    - `d > slip_late_days` (14) → **위험**
    - `d > slip_warn_days` (3) → **지연**
    - `d > 0` → **주의**

### WIP
- `actual_progress >= 1` → **완료**
- T.Plan 계산 불가(계획 없음) 또는 `data_date < plan_start` → **정상**
- gap = `actual_progress − T.Plan`
  - `gap < -0.15` → **위험**
  - `gap < -0.05` → **지연**
  - `gap < 0` → **주의**
  - else → **정상**

### Finish
- `actual_progress >= 1` 이고 `actual_finish` 존재 → **완료**. `actual_finish > plan_end`이면 `finishedLate` 플래그(초록 X 마커 유지).
- 미완:
  - `plan_end` 없거나 `plan_end > data_date` → **정상**
  - `slip_days` (또는 `data_date − plan_end`) 
    - `> slip_late_days` → **위험**
    - `> slip_warn_days` → **지연**
    - `> 0` → **주의**

## 행 auto_judgment

```
judgments = { start: J_start, wip: J_wip, finish: J_finish }
if actual_start is not null: drop 'start'
row = worstOf(remaining), ordering: 정상 < 주의 < 지연 < 위험 (완료는 예외 처리)
if J_wip == 완료 && J_finish == 완료: row = 완료
```

## 변경 파일

### 1) `src/lib/task-management/schedule-utils.ts`
- `ALL_TASK_STAGE_KEYS = ["start","wip","finish"]`
- `TASK_STAGE_LABELS` 갱신
- 신설: `computeTPlan(row, asOf)`, `getStageJudgment(row, stage, thresholds, asOf)`, `isStartedLate`, `isFinishedLate`
- 기존 `isTaskStageDelayedAsOf` 는 내부 헬퍼로 재활용하되 외부 사용처는 새 API로 교체

### 2) `src/lib/task-management/derived.ts`
- `computeJudgment(row, thresholds, asOf)` 재작성 — 위 worstOf 규칙 반영, 착수 시 Start 제외.
- `isTaskDelayed(row) = judgment ∈ {지연, 위험}` export.
- `expectedProgressToday` 대신 `computeTPlan` 사용, `plan_days` 기준.

### 3) `src/lib/task-management/delay-utils.ts`
- `computeDelayTopN` — 행 판정이 지연/위험인 것만. 각 행에 worst 스테이지와 대표 지표(WIP=gap, Start/Finish=초과일수) 부착.
- `computeOwnerLeaderboard` — `planPct = avg(computeTPlan(row))`, `actualPct = avg(actual_progress)`, `diffPp = actualPct − planPct`, `delayedTaskIds = 행 지연/위험`.
- `computeWeeklyDelayTrend` — 각 주말 asOf에서 `computeJudgment` 재실행.
- `computeJudgmentStageBreakdown` — 3-스테이지 축, 각 셀 `getStageJudgment` 결과.

### 4) DB 함수 동기화 (마이그레이션)
`calc_auto_judgment_value` 재정의:
- 시그니처 확장: `(actual_progress, plan_start, plan_end, plan_days, actual_start, actual_finish, data_date, slip_days)`
- 내부에서 T.Plan을 계산하고 Start/WIP/Finish 판정 후 worstOf(착수 시 Start 제외) 적용. **DB `plan_progress` 컬럼은 사용하지 않음** — 앱과 동일하게 `plan_days` 기반 계산.
- `recalc_task_auto_judgment`도 새 시그니처로 update 문 수정.
- 배포 후 1회 전체 재계산: `select public.recalc_task_auto_judgment(null);`

### 5) UI
- Raw Data 스테이지 셀 컴포넌트 — Start/WIP/Finish 3칸 배치, 색상은 `getStageJudgment`. `startedLate`는 Start 완료 셀에 작은 시계 마커, `finishedLate`는 Finish 완료 셀에 초록 X (기존 규칙 유지).
- `TmDashboardPage.tsx` / `TmKpiCards.tsx` — 지연 카운트 `isTaskDelayed` 기반. 리더보드 툴팁: "T.Plan = Data Date 당일 일할 계획진도율, Actual% = 누계 실적 진도율".
- `TaskDashboardPage.tsx` (스테이지 매트릭스) — 3-스테이지 축.
- `TaskTreePage.tsx` "지연만" 필터 — `isTaskDelayed` 기반.
- Admin 임계값 미리보기 페이지 — 새 `computeJudgment` 시그니처.

### 6) 하위호환
- 코드 내 `"completion"` 스테이지 참조를 `"finish"`로 리네임. 이력/DB 컬럼명은 변경 없음.
- `exportTaskSummary.ts` 스테이지 헤더 갱신.

## 검증

1. `plan_start`/`plan_days`가 채워진 착수/미완 행에서 UI에 표시되는 T.Plan = `(data_date − plan_start)/plan_days`.
2. 미착수 + `data_date − plan_start > 14` → Start=위험, 전체=위험.
3. 착수 + `gap < -0.15` → WIP=위험, 전체=위험 (Start는 startedLate 마커만).
4. 완료(`actual_progress=1` + `actual_finish` 존재) → 전체=완료.
5. Admin 임계값 페이지 미리보기 vs 대시보드 KPI 지연 카운트 일치.
6. 샘플 100행에서 DB `calc_auto_judgment_value` == 클라이언트 `computeJudgment`.
