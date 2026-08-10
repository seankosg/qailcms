# ELEC Sub-Task Milestone 1회 덮어쓰기

첨부 엑셀(`ELEC_CMS_TM_view_20260809_064_전기_milestone_검토_1차승인-2.xlsx`)의 Sub-Task No 기준으로 `task_management_raw.milestone` 값을 덮어씁니다.

## 실측 대조 결과

- 엑셀 sub 행: 618건 (main 행은 Milestone 공란이라 대상 제외)
- DB `task_no` 매칭: 618/618 (미매칭 0건)
- 실제 값이 달라 변경될 행: **46건**

| 현재 값 | 엑셀 값 | 건수 |
|---|---|---|
| COC | HO1 | 17 |
| HO2 | DLP1 | 13 |
| (비어있음) | HO2 | 7 |
| HO1 | DLP1 | 3 |
| (비어있음) | HO1 | 3 |
| HO1 | HO2 | 1 |
| (비어있음) | DLP2 | 1 |
| HO2 | DLP2 | 1 |

엑셀에 등장하는 코드(COC/HO1/HO2/DLP1/DLP2)는 모두 `tm_milestone_kinds` 에 활성 등록되어 있어 신규 코드 추가는 불필요합니다.

## 작업 내용

1. 데이터 변경 1회 실행 (스키마 변경 없음)
   - 618건 `(task_no, milestone)` 쌍을 그대로 반영
   - 엑셀에 있는 sub task_no 에 한정하며 다른 행은 건드리지 않음
   - 이미 같은 값인 행은 갱신 대상에서 제외 → 실제 46행만 변경
2. 실행 후 검산
   - 618건 전부 엑셀 값과 일치하는지 재조회(불일치 0 확인)
   - ELEC 행 총수 불변 확인

## 참고

- Main(상위) 과업 Milestone 은 하위 롤업 규칙으로 자동 반영되므로 직접 쓰지 않습니다.
- 되돌림 대비로 변경 전 46건의 (task_no, 이전 값) 목록을 실행 리포트에 남깁니다.