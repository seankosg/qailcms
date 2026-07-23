## 결정사항 확정
- `plan_progress` NULL → `computeTPlan` 폴백 (기본안).
- `today_actual` field_config 행 신규 추가.

## 재검토 요약

### (1) Cum. Diff 라벨/산식 (기존 이슈)
- **라벨**: `task_management_field_config.progress_variance.display_name` 이 `"Variance (%p)"` 로 저장돼 코드 라벨(`Cum. Diff`)을 덮음.
- **산식**: `computeVariance` 가 `actual − computeTPlan(...)` (시간 경과율)로 계산 → 지시(`Actual % − Plan %`) 불일치. EL-G-01(Actual 48.1 / Plan 48.1) 이 0.0 %p 아닌 -51.8 %p.

### (2) 오늘 트리오 (T.Plan / T.Actual / T.Diff)
- 산식 자체는 지시대로 구현되어 있음 (`TaskManagementRawDataPage.tsx:702-712`): T.Plan=`1/duration_days`, T.Actual=RPC `tm_today_actual`, T.Diff=`T.Actual−T.Plan`. 산식 변경 없음.
- 라벨: `expected_progress_today="T.Plan"`, `today_gap="T.Diff"` 정상. **`today_actual` 은 `field_config` 행 자체가 없음** → 신규 INSERT 필요.

### (3) Alarm / KPI 단일화
- 이전 지시: "Alarm 판정 = Variance 단일 기준", "Critical Delay KPI = Variance 기준".
- 현재 `getStageJudgment(stage="wip")` (`derived.ts:162-172`) 가 `actual − computeTPlan(...)` 사용 → Variance 새 정의(`actual − plan_progress`) 와 불일치. Variance 정의 변경 시 WIP 판정도 같이 통일.

---

## 수정 작업

### A. 코드 (`src/lib/task-management/derived.ts`)
1. `JudgmentRow` 타입에 `plan_progress?: number | null` 추가.
2. `computeVariance(row, asOf)` 재정의:
   ```
   const actual = clamp01(row.actual_progress ?? 0)
   const plan   = row.plan_progress != null ? clamp01(row.plan_progress) : computeTPlan(row, asOf)
   if (plan == null) return null
   return actual − plan
   ```
3. `getStageJudgment(row, "wip", ...)` 의 gap 계산을 `computeVariance(row, asOf)` 결과로 교체(값 null → "정상"). 임계값(`-0.05`, `-0.15`) 유지.
4. 주석 문구 갱신.

### B. DB — `task_management_field_config` (`supabase--migration`, 데이터 UPSERT)
- `progress_variance.display_name` → `'Cum. Diff'` UPDATE.
- `today_actual` 행 INSERT (`display_name='T.Actual'`, `is_visible=true`, `group_key='forecast'`, `sort_order` = `expected_progress_today` 의 sort_order + 1, 이후 행들 +1 재정렬). ON CONFLICT 시 UPDATE.
- 안전 재확인: `expected_progress_today='T.Plan'`, `today_gap='T.Diff'` idempotent UPDATE.

### C. 자동 반영 (수정 없음)
- Raw Data 셀 색상, AlarmBadge, `auto_judgment`, Behind Schedule / Critical Delay KPI, ExportDialog — 모두 `computeVariance` 또는 `computeJudgment` 경유하므로 A 만으로 반영.

### D. 셀프 체크리스트
1. 헤더에 **"Cum. Diff"**, **"T.Actual"** 표시.
2. EL-G-01: Actual 48.1 / Plan 48.1 → Cum. Diff = **0.0 %p**, Alarm = "정상".
3. EL-G-04: Actual 20.0 / Plan 20.0 → **0.0 %p** (기존 -80.0 %p ❌).
4. EL-D-04: Actual 12.3 / Plan 12.3 → 0.0 %p.
5. `plan_progress` NULL 행 → `computeTPlan` 폴백값 그대로 표시.
6. Columns 설정 다이얼로그에서 `T.Actual` 항목이 노출됨.
7. TM 대시보드 Critical Delay / Behind Schedule 카운트가 새 Cum. Diff 기준.
8. Export 엑셀의 Cum. Diff / T.Actual / T.Diff / T.Plan 값이 화면과 일치.