## 재점검 결과 — Finish 스테이지의 3가지 어긋남

숫자가 우연히 4=4로 맞아 보였지만, 데이터 조건이 달라지면 **KPI Completion Overdue와 Finish 스택의 (주의+지연+위험) 합이 반드시 어긋나는** 3개의 로직 차이가 있음. Start와 함께 정렬 필요.

### KPI 기준 (`kpi-utils.ts`)

- `isCompleted(row)` = `actual_progress ≥ 1` **OR** `auto_judgment === '완료'`
- `isCompletionOverdue(row, asOf)` = `plan_end < asOf` **AND** `!isCompleted(row)`
- **`actual_finish`는 참조하지 않음**, **`slip_days`는 참조하지 않음**.

### 현재 Finish 스택 (`derived.ts` line 196–206)

```text
if (actual_progress ≥ 1 && actual_finish) return "완료";  // ① 문제
const pe = parseDate(row.plan_end);
if (!pe || pe > asOf) return "정상";
const slipCol = Number(row.slip_days ?? 0);
const slip = slipCol > 0 ? slipCol : daysDiff(pe, asOf);  // ② ③ 문제
if (slip > slip_late_days) 위험;
if (slip > slip_warn_days) 지연;
if (slip > 0) 주의;
return "정상";
```

### 어긋남 3건

1. **완료 판정 소스 불일치 (①)**
   - KPI 완료: `actual_progress ≥ 1` OR `auto_judgment === '완료'`.
   - 스택 완료: `actual_progress ≥ 1` AND `actual_finish` 둘 다 필요.
   - 결과: `actual_progress=1`인데 `actual_finish`가 비어 있는 행은 KPI에선 완료(overdue 아님)이지만, 스택에선 완료가 아니고 `plan_end ≤ asOf`라면 지연/주의/위험으로 이중계상됨. `auto_judgment='완료'`이지만 `actual_progress<1`인 행도 동일 문제.

2. **`slip_days` DB 컬럼 사용으로 인한 asOf 무관 부풀림 (②)**
   - `slip_days`는 마지막 갱신 시점 기준 최종 값이며, **선택된 asOf(과거 Data Date)와 무관**.
   - 과거 Data Date 선택 시 KPI는 `plan_end < asOf` 순수 달력 비교로 판정하는데, 스택은 `slip_days`(현재 시점 값)를 그대로 써서 위험/지연 카테고리를 부풀릴 수 있음.
   - 정합성 확보 위해 스택 slip은 **항상 `daysDiff(pe, asOf)`로 계산** — KPI와 동일한 asOf 기준 순수 달력 비교.

3. **경계 조건 (③)**
   - KPI: `plan_end < asOf` — 하루라도 지나야 overdue.
   - 스택: `pe > asOf → 정상`, `slip > 0`이면 주의 → `pe == asOf` 케이스는 양쪽 모두 overdue 아님으로 일치. 다만 위 ②를 고치면 자연스럽게 KPI와 완전 정렬됨(추가 변경 불필요).

## 최종 수정안 (`src/lib/task-management/derived.ts`)

### Start 분기

```text
if (stage === "start") {
  if (row.actual_start
      || Number(row.actual_progress ?? 0) >= 1
      || row.auto_judgment === "완료") return "완료";
  const ps = parseDate(row.plan_start);
  if (!ps || ps.getTime() > asOfD.getTime()) return "정상";
  const d = daysDiff(ps, asOfD);
  if (d > t.slip_late_days) return "위험";
  if (d > t.slip_warn_days) return "지연";
  return "주의";  // plan_start ≤ asOf 이면 최소 "주의" (KPI isPlannedStartedBy와 정렬)
}
```

### Finish 분기

```text
// finish
if (Number(row.actual_progress ?? 0) >= 1 || row.auto_judgment === "완료") return "완료";
const pe = parseDate(row.plan_end);
if (!pe || pe.getTime() > asOfD.getTime()) return "정상";
const slip = daysDiff(pe, asOfD);  // slip_days DB 컬럼 사용 중단, asOf 기준으로만 계산
if (slip > t.slip_late_days) return "위험";
if (slip > t.slip_warn_days) return "지연";
if (slip > 0) return "주의";
return "정상";
```

### WIP 분기 — 변경 없음 (이미 KPI와 정렬)

## 검증 방법

수정 후 여러 Data Date(최신 + 과거 2~3개)에서:
- Start 스택 (주의+지연+위험) 합 == KPI "Start Delayed"
- WIP 스택 (주의+지연+위험) 합 == KPI "Behind Schedule"
- **Finish 스택 (주의+지연+위험) 합 == KPI "Completion Overdue"** (특히 과거 Data Date에서 재검증)

## 변경 파일

- `src/lib/task-management/derived.ts` — `getStageJudgment` start/finish 분기

기타 파일(delay-utils, JudgmentStageBreakdown, kpi-utils)은 변경 없음.