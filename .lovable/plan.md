
# Defect Management 모듈 구현 계획

SHAW PROJECT CMS의 Defect 모듈을 이 프로젝트(TanStack Start + Task Management 패턴)에 이식합니다. Team은 임포트 UI에서 **수동 선택 강제**, Raw Data DB는 단일 테이블(`defect_items_raw`)로 유지, 스키마는 SHAW 풀 포팅.

## 상위 아키텍처

- 소스 엑셀(LetsBuild 형식)의 25개 원본 헤더: `ID / Location / PlanTitle / PlanGroup / Status / AssignedTo / Category / Type / Item / Description / Priority / DueBy / CreatedBy / CreatedByTeamName / CreatedDate / IR / Forms / LastUpdated / UpdatedDescription / UpdatedBy / UpdatedStatus / UpdatedDate / LocationReference / Classification / Podium area`.
- 헤더 텍스트는 팀 무관 고정이지만 **컬럼 위치는 유동** → row 1 헤더 텍스트로 인덱스 매핑, 팀 상관없이 동일 파서 사용.
- Team(`건축`/`전기`/`설비`)은 임포트 파일 카드에서 사용자가 반드시 지정. 저장된 각 row는 `team` 컬럼으로 구분되지만 물리 테이블은 하나.
- 스키마는 SHAW의 `defect_items` 상위집합을 그대로 도입(현재 소스에 없는 `planned_start_date` 등 lifecycle 컬럼은 null 저장, Detail 페이지/후속 임포트에서 채움).

## Phase 1 — Raw Data (DB + 페이지 + 마스터/매핑 인프라)

### 1-1. DB 마이그레이션

신규 테이블:
- `defect_items_raw` — 메인 raw. PK `id uuid`, `UNIQUE(source_issue_no)`. 컬럼(주요만):
  - 시스템: `id`, `team team_type NOT NULL`, `data_date date`, `source_import_log_id uuid`, `is_active bool`, `row_version int`, `created_at`, `updated_at`, `updated_by`.
  - LetsBuild 원본: `source_issue_no text NOT NULL`(엑셀 `ID`), `location_raw`, `plan_title`, `plan_group`, `status_raw`, `assigned_to`, `category`, `defect_type`(`Type`), `item`, `description`, `priority`, `due_by date`, `created_by_name`, `created_by_team_name`, `created_date timestamptz`, `ir`, `forms`, `last_updated_at timestamptz`, `updated_description`, `updated_by_name`, `updated_status`, `updated_date_raw timestamptz`, `location_reference`, `classification`, `podium_area`.
  - SHAW 파생/추가: `issue_no text`(회사 규칙 표기 재계산), `subcontractor_issue_no`, `subcontractor_issue_source`, `main_trade`, `sub_trade`, `trade_detail`, `area_type`, `area_level`, `area_location`, `subcontractor_name`, `subsub_name`, `hdec_pic_name`, `hdec_eng_name`, `captured_by_name`, `work_type`, `classification_source`, `classified_at`, `planned_start_date`, `planned_completion_date`, `planned_closure_date`, `actual_start_date`, `actual_completion_date`, `actual_closure_date`, `planned_progress_pct`, `actual_progress_pct`, `completion_status`, `closure_status`, `hdec_verification`, `hdec_reason`, `hdec_comments`, `aconex_comments`, `remarks`, `priority_locked bool`, `hdec_verification_locked bool`, `is_critical bool`, `critical_marked_by uuid`, `critical_marked_at timestamptz`, `raw_payload jsonb`, `custom_payload jsonb`.
