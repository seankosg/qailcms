## 목표
첨부한 `defect-raw-VIEW-202607160626.xlsx`(2026-07-16 스냅샷, 44,510행)을 SM Raw Data(`defect_items_raw`)에 **UPSERT** 방식으로 1회 마이그레이션하고, `defect_import_logs`에 이력 1건을 남긴다.

## 파일/매핑 개요
- 시트: `Snags`, 헤더 행: 8, 데이터 행: 9~44,518
- 헤더 63개 중 `defect_header_mappings`로 자동 매칭되는 필드 매핑:
  - ID→source_issue_no, Team→team, Status→status_raw, Priority→priority, HDEC Verification/Reason/PIC/ENG/Comments, Classification, Category, Item, Description, Location→location_raw, Defect Location, Area Type/Level/Location, Location Reference, Podium Area, Main/Sub Trade, Work Type, Subcontractor→subcontractor_name, Sub-Sub→subsub_name, Created Team→created_by_team_name, Planned/Actual Start·Completion·Closure, Completion Status→rectified_status, Closure Status, Planned/Actual Progress %, Updated Status/Description, Updated Date (Raw), Remarks, IR, Forms, Data Date
- 매핑 테이블에 없어 이번에 추가/보강 매핑할 헤더(파서 규칙과 일치, DB 컬럼 존재 확인 완료):
  - `Defect Element` → `defect_type`
  - `Building` → `building`, `Room` → `room`, `Room Group` → `room_group`, `Level` → `level_name`
  - `Trade Detail` → `trade_detail`, `Assigned To` → `assigned_to`
  - `Captured By` → `captured_by_name`, `Created By` → `created_by_name`, `Created Date` → `created_date`
  - `Last Updated` → `last_updated_at`, `Updated By` → `updated_by_name`
  - `Subcon Issue No` → `subcontractor_issue_no`, `Review Flag` → `review_flag`, `Critical` → `is_critical`
  - `Plan Title` → `plan_title`, `Plan Group` → `plan_group`
- 무시 헤더(앱에서 재계산되는 파생값 · 사용자 규칙 반영): `Start Status`, `Classification Source`
  - `rectified_status`/`closure_status`도 자동판정 컬럼이라면 임포트값 무시 대상으로 볼 수 있으나, 현재 매핑에 존재하므로 원본 값을 그대로 반영. 다르게 처리해야 하면 알려주세요.

## 실행 단계
1. **매핑 보강 (1회 마이그레이션)**: 위 15개 신규 별칭을 `defect_header_mappings`에 UPSERT (source_header 유니크). 향후 재임포트에도 재사용됨.
2. **스테이징 로드**: xlsx를 sandbox에서 파싱 → 44,510행을 임시 스테이징 테이블 `_tmp_defect_import_20260716`에 COPY 로드. (트리거 없이 빠르게 적재)
3. **UPSERT**: `INSERT ... SELECT ... FROM _tmp ON CONFLICT (source_issue_no) DO UPDATE`로 `defect_items_raw`에 병합.
   - 업데이트 컬럼: 매핑된 모든 필드 + `data_date`, `raw_payload`(원본 JSON), `updated_at=now()`, `source_import_log_id=<이번 로그 id>`
   - `is_active=true`, `row_version = row_version + 1` (기존 행), 신규는 `row_version=1`.
   - 파일에 없는 기존 `source_issue_no` 행은 **건드리지 않음**(사용자 선택: UPSERT/병합).
4. **자동 계산 컬럼 재계산 유도**: `status_group`을 비롯한 파생 컬럼은 앱 로직/트리거가 갱신하도록 UPSERT 후 `UPDATE ... SET updated_at=now()` 또는 기존 `set_status_group` 트리거 발화. 트리거가 존재하면 자동 처리됨(확인 후 진행).
5. **임포트 로그**: `defect_import_logs`에 1행 삽입
   - filename=`defect-raw-VIEW-202607160626.xlsx`, sheet=`Snags`, total/inserted/updated/skipped 카운트, status=`completed`, data_date=`2026-07-16`, uploaded_by=현재 실행 컨텍스트(없으면 NULL).
6. **검증 쿼리 실행 후 결과 리포트**:
   - 총 활성 행수 변화, 신규 삽입 건수, 업데이트 건수, 파일 44,510과 처리 합계 일치 여부
   - 샘플 5행 확인 (ID 100000, 100001 등)

## 성능 대비
- 최근 인덱스 부담으로 배치 타임아웃이 반복되었으므로, 이번 마이그레이션은 **트리거 임시 비활성화 → 대량 UPSERT → 트리거 재활성화 후 `status_group`만 한 번에 갱신**하는 순서로 진행.
- 세션 `statement_timeout`을 넉넉히(예: 30분) 조정.

## 확인 필요
- `Critical` 컬럼: 파일 값은 boolean `False`/`True`로 들어옵니다. `is_critical`에 그대로 반영해도 될지(기존 사용자 수동 마킹 값 덮어쓸 수 있음). **덮어쓰기 vs 파일값 무시** 어떻게 처리할지 알려주세요. 기본은 **덮어쓰기**로 진행 예정.
- `HDEC Verification/Reason/Comments` 등 사용자 편집 필드도 파일값으로 **덮어쓰기** 처리 예정. 유지가 필요하면 알려주세요.