## 목표
TM 대시보드 KPI 카드의 "IN DELAY"와 "BEHIND SCHEDULE"이 서로 다른 산식으로 계산되어 값이 어긋나는 문제를 해결. 두 카드가 동일한 뜻이므로 **gap 축**을 단일 판정 소스로 삼아 값이 항상 일치하도록 재정렬.

## 현재 문제 (진단)
`src/lib/task-management/kpi-utils.ts`
- `In Delay` = `computeJudgment(row) ∈ {지연,위험}` → 3-스테이지 + 임계값(behind_warn_gap, slip_warn_days) 기반
- `Behind Schedule` = `In Delay ∩ (gap < 0)` → 판정+gap 이중 필터
→ 두 축이 섞여 서로 다른 값 산출. 스샷의 ELEC 24 vs 22(=2 차이) 원인.

## 단일 소스 정의 (gap 기반)
`gap(row, asOf) = cumActualProgress(row) − cumPlanProgress(row, asOf)`
- **In Delay** = 미완료 AND `gap < 0` (Behind와 완전히 동일)
- **Behind Schedule** = In Delay와 동일 (동의어로 남기고 KPI 계산도 동일 값)
- **Start Delayed** ⊂ In Delay: `In Delay AND plan_start ≤ asOf AND actual_start 없음`
- **Completion Overdue** ⊂ In Delay: `In Delay AND plan_end < asOf`
- **Critical Delay** ⊂ In Delay: `In Delay AND gap < behind_late_gap (기본 −0.10)`
  · 임계값은 기존 `task_management_settings.behind_late_gap` 재사용(별도 UI 변경 없음)
  · 자동판정 '위험'과 개념 일치하되 gap 축 하나로 정의 통일

이 정의로 아래 부등식이 수학적으로 보장됨:
```
Start Delayed ≤ In Delay
Completion Overdue ≤ In Delay
Critical Delay ≤ In Delay
Behind Schedule == In Delay
```

## 수정 파일
### `src/lib/task-management/kpi-utils.ts`
- `isInDelay(row, asOf)` = `!isCompleted(row) && gapAt(row, asOf) < 0` 로 교체 (판정 기반 제거)
- `isBehindSchedule` 는 `isInDelay` 를 그대로 위임 (동의 함수)
- `isCriticalDelay(row, asOf, thresholds)` = `isInDelay && gap < thresholds.behind_late_gap`
- `computeKpi` / `computeKpiBreakdownByTeam` 는 함수 시그니처/반환 필드 유지 — 내부 계산만 위 정의로 갱신
- 임포트에서 사용하던 `computeJudgment`, `isTaskDelayed` 는 KPI 경로에서 제거

### `src/components/task-management/dashboard/TmKpiCards.tsx`
- 카드 문구/툴팁을 새 정의에 맞춰 소폭 조정:
  - IN DELAY 부제: "gap < 0 · 미완료"
  - BEHIND SCHEDULE 툴팁에 "IN DELAY와 동일 산식(gap 기반)" 안내
- 카드 배치·색상·딥링크 mode 키는 유지(레이아웃 변경 없음)

## 영향 범위 (변경 없음 확인)
- `derived.ts` 의 자동판정(computeJudgment) 로직은 그대로. Raw Data 뱃지, Task Tree, MWS/MTWS의 자동판정은 영향 없음.
- `isTaskDelayed` 는 대시보드 KPI에서만 호출 경로가 끊기고, MWS의 지연 리스트는 별도로 `computeJudgment` 를 직접 사용하므로 무관.
- 딥링크 `mode=in_delay|behind|critical|start_delayed|completion_overdue` 라우팅과 Raw Data 필터 UI는 그대로.

## 검증
1. 스샷 데이터셋(ELEC 24/22) 재조회 시 두 카드 동일 값 확인
2. Start Delayed / Completion Overdue / Critical Delay ≤ In Delay 부등식 확인
3. `computeKpiBreakdownByTeam` 팀별 stack 합계 == 카드 값 확인

## 비고
자동판정(`위험/지연/주의/정상/완료`)과 KPI 축을 분리해서 유지하는 방식입니다. 판정과 완전 일치를 원하시면 이후 별도 요청으로 조정 가능.