- `defect_field_config` — Task Management의 `task_management_field_config` 구조와 동일(`field_name`, `display_name`, `source_origin`, `is_enabled`, `sort_order`, `visible_to_roles`, `editable_to_roles`, ...). SHAW seed 값 삽입 + 위 컬럼 전부 seed.
- `defect_header_mappings` — `task_management_header_mappings`와 동일 구조(원본 헤더 텍스트 → target field, `is_active`, `is_custom`).
- `defect_import_logs` — Task Management 로그 구조 재사용(`total_rows`, `inserted`, `updated`, `skipped`, `rejected`, `status`, `data_date`, `rolled_back_at`).
- `defect_import_row_logs`, `defect_status_history`(status/priority/verification/lifecycle date 변경 이력), `defect_daily_snapshots`, `defect_schedule_change_audit`.
- 함수/트리거: `set_updated_at`, `defect_change_history_fn`(status_manual/priority/verification/dates 변경 시 이력 기록), `has_role` 기반 정책.
- Enum: `team_type`이 이미 있으면 재사용, 없으면 `('건축','전기','설비')` 신규 생성. `defect_action_taken`, `defect_upload_status` 등 SHAW enum 이식.
- RLS/GRANT: 인증된 사용자 SELECT/INSERT/UPDATE/DELETE + `service_role ALL`. 정책은 SHAW의 `can_update_defect` 스코프(admin/team/assigned) 이식.
- Rollback RPC: `rollback_defect_import`, `preview_rollback_defect_import`, `delete_defect_import_batch` — Task Management RPC와 대칭 구조.

### 1-2. 라이브러리

- `src/lib/defect-management/columns.ts` — field key/type/renderer 등록.
- `src/lib/defect-management/parser.ts` — 헤더 텍스트 → target field 매핑(`defect_header_mappings` DB 우선, 하드코딩 fallback). row 1 헤더 스캔 후 컬럼 인덱스 확정. `Category` 텍스트를 team 후보로 표시(파일 카드 힌트). `Location` → `area_type/area_level/area_location` 파싱(SHAW `parseArea` + `LEVEL_REGEXES` 이식). Excel serial 날짜 → ISO 변환. Team 선택값이 곧 저장 team.
- `src/lib/defect-management/derived.ts` — `completion_status`/`closure_status` 자동 판정 로직 이식(SHAW `defect-dashboard-utils` 축약).
- `src/hooks/useDefectFieldConfig.ts`, `useDefectHeaderMappings.ts` — Task Management의 대응 훅과 동일 시그니처.
- `src/hooks/useDefectRawData.ts` — 페이지네이션 fetch, `latestDataDate` 계산.
- `src/integrations/supabase/types.ts`는 마이그레이션 후 자동 재생성.

### 1-3. Raw Data 페이지

- `src/routes/_authenticated/closure/defect-management/raw-data.tsx` + `src/components/defect-management/raw-data/DefectRawDataPage.tsx`.
- SHAW `DefectRawDataPage` 축약본:
  - `@tanstack/react-table` + `@tanstack/react-virtual`(기존 사용 스택 유지). 기존이 아니라면 Task Management의 테이블 컴포넌트 재사용.
  - 컬럼 필터 드롭다운(multi-select / text / date-range / progress) — Task Management의 `ColumnFilters` 컴포넌트 재사용, defect 전용 wrapper.
  - 전역 검색(`RAW_SEARCH_FIELDS`), Team 필터, `is_active` 토글, Column visibility/order 메뉴, 상단 스크롤바.
  - Export 다이얼로그(single vs re-import-ready vs per-subcontractor ZIP). `styled-workbook`은 이미 있으므로 defect 컬럼 전용 view 정의만 추가.
  - Bulk edit bar(status, priority, hdec_verification 등)와 admin 전용 bulk delete.
  - 인라인 편집(EditCellPopover 재사용) + 편집 이력 Drawer(`defect_status_history` 조회).
- 관리자 페이지 추가: `src/routes/_authenticated/admin/mapping.tsx`에 **Defect Management 탭** 신설 → `DefectFieldConfigTable`, `DefectHeaderMappingTable`(기존 Task/Spare Part 컴포넌트 패턴 그대로 복제).
- 네비게이션: `AppLayout` 사이드바에 `Defect Management > Raw Data / Import / Import Logs / Dashboard` 항목 추가.

### 1-4. Detail 페이지(간이)

- `src/routes/_authenticated/closure/defect-management/records.$id.tsx` — Priority/HDEC's Verification/HDEC's Reason 편집 + 잠금(priority_locked, hdec_verification_locked) UI. 편집 이력 표시. SHAW `DefectDetailPage`의 핵심만 이식.

## Phase 2 — Import

### 2-1. 컨텍스트 & 워커

