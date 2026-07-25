
## 근본 원인 (실측 근거)

AR-D-P-07의 실제 DB 값 (`task_management_raw` 조회):

| task_no | level | plan_end | actual_progress | actual_finish | auto_judgment | data_date |
|---|---|---|---|---|---|---|
| AR-D-P-07 | main | 2025-12-26 | 0.9767 | NULL | **정상** | 2026-07-23 |
| AR-D-P-07-01/02/03 | sub | 2025-12-26 ~ 2025-11-09 | 1.0 | 채워짐 | 완료 | 〃 |
| AR-D-P-07-04 (Dar inspection) | sub | **NULL** | 0 | NULL | **정상** | 〃 |
| AR-D-P-07-05 (NCR Close) | sub | **NULL** | 0 | NULL | **정상** | 〃 |

Data Date(2026-07-23) 기준 Main의 `plan_end`는 209일 지났고 미완료(Actual 97.67%) → 스테이지 판정으로는 **위험**. 그런데 DB에는 **정상**으로 저장돼 있고, Task Summary는 이 값을 그대로 표시. Dashboard의 "지연 Top"은 `getStageJudgment`를 클라이언트에서 매번 재계산하므로 위험으로 잡음 → 두 화면 불일치.

DB 함수 `public.update_task_summary` (Main 롤업) 정의를 확인한 결과:

```
auto_judgment = coalesce(worst, auto_judgment)
```

여기서 `worst`는 **하위 Sub Task들의 auto_judgment 중 최악치**만 집계 (파일 `update_task_summary` L221-244). **Main 본인의 `plan_end` vs `data_date`는 반영하지 않음**. Sub 04·05는 계획일이 비어 있어 `calc_auto_judgment_value`가 "정상"을 반환하므로, 완료된 01·02·03(완료)과 함께 worst=**정상** → Main도 "정상"으로 오염.

즉 이 결함은 AR-D-P-07 단건이 아니라, **plan_end 미도래 Sub가 하나라도 있거나 미계획 Sub가 섞인 모든 Main Task**에서 동일하게 발생. Main 자체의 Finish 지연이 완전히 은폐됨.

### 추가로 Data Date 변경 시 불일치 문제

Task Tree 페이지는 URL `dataDate` 파라미터로 Data Date를 변경할 수 있음. DB의 `auto_judgment`는 저장/롤업 시점의 `data_date`를 기준으로 계산된 고정값. Data Date를 변경하면 Main의 `plan_end` vs `dataDate` 관계가 달라져야 하지만, DB값을 우선하면 UI 변경에도 판정이 고정되어 Dashboard(재계산)와 불일치할 수 있음.

## 수정 계획

### 1. DB 롤업 함수 수정 (마이그레이션)

`public.update_task_summary`에서 Main의 `auto_judgment`를 다음 둘의 **worst**로 산정:
- (a) 기존 Sub Task worst
- (b) Main 자신에 대해 `public.calc_auto_judgment_value(...)`를 즉시 호출한 결과

`rank_order`(위험>지연>주의>정상>완료) 배열로 둘 중 worst 선택.

### 2. 기존 데이터 일괄 재계산

마이그레이션 말미에 `SELECT public.rollup_task_all_mains(d) FROM (SELECT DISTINCT discipline FROM task_management_raw WHERE level='main') s(d);` 실행하여 전체 Main Task의 `auto_judgment`를 새 로직으로 갱신.

### 3. 클라이언트 판정 우선순위 통일

`src/components/task-management/tree/TaskTreePage.tsx` L185, L409, L494 세 곳의 `row.auto_judgment ?? computeJudgment(...)`를:
- **Main Task는 `computeJudgment(row, undefined, asOfDate)` 우선**, DB값은 폴백.
- Sub Task는 기존대로 DB값 우선(성능/일관성).

이유: Data Date는 UI에서 임의로 변경 가능하지만 DB `auto_judgment`는 저장 시점의 `data_date` 기준. Main의 Finish 판정은 asOf에 민감하므로 클라이언트 재계산이 정답. Sub는 스테이지가 짧아 재계산-저장 차이가 사실상 없음.

동일 패턴이 있는 다음 파일도 함께 검토·수정:
- `src/lib/task-management/kpi-utils.ts` (KPI 집계에서 Main만 재계산)
- `src/components/task-management/tree/exportTaskSummary.ts` (엑셀 판정 컬럼)
- 기타 `auto_judgment` 사용처 grep 후 Main-only 재계산 적용

### 4. 검증

- AR-D-P-07 재계산 후 `auto_judgment = 위험` 확인.
- Task Summary 위험 필터에 노출, Dashboard "지연 Top"과 일치 확인.
- Data Date를 과거/미래로 변경할 때 Main Task 판정이 UI에서 실시간 반영되는지 확인.
- 다른 Main 중 Sub 완료율 100%이나 Main plan_end 미도래인 케이스(정상 유지) 회귀 없음 확인.

## 스코프 밖 (별도 확인 필요)

- Sub 04·05 같이 `plan_start/end`가 NULL인 항목은 이번 수정으로도 자체 판정은 "정상". 이는 계획 미수립 문제로 별건. 필요 시 "미계획" 배지 등을 별도 지시로 진행.

