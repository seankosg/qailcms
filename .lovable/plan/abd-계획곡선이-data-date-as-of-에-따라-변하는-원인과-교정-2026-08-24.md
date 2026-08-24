# ABD 계획곡선이 Data Date(As-of)에 따라 변하는 원인과 교정

## 실측으로 확인한 사실

동일 필터·동일 기간(2026-07-01 ~ 2026-09-23, 주 단위)에서 As-of만 바꿔 계획 누적을 측정했습니다.

| 항목 | As-of = 오늘 | As-of = 2026-06-20 |
| --- | --- | --- |
| Approval 계획 누적(종점) | 6,654 | 6,334 |
| Submission 계획 누적(종점) | 6,654 | 6,654 |
| Approval 분모(총 문서) | 6,656 | 6,656 |

분모는 그대로인데 Approval 계획 누적만 320건 줄어듭니다. 그래서 계획곡선이 100%에 닿지 않습니다.

## 원인

계획 이벤트를 만드는 정본 함수 `abd_progress_events(_as_of_date, …)`가 **계획 날짜를 고를 때도 As-of 시점 판정 결과(`abd_judge_v1(r, _as_of_date)`)를 사용**합니다.

- Approval 계획일(`ap_plan`)은 "그 시점에 승인된 문서인가(`bucket_top='Approved'`)"와 "그 시점 활성 라운드(`active_round`)"로 분기합니다.
- As-of를 과거로 옮기면 그때는 아직 승인 전이던 문서가 승인 분기(라운드별 DAR 계획일 COALESCE 폴백 포함)를 타지 못하고, 활성 라운드(당시 R1/R2) DAR 계획일만 보게 됩니다. 그 라운드에 계획일이 비어 있으면 계획 이벤트 자체가 사라져 누적에서 빠집니다.
- Draft Start / Draft Finish / Submission도 같은 방식으로 활성 라운드에 따라 계획일을 고르지만 COALESCE 폴백이 있어 건수는 유지되고, 대신 **날짜가 라운드별로 달라져 곡선 모양이 미세하게 바뀔 수 있습니다.**

즉 실적은 As-of 기준으로 잘리는 것이 정상이지만, 계획까지 As-of 판정에 묶여 있는 것이 문제입니다.

## 교정 방침

계획(Plan)은 As-of와 무관한 고정 정본으로 산출하고, 실적(Actual)만 As-of 기준으로 절단합니다.

1. `abd_progress_events` 안에서 **계획일 선택용 판정과 실적 절단용 판정을 분리**합니다.
   - 계획일 선택: `abd_judge_v1(r, 최종 시점)` 기준(= 현재 정본 라운드)으로 고정.
   - 실적/버킷 상한: 기존대로 `_as_of_date` 유지.
2. Approval 계획일은 As-of에 관계없이 동일 우선순위로 결정합니다: 승인 회신(`response_result='A'`) 라운드의 DAR 계획일 → 승인일과 일치하는 라운드의 DAR 계획일 → `COALESCE(r3, r2, r1)` 폴백. 어떤 As-of에서도 계획 건수가 동일해집니다.
3. DS / DF / SB도 동일하게 "정본 라운드 → COALESCE 폴백"으로 통일해 As-of가 달라져도 계획 날짜가 흔들리지 않게 합니다.

## 적용 후 검증(수치로 확인)

- As-of를 오늘 / 1개월 전 / 3개월 전으로 바꿔가며 각 스테이지 계획 누적 종점이 **완전히 동일**한지 대조.
- Approval 계획 누적 종점 ≈ 분모(6,656)에 수렴해 계획곡선이 100%에 도달하는지 확인.
- 실적 누적은 As-of가 과거일수록 작아지는지(정상 동작 유지) 확인.
- ABD Progress 페이지와 Project Dashboard의 ABD 섹션이 같은 훅/RPC를 쓰므로 두 화면 값이 일치하는지 대조.

## 기술 상세

- 변경 대상: DB 함수 `public.abd_progress_events` 1개(멱등 `CREATE OR REPLACE`). 이 함수를 쓰는 `abd_progress_cum_json`, `abd_progress_cells`, `abd_progress_totals`는 시그니처 변경 없이 그대로 이득을 봅니다.
- 프런트엔드 변경 없음(UI·배치·문구 불변). `useAbdScurveData` 호출 규약 유지.
- 판정(지연/주의 등) 로직인 `abd_judge_v1` 자체는 손대지 않습니다. 계획 이벤트 선택에서만 As-of 의존을 제거합니다.