- `src/contexts/DefectManagementImportContext.tsx` — Task Management의 `TaskManagementImportContext`와 동일 구조:
  - 파일 상태 머신: `pending / parsing / pending_sheet_selection / ready / processing / done / failed`.
  - 파일별 필수 지정 필드: **Team(건축/전기/설비, 강제)**, Data Date, Sheet(단일 시트면 자동), 헤더-필드 매핑 확인, 제외 컬럼.
  - Team 미선택 파일은 `ready`로 진입 못 함(`Execute Import` 비활성화).
- `src/lib/defect-management/import-worker.ts` — 배치 upsert.
  - 매핑 우선순위: `columnOverrides` > DB `defect_header_mappings` > 하드코딩 `FIELD_ALIASES`(SHAW에서 이식) > 그대로 field key.
  - `source_issue_no` 기준 upsert. 값 변경 검출 시 `defect_status_history` 이력 삽입.
  - `priority_locked=true` row는 priority 스킵 + row_log에 `skipped_locked`. `hdec_verification_locked=true` row는 verification/reason 스킵.
  - Custom field(`custom:*` target) → `custom_payload`.
  - Re-import ready 파일 감지 → update-only 모드.
  - `progress`, `parsedCount`, `inserted/updated/skipped/rejected` 카운터.

### 2-2. 컬럼 매핑 다이얼로그

- `src/components/defect-management/import/DefectColumnMappingDialog.tsx` — Task Management의 `ColumnMappingDialog` 복제. 파일 헤더 목록 + 각 헤더의 데이터 샘플 + target field select. 자동 매핑 결과 pre-fill, override 저장은 파일 단위(옵션으로 `defect_header_mappings`에 영구 등록).
- `DefectColumnSelect` — 제외할 헤더 선택(성능 최적화용).

### 2-3. 페이지

- `src/routes/_authenticated/closure/defect-management/import.tsx` + `src/components/defect-management/import/DefectManagementImportPage.tsx`.
- Task Management Import 페이지와 동일 UX + Team select(Required) 추가. 파일 카드에 파싱된 Category 값 힌트 표시("Detected: Electrical → suggested team: 전기") — 참고용, 저장 값은 사용자가 선택한 team.
- Similar-master 결정 다이얼로그(subcontractor / subsub 유사 매칭): SHAW `SimilarMasterDialog`를 축약해 이식(subcontractor master 테이블 유무에 따라 skip 가능 — 아래 이슈).
- Import Logs 페이지: `src/routes/_authenticated/closure/defect-management/import.logs.tsx` — Task Management ImportLogsPage 재사용 or 복제. Rollback 다이얼로그 포함.

### 2-4. 보조 마스터 테이블(옵션)

SHAW의 `subcontractor_master`는 이 프로젝트에도 이미 존재. `defect_items_raw.subcontractor_name`/`subsub_name`이 마스터에 없을 때 자동 등록 or 유사도 매칭 팝업(Similar-master) 사용. 신규 서버 함수 `matchDefectSubcontractor` 추가.

## Phase 3 — Dashboard

### 3-1. 유틸

- `src/lib/defect-management/dashboard-utils.ts` — SHAW `defect-dashboard-utils`에서 필요한 부분만 이식:
  - `isActualComplete`, `isClosureComplete`, `isStageDelayedAsOf`, `isAtRisk`, `todayIso`, `diffMetrics`.
  - `aggregateDefectPlanActualByGroup(items, today, dataDate, groupKey, groupLabel, planMode)`.
  - `buildDefectSCurveAllStages(items, start, end, bucket, stages, groupBy)`.
- `src/hooks/useDefectDashboardData.ts` — team 필터 파라미터, 대량 fetch(1000 페이지 + safety cap 20k), latestDataDate 산출.

### 3-2. 페이지

- `src/routes/_authenticated/closure/defect-management/dashboard.tsx` + `src/components/defect-management/dashboard/DefectDashboardPage.tsx`.
- 핵심 KPI 스트립: Total / Completion% / Closure% / Overdue(start, completion, closure별) / At Risk / In Dispute. Cat A/Cat B/NoCat 3-way breakdown table.
- S-Curve 카드(`recharts`): stage=Start/Completion/Closure/All, group=none/subTrade/subcon/subsub/hdecPic/hdecEng/team/workType, bucket=day/week, plan vs actual cumulative + variance. 날짜 범위 컨트롤, group value 다중 선택, 시리즈 hide.
- Breakdown 탭: subTrade / subcontractor / subsub / hdecPic / hdecEng / team / workType — 각 그룹의 total, planned, actual, closure, overdue, deltas. 행 클릭 시 Raw Data로 필터 링크(SHAW 방식).
- Team 필터, `dataDate` 프리셋(latest import 자동 조회), plan mode 토글(baseline/remaining), Auto refresh 컨트롤.
- **범위 외(Phase 3에서는 생략)**: Critical Watchlist, Cat A dispute 패널, Captured-by 그룹, Recent Comments, Photo OCR, Aconex sync, Simulation.

