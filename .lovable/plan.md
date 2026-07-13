# ABD (As-Built Drawing) Submission Management — Raw Data 모듈 구축 계획

## 0. 목표
- 신규 도메인 **ABD 제출 관리** 를 앱에 추가.
- **ABD Raw Data 페이지**를 만들고 상단에 **설비(MECH) / 전기(ELEC) / 건축(ARCH) 3개 탭**으로 구성.
- Raw Data 페이지의 **UI 및 모든 기능**은 `Defect Raw Data`(`src/components/defect-management/raw-data/DefectRawDataPage.tsx`) 를 그대로 준용 — 서버 페이지네이션/정렬/필터/전역검색, 컬럼 순서·가시성·고정(freeze)·리사이즈, 사용자별 view preference 저장, 셀 편집 팝오버, Bulk Edit, Export, Import Logs 뱃지, 활성/비활성 토글 등.
- 원본 엑셀은 사용자 마크다운 스펙(2–4행 다단 헤더)대로 파싱, 평탄화 스키마(34컬럼)로 저장. **재업로드 시 `ABD_NUMBER` upsert, 미포함 도면은 INACTIVE 처리, 변경 이력 남김.**

> 스코프가 커서 아래 **Phase 1(Raw Data + 스키마 + 최소 Import) → Phase 2(Import 상세 & 로그) → Phase 3(Detail/Dashboard 등)** 로 나눠 진행합니다. 이번 승인은 Phase 1 전체와 Phase 2 골격까지의 실행 승인으로 다룹니다.

## 1. 데이터베이스 스키마 (마이그레이션 1건)

### 1.1 신규 테이블
- `public.abd_items_raw` — ABD 도면 본체 (1행 = 1 도면)
  - 도메인 컬럼(마크다운 스펙 34개): `team`(mech/elec/arch), `plot`(C/D), `sl_no`, `dis`, `service`, `doc_ax`, `doc_axx`, `doc_nn1`, `doc_n`, `doc_nn2`, `document_title`, `abd_number`, `abd_ocs_no`, `pic`,
    `r1_drafting_plan/actual`, `r1_submission_plan/actual`, `r1_dar_plan/actual`,
    `r2_*`(6), `r3_*`(6), `latest_rev`, `latest_status`, `approval_date`.
  - 파생/관리 컬럼: `id uuid PK`, `is_active bool`, `inactive_reason text`, `field_mismatch bool`, `mismatch_fields jsonb`, `source_import_log_id uuid`, `data_date date`, `raw_payload jsonb`, `row_version int`, `created_at/updated_at/updated_by`, `status_group text GENERATED` (`approved`/`in_progress`/`not_started`, LATEST_STATUS 기준으로 산출).
  - 유니크 자연키: `UNIQUE(team, abd_number)` — 팀 스코프 upsert 키.
  - RLS: authenticated 읽기/쓰기, admin 삭제. GRANT 4행 포함.

- `public.abd_import_logs` — 임포트 배치 로그
  - `file_name, team, plot, sheet_name, total_rows, inserted, updated, inactivated, mismatched, skipped_no_key, errors jsonb, status, started_at/finished_at, imported_by, note, rolled_back_at/by`.
  - `team` CHECK: `mech`/`elec`/`arch`.

- `public.abd_change_log` — 변경 이력 (핵심 필드 diff)
  - `id, abd_item_id, team, abd_number, field, old_value, new_value, source ('import'|'manual'), upload_id, changed_by, changed_at`.
  - 트리거: `abd_items_raw` UPDATE 시 주요 필드(상기 18 날짜, `latest_rev`, `latest_status`, `approval_date`, `pic`, `document_title`) diff 기록. `app.change_source` GUC로 import/manual 구분.

- `public.abd_header_mappings`, `public.abd_field_config` — Defect와 동일 패턴의 헤더 매핑/필드 설정 테이블(관리자 화면용, Phase 2 활용).

### 1.2 유틸 함수 / RPC
- `public.abd_items_search(_team, _q, _filters, _sort, _offset, _limit)` — Defect의 `defect_items_search` 미러 (SHAW 스타일 콤마 AND 검색, `in/in_or_empty/text/empty/date_range/num_range/bool` 지원).
- `public.abd_items_facets(_column, _team)` — 컬럼별 파셋 카운트.
- `public.abd_items_counts(_team)` — 상태(approved/in_progress/not_started) 카운트.
- `public.rollback_abd_import(_batch_id, _force)` / `public.delete_abd_import_batch(_batch_id)` / `public.preview_rollback_abd_import(_batch_id)` — Defect와 동일 인터페이스.

## 2. 원본 엑셀 파서 (프론트 로직)

`src/lib/abd/parser.ts` 작성 — 브라우저 SheetJS(xlsx) 기반.

