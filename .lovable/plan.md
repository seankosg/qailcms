# PLOT C Re-Schedule 파일 vs 현재 DB 대비표 만들기

업로드하신 `PLOT_C_Re-Schedule_Rawdata.xlsx`(12,352행)의 각 항목을 **ID No** 기준으로 현재 데이터와 전수 대조하여, 값이 다른 항목만 정리한 엑셀 대비표를 만듭니다.

## 대조 기준

- 연결 키: 파일의 `ID No` ↔ 현재 데이터의 항목 번호(`source_issue_no`)
- 대조 대상 7개 항목:

| 파일 열 | 현재 데이터 |
| --- | --- |
| Team | team |
| Status | status_raw |
| Plot | plan_group |
| Building | building |
| Room Group | room_group |
| Level | level_name |
| Subcontractor | subcontractor_name |

- 계획일 6개 열(P. Start / P. Rectified / P. Pre-Ins / P. DAR-Ins / P. Closure / P. H/O)은 파일에서 **12,352행 전부 비어 있음**이 실측 확인되었습니다. 따라서 차이 판정에서는 제외하고, 현재 데이터의 계획일 값을 참고 열로만 함께 표시합니다.
- 비교는 앞뒤 공백 제거 후 대소문자 구분 없이 수행하고, 빈 값과 값 없음은 동일하게 취급합니다.

## 만들 엑셀 구성 (4개 시트)

1. **요약** — 항목별 불일치 건수, 전체 대조 건수, DB에 없는 ID 수, 파일에 없는 ID 수
2. **차이 상세** — 차이가 있는 행만: ID No / 불일치 항목 수 / 항목별 `파일값` · `DB값` 쌍(다른 셀은 강조 색상) + 현재 계획일 6열(참고)
3. **DB에 없는 ID** — 파일에만 있는 항목 목록
4. **파일에 없는 ID** — Plot C(Tower 3) 범위에서 현재 데이터에만 있는 항목 목록

서식: Arial, 헤더 고정, 필터, 차이 셀 노란 배경 + 빨간 글씨.

## 산출물

`/mnt/documents/` 에 `PLOT_C_Re-Schedule_대비표_YYYYMMDD.xlsx` 로 저장하여 다운로드할 수 있게 첨부합니다.

## 범위 밖 (변경하지 않음)

- 데이터베이스 값 수정·임포트는 하지 않습니다. 이번 작업은 **읽기 전용 대조 보고서 생성**만 수행합니다.
- 앱 화면·기능 변경 없음.