## 위험/이슈

- **Enum `team_type`** 이미 존재 여부 확인 필요. 이미 `건축/전기/설비`로 정의돼 있으면 재사용, 아니면 신규 값 추가. Task Management에서 team 컬럼을 어떻게 저장하는지 참고.
- **UNIQUE 키 충돌**: SHAW는 `issue_no` 전역 unique. 이 프로젝트는 파일이 팀별로 나뉘고 LetsBuild `ID`는 팀 무관 전역 고유이므로 `source_issue_no`만 UNIQUE로 두는 것으로 충분. 혹시 팀 간 중복 가능성이 있으면 `(team, source_issue_no)` 복합 unique로 전환 결정 필요.
- **소스 엑셀에 lifecycle 날짜 없음**: `planned_start/completion/closure_date`, `actual_start/completion_date`는 null 저장 → Detail 편집으로 채움. Dashboard의 Overdue/At-risk 로직은 값 없으면 자연히 미집계.
- **Row 규모**: 업로드 파일이 23,667행 → 브라우저 파싱 시간·메모리 주의. `xlsx` streaming 옵션과 배치 upsert(500rows/tx) 필요.
- **파일당 파싱**: 다중 파일 병렬 파싱 시 UI 프리즈. Task Management와 동일하게 순차 처리.
- **Photo OCR / Aconex / Simulation 등 SHAW 부가 기능**은 이번 범위 제외 확정.

## 파일 트리(신규)

```
supabase/migrations/<new>.sql

src/lib/defect-management/
  columns.ts
  parser.ts
  derived.ts
  dashboard-utils.ts
  import-worker.ts
  bulk-actions.ts

src/hooks/
  useDefectFieldConfig.ts
  useDefectHeaderMappings.ts
  useDefectRawData.ts
  useDefectDashboardData.ts

src/contexts/
  DefectManagementImportContext.tsx

src/components/defect-management/
  raw-data/DefectRawDataPage.tsx
  raw-data/ExportDialog.tsx
  raw-data/BulkEditBar.tsx
  raw-data/ColumnFilters.tsx (or shared with Task)
  raw-data/EditCellPopover.tsx
  raw-data/HistoryDrawer.tsx
  detail/DefectDetailPage.tsx
  import/DefectManagementImportPage.tsx
  import/DefectColumnMappingDialog.tsx
  import/DefectColumnSelect.tsx
  import/SimilarMasterDialog.tsx
  dashboard/DefectDashboardPage.tsx
  dashboard/KpiStrip.tsx
  dashboard/SCurveCard.tsx
  dashboard/BreakdownTable.tsx

src/components/admin/
  DefectFieldConfigTable.tsx
  DefectHeaderMappingTable.tsx

src/routes/_authenticated/closure/defect-management/
  raw-data.tsx
  import.tsx
  import.logs.tsx
  records.$id.tsx
  dashboard.tsx
```

## 단계별 산출물 & 승인 체크포인트

1. **Phase 1 완료 조건**: 마이그레이션 승인 → Raw Data 페이지에서 수동 seed 데이터(SQL insert) 조회/필터/편집/이력 확인. Admin의 mapping/field-config 탭에서 편집 반영.
2. **Phase 2 완료 조건**: 업로드된 `Elec-_23667.xlsx`로 team=전기 임포트 시 23,667행 upsert 성공, Category 자동 매핑 힌트 노출, 재실행 시 update-only 동작, Rollback 정상.
3. **Phase 3 완료 조건**: 대시보드에서 KPI/S-Curve/Breakdown 렌더링, Raw Data와 카운트 일치, team 필터 정상.

각 phase 종료 시점에 커밋된 화면을 사용자와 함께 확인한 뒤 다음 phase 진입.