1. **시트 선택**: 파일 내 여러 시트 중 다음을 제외 → `Bar chart`, `Subcon`, 워드 `chart` 포함 시트, 헤더 미검출 시트. 시트명 예: `Plot D`, `Plot C`, `ABD Plot 4`, `ABD Plot 3`. 사용자에게 미리보기(Confirm) 후 진행.
2. **다단 헤더 감지**: row 4에서 `Sl.No`, `DIS`, `ABD NUMBER` 존재하는 행을 헤더 앵커로 자동 탐색(고정 4행 가정 실패 대비). row 2의 `ROUND N`(1~3) 밴드, row 3의 `DRAFTING/SUBMISSION/DAR RESPONSE` 밴드, row 4의 `PLAN/ACTUAL` 조합을 확장하여 컬럼 인덱스 → 정규 필드명 매핑.
   - ROUND 3 부재 시 자동 감지(밴드 없으면 `r3_*` 는 NULL).
   - `Appoval`(오타) → `approval_date`.
3. **행 파싱**: row 5부터 데이터. `#N/A`, 빈문자, 오류값 → NULL. 날짜는 JS Date → ISO 유지.
4. **ABD_NUMBER 정합화**:
   - `9207-BP12D-*` → `plot='D'`, `9206-BP12C-*` → `plot='C'`. 프리픽스로부터 `dis`, `doc_ax`, `doc_axx`, `doc_nn1`, `doc_n`, `doc_nn2` 재파싱.
   - 원본 셀 값과 재파싱 값이 다르면 `field_mismatch=true`, 어느 필드가 다른지 `mismatch_fields`(jsonb) 저장. **저장 시엔 파싱값을 진실로 사용** (스펙 4항).
   - `abd_number` 없는 행은 스킵(`skipped_no_key` 카운트).
5. **team 결정 우선순위**: (a) UI에서 사용자가 선택한 팀 → (b) 파일명 `MECH`/`ELEC`/`건축|ARCH` 자동 감지 → (c) 미감지 시 업로드 다이얼로그에서 필수 선택.
6. **결과**: `{ team, plot, sheet_name, rows: RowRecord[], skipped_no_key, warnings[] }`.

## 3. 임포트 UI (Phase 1: 최소, Phase 2: 완성)

`src/routes/_authenticated/closure/abd/import.tsx` + `src/components/abd/import/*`

- Phase 1: Defect Import UI(`DefectManagementImportPage.tsx`)의 파일 다중 업로드 → 파싱 → **중복 검토 다이얼로그**(같은 `abd_number` 존재 시 keep_last/first/manual) → **Preview**(시트/행수) → Start Import 흐름을 그대로 재사용/이식. 인증 서버 함수 `createServerFn`으로 `abd_items_raw` upsert + `abd_import_logs` 기록 + `abd_change_log` 자동 기록(트리거).
- Phase 2: 매핑 관리(admin), Import Logs 화면(`abd/import/logs`), Rollback/Delete 액션(Defect의 `RollbackDialog` 재사용 패턴).

## 4. Raw Data 페이지 (핵심 화면)

**라우트**: `src/routes/_authenticated/closure/abd/raw-data.tsx`
**컴포넌트**: `src/components/abd/raw-data/AbdRawDataPage.tsx` — Defect Raw Data의 구조를 1:1 이식(컬럼 정의만 ABD 스키마로 교체).

### 4.1 상단 헤더 영역 (Defect 동일)
- 제목 "ABD Raw Data" + 최신 데이터 기준일(`max(data_date)`).
- **탭**: `설비(mech) | 전기(elec) | 건축(arch)` — URL `?tab=` 로 유지. 탭 클릭 시 정렬/필터 초기화 유지 정책(Defect와 동일).
- 각 탭 우측에 상태 카운트 뱃지: `Total / Approved(A) / In-progress / Not-started`.
- 전역 검색(디바운스 300ms, `?q`), 새로고침, 활성/비활성 토글(`?includeInactive`), Import 이동 버튼, Export(엑셀).

### 4.2 컬럼 (ABD 도메인 매핑)
`src/lib/abd/columns.ts` — Defect의 `DEFECT_COLUMNS` 구조와 동일 형태로 정의.
- 기본 표시 순서: `sl_no, plot, dis, service, abd_number, abd_ocs_no, document_title, pic, latest_rev, latest_status, approval_date, r1_drafting_plan, r1_drafting_actual, ... r3_dar_actual, doc_ax..doc_nn2, field_mismatch, is_active`.
- 그룹: `Identity`(sl_no,plot,dis,service,abd_number,abd_ocs_no), `Content`(document_title,pic), `Latest`(rev,status,approval_date), `Round 1/2/3`(각 6컬럼), `Segments`(doc_*), `Flags`(field_mismatch,is_active).
- 라운드/서브밴드 헤더는 Defect의 origin-header 스타일(색상 구분) 그대로 사용.
- 상태 컬러: `A=green`, `B=amber`, `C=red`, `NOT YET/미제출=gray` 등 — Defect 상태 배지 스타일 재사용.

