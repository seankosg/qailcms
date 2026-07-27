## 목적
업로드한 두 엑셀(ABD_Status_ELEC_260726, ABD_Status_MECH_260726)과 `abd_items_raw` DB를 Document No. 기준으로 비교하여 정합성 리포트 생성.

## 비교 범위 (사용자 확정)
1. **존재 여부**: 엑셀에만 / DB에만 있는 Document No.
2. **Latest Status 차이**: A / B / C / 공란 값 diff

## 처리 절차
1. 엑셀 파싱 (openpyxl)
   - ELEC: `ABD Plot 4` 시트, 2,090행 → 헤더 2행 병합 처리, Document Number 열 + LATEST(Status) 열 추출
   - MECH: `ABD Plot 3` 시트, 1,308행 → 동일 방식
2. DB 조회 (`abd_items_raw`)
   - Plot=4 (ELEC), Plot=3 (MECH) 각각 `source_issue_no`(=Document No.)와 `latest_status` 로드
3. Document No. 기준 outer join → 3개 버킷 산출
   - `only_excel`: 엑셀에만 존재
   - `only_db`: DB에만 존재  
   - `diff`: 양쪽 모두 있지만 Latest Status 불일치 (공란 vs 값 포함)
4. 엑셀 리포트 저장 (`/mnt/documents/abd_status_diff_260727.xlsx`)
   - Summary 탭: Plot별 행수, only_excel/only_db/diff 카운트
   - 6개 상세 탭: `ELEC_only_excel`, `ELEC_only_db`, `ELEC_diff`, `MECH_only_excel`, `MECH_only_db`, `MECH_diff`
   - diff 탭 컬럼: Document No. | Excel Status | DB Status
5. 결과 요약을 채팅으로 리포트 + `<presentation-artifact>` 링크 제공

## 비고
- Plot/Team/Discipline 매핑은 파일명(ELEC→Electrical, MECH→Mechanical) + 시트명(Plot 4/3) 사용.
- Document No. 정규화: 앞뒤 공백 제거, 대소문자 통일 후 매칭.
- DB에서 다른 Plot의 동일 문서번호가 있는지도 부수 체크(있으면 diff 탭 비고에 표기).
- 소요 시간: 약 3~5분.