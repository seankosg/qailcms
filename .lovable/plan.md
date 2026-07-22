## 원인 진단 (DB 실측)

Plot D · ARCH · unclosed 기준으로 두 화면이 서로 다른 정의를 씁니다.

| 소스 | Start Done 카운트 | 판정식 |
|---|---:|---|
| **Progress Matrix** (`defect_snag_progress_totals`) | **997** (as_of=7/22) | `actual_start_date IS NOT NULL AND actual_start_date <= as_of_date` — **오직 실제 착수일 하나만** 본다 |
| **Raw Data** (`defect_items_facets` 등 서버 파생 `start_status`) | **1,010** | `status_raw ∈ (rectified/complete/completed/closed/verified)` OR `actual_start_date` OR `actual_progress_pct > 0` OR `actual_rectified_date` OR `actual_closure_date` |

즉 Matrix가 "asd만" 세는 동안, Raw Data는 "status_raw 완료계열/실적진도/후속 스테이지 실제일"까지 Done으로 인정합니다. 사용자가 보신 953도 대략 이 계열(1000 근처)이며, 두 숫자가 다른 것이 정상입니다 — 하지만 **정의가 어긋난 것 자체가 문제**입니다.

세부 카운트(Plot D · ARCH · unclosed):

```text
actual_start_date NOT NULL                                     1,005
status_raw ∈ rectified 계열                                      948
actual_rectified_date NOT NULL                                 1,010
actual_closure_date NOT NULL                                       0
actual_progress_pct > 0                                            0
Raw Data start_status='Done' (위 5개 OR)                       1,010
Matrix s_done @ 2026-07-22                                       997   ← 이 숫자를 사용자가 953±로 보심
```

Rectified/Closure 스테이지도 동일 패턴(Matrix는 날짜 컬럼만, Raw Data는 status_raw까지 포함) — 다른 팀·Plot에서도 같은 성격의 편차가 재현될 것.

## 제안: Matrix Done 판정을 Raw Data 파생 상태와 동일하게 통일

`defect_snag_progress_totals` / `defect_snag_progress_cells`의 `s_done / r_done / c_done` 표현식을 Raw Data 파생 `start_status='Done'` / `rectified_status='Rectified'` / `closure_status='Closed'` 와 동일한 OR 조건으로 확장합니다. 이렇게 하면 KPI 카드·매트릭스·클릭 이동한 Raw Data 리스트의 숫자가 항상 일치합니다.

### 변경 대상
- `defect_snag_progress_totals` (마이그레이션): `flags` CTE의 세 판정식을 Raw Data facets와 동일한 CASE 표현식으로 교체
- `defect_snag_progress_cells` (마이그레이션): 동일한 로직으로 스테이지 이벤트 날짜 결정 (예: Start done 날짜 = `COALESCE(asd, acd, axd)` 로 이미 되어있는지 재확인 후 정합화)

### 새 판정식 (제안)
```sql
s_done := (
  LOWER(TRIM(status_raw)) IN ('rectified','complete','completed','closed','verified')
  OR (asd IS NOT NULL AND asd <= as_of)
  OR COALESCE(pnorm,0) > 0
  OR (acd IS NOT NULL AND acd <= as_of)
  OR (axd IS NOT NULL AND axd <= as_of)
)
r_done := (
  LOWER(TRIM(status_raw)) IN ('rectified','complete','completed','closed','verified')
  OR (acd IS NOT NULL AND acd <= as_of)
  OR (axd IS NOT NULL AND axd <= as_of)
  OR pnorm >= 100
)
c_done := (
  LOWER(TRIM(status_raw)) IN ('closed','verified')
  OR (axd IS NOT NULL AND axd <= as_of)
)
```
`plan_upto` / `actual_upto`는 기존 정의(계획일·실제일 존재 기준) 유지. `done_upto`만 위 통합 조건으로 바뀌므로, 카드의 "Done" 카운트가 Raw Data 클릭 이동 결과와 정확히 일치하게 됩니다.

### 예상 결과
Plot D · ARCH Start `done_upto`: **997 → 1,010** (Raw Data와 일치). 다른 셀들도 유사한 방향으로 소폭 상향.

### 확인 필요
매트릭스 셀(일별)의 Actual 이벤트 카운트는 그대로(실제일 존재 기준) 두는 것이 맞다고 봅니다 — 그렇지 않으면 "언제 완료됐는지" 없는 이벤트가 특정 날짜 컬럼에 잡히지 않아 오히려 혼란. 즉 **누계 done_upto만 통일**하고, 일별 셀은 현행 유지.

이 방향으로 진행할까요? 아니면 반대로 Raw Data쪽 `start_status='Done'`을 asd 기반으로 좁힐지 알려주세요.
