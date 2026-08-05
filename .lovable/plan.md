# SM Raw Data 미사용 컬럼 22개 완전 삭제

`defect_items_raw`(118,664행)에서 값이 단 한 건도 없는 25개 컬럼 중, 지시대로 `subsub_name` · `trade_detail` · `classification_source` 3개를 남기고 **22개를 DB 컬럼 DROP까지 완전 삭제**합니다.

## 삭제 대상 22개

`ir`, `forms`, `updated_status`, `updated_date_raw`, `issue_no`, `subcontractor_issue_no`, `subcontractor_issue_source`, `area_type`, `area_level`, `area_location`, `captured_by_name`, `classified_at`, `planned_progress_pct`, `actual_progress_pct`, `status_manual`, `hdec_verification`, `hdec_reason`, `hdec_comments`, `aconex_comments`, `remarks`, `critical_marked_by`, `critical_marked_at`

(전 행 값 0건 실측 완료. `subsub_name`/`trade_detail`/`classification_source`는 지시에 따라 유지, B·C 그룹도 전부 유지.)

## 실측된 의존성 (전부 같이 정리)

DB 함수·트리거 (컬럼 참조 실측):
- `defect_items_search`, `defect_items_facets`, `defect_items_search_ids` — 18개 컬럼 참조
- `trg_defect_suppress_noop_update` — 20개 컬럼 참조
- `trg_defect_history_fn` — `actual_progress_pct`, `status_manual`, `hdec_verification`, `hdec_reason`
- `_snag_group_val`, `_snag_dim_val`, `defect_snag_progress_cells`, `defect_snag_progress_totals` — `area_level`(그룹 축 후보), `actual_progress_pct`
- `_snag_stage_done` — `actual_progress_pct`
- `rollback_defect_import` — `planned_progress_pct`, `actual_progress_pct`

인덱스: `defect_items_raw_area_location_trgm_idx`, `defect_items_raw_remarks_trgm_idx`, `defect_items_raw_active_group_arealevel_idx`, `idx_defect_items_raw_area` (DROP COLUMN 시 자동 제거되나 마이그레이션에 명시)

설정 행: `defect_field_config` 16행, `defect_header_mappings` 16행 삭제

프론트엔드: `src/lib/defect-management/columns.ts`(컬럼 정의·그룹), `parser.ts`(헤더 매핑·필드 목록), `derived.ts`, `filter-fns.ts`, `progress-utils.ts`, `mutations.functions.ts`, `export-meta.ts`, `useDefectItems.ts`, `DefectRawDataPage.tsx`, `DefectDetailPage.tsx`, `DefectStageProgress.tsx`, `DuplicateReviewDialog.tsx`, `exportAllUnclosed.ts`, `DefectManagementImportContext.tsx`
(TM 쪽 동명 컬럼 `status_manual`/`actual_progress_pct`는 별개 테이블이므로 손대지 않음.)

## 진행 순서

1. **마이그레이션 1 — 함수/트리거 재정의**: 위 함수·트리거 본문에서 22개 컬럼 참조를 제거한 새 정의로 교체. `_snag_group_val`/`_snag_dim_val`의 `area_level` 축은 제거(값 0건이라 화면 결과 불변), `_snag_stage_done`·`defect_snag_progress_totals`의 `actual_progress_pct` 분기는 삭제. RPC 시그니처는 바꾸지 않음(파라미터 변화 없음).
2. **마이그레이션 2 — 설정 행 정리 + 컬럼 DROP**: `defect_field_config`/`defect_header_mappings`의 해당 행 DELETE 후 `ALTER TABLE public.defect_items_raw DROP COLUMN ...` 22건.
3. **되돌리기 스크립트**: `docs/revert/2026-08-05-sm-drop-unused-cols.sql`에 컬럼 재생성 + 설정 행 복원 + 구 함수 정의를 남김(미적용).
4. **프론트엔드 정리**: 위 파일들에서 컬럼 정의·필터·엑스포트·상세창 필드·임포트 매핑 참조 제거. 화면 배치와 나머지 컬럼 UI는 변경하지 않음.
5. **검증**: SM Raw Data 목록/필터/패싯/검색, 상세창, Export, 임포트 프리뷰, SM 대시보드 매트릭스가 삭제 전과 동일 결과인지 실측 후 행수·화면 상태 보고.

## 확인 사항

`remarks`는 상세창 비고 입력란으로 열려 있을 수 있으나 118,664행 전부 비어 있어 삭제 대상에 포함했습니다. 입력 UI까지 함께 제거합니다 — 남겨야 하면 알려주세요.