### 4.3 서버 페이지네이션·정렬·필터
- `useAbdItemsQuery(...)` 훅을 Defect와 동일 인터페이스로 신설(`hooks/useAbdItems.ts`), RPC `abd_items_search` 호출.
- 컬럼 필터 드롭다운(파셋/텍스트/날짜 range/숫자 range/빈값) — `ColumnFilterDropdowns.tsx` 로직 그대로 이식.
- URL 상태 스키마(`?tab, page, pageSize, sort, q, filters, includeInactive, plot, status, pic, ...`) — Defect의 zod 스키마 스타일로 정의, drilldown 파라미터도 대응.

### 4.4 인터랙션 (Defect와 동일)
- 행 클릭 → Detail 페이지(Phase 3, 우선은 사이드 팝오버로 raw_payload 표시).
- 셀 편집: `pic`, `latest_rev`, `latest_status`, `approval_date`, 각 라운드 `*_actual` 6종에 대해 `EditCellPopover` 재사용. 저장 시 `abd_change_log`에 자동 기록.
- 다중 선택 + Bulk Edit Bar(PIC 일괄 변경, 활성/비활성 토글, Export 선택 행).
- 상단 스크롤바 + 열 리사이즈 + freeze(추가 3열까지) — Defect 동일.
- 사용자별 view preference 저장: 키 `abd.raw-data.{tab}.v1` (`useUserViewPreference` 재사용).

### 4.5 Export
- Defect `ExportDialog.tsx`의 스키마 선택/컬럼 선택/필터 반영 옵션 그대로 이식. xlsx 파일로 저장.

## 5. 사이드바 & 라우팅
`src/components/layout/AppLayout.tsx` NAV 배열에 **Closure Document 그룹** 아래 다음 항목 추가:
- `ABD Raw Data` → `/closure/abd/raw-data` (icon `FileSpreadsheet` 또는 `Layers`)
- `ABD Import` (editor+) → `/closure/abd/import`
- `ABD Import Logs` (editor+) → `/closure/abd/import/logs`

파일 생성:
```
src/routes/_authenticated/closure/abd/
  raw-data.tsx
  import.tsx
  import.logs.tsx     (Phase 2)
```

## 6. 재임포트 정책 (스펙 5항)
- Upsert 키: `(team, abd_number)`.
- 신규 → INSERT, 기존 → 필드 diff 후 UPDATE + `abd_change_log`.
- **DB에 있으나 이번 파일에 없는 도면**: 동일 `team + plot` 스코프에서 `is_active=false`, `inactive_reason='missing_in_upload:{batch_id}'` 로 표시(삭제하지 않음).
- Import Summary 반환: `{inserted, updated, inactivated, mismatched, skipped_no_key}`. 임포트 완료 다이얼로그로 즉시 표시.

## 7. 가정 & 미확정 사항
- **건축(arch) 탭 스키마**: 업로드된 파일은 MECH/ELEC뿐. 건축 파일도 동일한 34컬럼 스키마와 다단 헤더 구조를 사용한다고 가정하고 동일 스키마로 저장(파일 도착 시점에 필요 시 재조정).
- **status 카테고리 매핑**: `latest_status` 값 중 `A`=`approved`, `B`/`C`=`in_progress`, `NOT YET`/공백=`not_started` 로 기본 그룹화. (필요 시 관리자 매핑 테이블로 재정의)
- 이번 스코프는 **CRUD/Import/Raw Data**까지. **Dashboard 화면**은 Phase 3에서 별도 계획.

## 8. 산출 파일 (Phase 1 실행 시 생성/수정)
- 마이그레이션 1건 (섹션 1)
- `src/lib/abd/columns.ts`, `src/lib/abd/parser.ts`, `src/lib/abd/filter-fns.ts`
- `src/hooks/useAbdItems.ts`, `src/hooks/useAbdFieldConfig.ts`
- `src/components/abd/raw-data/AbdRawDataPage.tsx` (+ Defect raw-data 하위 파일 이식 사본: ColumnFilterDropdowns/TopHorizontalScrollbar/EditCellPopover/BulkEditBar/ExportDialog 등)
- `src/components/abd/import/AbdImportPage.tsx` (+ DuplicateReviewDialog 이식)
- `src/routes/_authenticated/closure/abd/raw-data.tsx`, `import.tsx`
- `src/components/layout/AppLayout.tsx` NAV 항목 추가
- 서버 함수: `src/lib/abd/abd.functions.ts` (import/upsert/rollback wrapper)

승인 시 위 순서로 진행하겠습니다.
