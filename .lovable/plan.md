## 배경 — 검토 결과 요약

`computeKpi` (`src/lib/task-management/kpi-utils.ts`)에서 아래 5개 지연 지표는 모두 같은 `rows × asOf`에서 **각각 독립 카운트**됨:

- **In Delay** = 미완료 & `computeJudgment ∈ {지연, 위험}` (스테이지 worst-of)
- **Start Delayed** = 미완료 & `plan_start ≤ asOf` & `actual_start` 없음
- **Completion Overdue** = 미완료 & `plan_end < asOf`
- **Critical Delay** = 미완료 & `computeJudgment = 위험`
- **Behind Schedule** = 미완료 & `Actual% − CumPlan% < 0` (임계치 무관)

관계:
- **Critical ⊂ In Delay** (엄격한 부분집합)
- Start Delayed / Completion Overdue / Behind는 각각 **원자 조건**이라 In Delay와 다수 겹치지만 임계치 세팅에 따라 In Delay에 잡히지 않는 케이스가 존재.
- 4개 카드 합계는 In Delay와 일치하지 않으며(중복 카운트), 사용자에게 "In Delay가 지연 우산 지표"라는 관계가 UI에 드러나지 않음.

사용자 요청: **카드 간 포함 관계를 재정의** — In Delay를 상위로, 나머지를 그 breakdown으로 표현.

## 재정의 방향

In Delay 카드를 **지연 우산 상위 KPI**로 명확히 하고, Start Delayed / Completion Overdue / Critical / Behind를 그 **하위 breakdown**으로 시각적·논리적으로 종속시킨다. 단, Behind와 Start/Overdue는 In Delay의 100% 부분집합이 아니므로 계산식을 그대로 두면 합이 안 맞음 → **정의 자체를 In Delay 교집합으로 좁혀** 포함 관계를 강제한다.

## 새 정의 (kpi-utils.ts)

```text
In Delay (기존 유지)
  = 미완료 & worst-of judgment ∈ {지연, 위험}

Critical (기존 유지, In Delay의 진부분집합)
  = 미완료 & judgment = 위험

Start Delayed  → In Delay ∩ (plan_start ≤ asOf & actual_start 없음)
Completion Overdue → In Delay ∩ (plan_end < asOf)
Behind Schedule → In Delay ∩ (Actual% − CumPlan% < 0)
```

효과:
- **모든 하위 카드 ⊆ In Delay** 관계가 성립.
- 하위 카드끼리는 여전히 서로 겹칠 수 있음(예: Start Delayed와 Behind 동시 성립).
- "임계치 이하 미미한 갭이라 판정은 정상인데 plan_end 지남" 같은 극단 케이스는 이제 어느 카드에도 표시되지 않음 → 대신 아래 검증 UI에서 별도 툴팁으로 안내.

## UI 변경 (TmKpiCards.tsx)

1. **레이아웃 재구성**
   - 상단 1행: Completed / Planned Progress / Actual Progress / **In Delay** (기존 유지)
   - 상단 In Delay 카드에 "지연 우산 (하위 4개 카드의 상위집합)" 서브 라벨 + 산식 툴팁 추가.
   - 도넛 행: 기존 유지 (Status Mix / 좌측 슬롯 / 우측 슬롯).
   - 하단 4열: Start Delayed / Completion Overdue / Critical / Behind → 카드 좌상단에 `⊂ In Delay` 뱃지 표시하여 종속 관계 시각화.

2. **툴팁 (In Delay 카드)**
   - hover 시 산식: `미완료 & 스테이지 worst-of ∈ {지연, 위험}`
   - `asOf`, 스코프(All/Main/Sub), 하위 4개 카드 카운트 요약 리스트.

3. **툴팁 (하위 카드)**
   - 각 카드 hover 시 "In Delay ∩ <원자 조건>" 산식 표기.

## 로직 변경 (kpi-utils.ts)

- `isStartDelayed`, `isCompletionOverdue`, `isBehindSchedule` 함수를 그대로 두되, `computeKpi` 내에서 카운트 시 **`isInDelay(r, asOf) && isXxx(r, asOf)`** 로 AND 처리.
- `computeKpiBreakdownByTeam`도 동일하게 AND 처리하여 팀별 breakdown이 상위 In Delay 팀 분포와 정합.
- Critical은 이미 위험 ⊂ In Delay라 변경 불필요.
- 원자 조건 재사용(다른 화면)이 필요한 경우 대비하여 helper `isInDelayAnd(row, asOf, predicate)` 신설.

## 검증 항목

- Data Date 변경 시 상·하위 카드 합계가 `하위 4개의 union ≤ In Delay` 성립.
- 팀별 breakdown 클릭 → Raw Data 딥링크 결과 건수와 카드 카운트 일치.
- 임계치 조정(Critical Threshold Popover) 시 In Delay·Critical만 변동, 나머지 하위 카드도 In Delay 필터에 종속되어 함께 변동.
- Sub scope에서 Main만 지연되는 케이스(하위 없음)가 하위 카드에서 0으로 나오지 않는지 스팟체크.

## 기술 상세 (수정 파일)

- `src/lib/task-management/kpi-utils.ts`
  - `computeKpi`: `startDelayed`, `completionOverdue`, `behindSchedule` 카운트에 `isInDelay(r, asOf) &&` 추가.
  - `computeKpiBreakdownByTeam`: 동일 AND 처리.
  - JSDoc에 새 포함 관계 명시.
- `src/components/task-management/dashboard/TmKpiCards.tsx`
  - In Delay 카드에 `sub` 텍스트 + `title` 툴팁 추가, `⊂ In Delay` 뱃지용 prop 전달.
- `src/components/task-management/dashboard/RiskKpiCard.tsx`
  - 상위집합 표기용 `parentLabel?: string` prop 추가 (있으면 헤더 우측에 아웃라인 뱃지 렌더).
  - hover 툴팁 표기용 `formula?: string` prop 추가.

Raw Data 딥링크(`goRaw`) 자체는 mode 문자열만 넘기므로, Raw Data 페이지의 mode 필터도 동일 AND 조건으로 맞춰야 카운트 정합. → `TaskManagementRawDataPage.tsx`의 `start_delayed` / `completion_overdue` / `behind` 케이스에 `isInDelay` AND 필터 추가.
