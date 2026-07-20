
## 목표
DMR Raw Data 페이지를 SM Raw Data 수준의 진짜 테이블로 재구성. 행 단위는 (report_date · discipline · system_name · contractor_name · plot), 컬럼은 Plan / Actual / Diff(=Actual−Plan). Yesterday는 파싱 중단 + DB에서 제거.

## 1. 데이터 모델 변경 (마이그레이션)

현재 `dmr_entries`는 (metric ∈ target|today|yesterday) × (plot ∈ C|D|TOTAL) 롱포맷. Plot 단위 pivot을 위해 metric을 컬럼으로 승격.

- 신규 컬럼 추가: `plan_manpower int`, `actual_manpower int`, `diff_manpower int GENERATED ALWAYS AS (COALESCE(actual_manpower,0)-COALESCE(plan_manpower,0)) STORED`.
- 데이터 이관: 동일 (date, discipline, system, contractor, plot) 그룹으로 target→plan_manpower, today→actual_manpower를 UPSERT. 이관 후 yesterday 행 및 target/today의 원본 행 정리.
- 유니크 키를 (report_date, discipline, system_name, contractor_name, plot) 단일 행으로 재정의(unique index).
- 기존 `metric`, `manpower` 컬럼은 하위 호환을 위해 유지하되 신규 컬럼을 정본으로 사용(추후 별도 클린업).
- Import RPC/서버함수(`bulkUpsertDmrEntries` 계열)와 대시보드 쿼리에서 plan/actual/diff 컬럼을 읽도록 수정. 대시보드는 기존 metric 필터 로직을 plan/actual 매핑으로 치환.

## 2. 파서/임포트 변경

- `src/lib/dmr-parse.functions.ts`, `src/lib/dmr-prompt.server.ts`, `DmrPreviewTable.tsx`, `DmrImportPage.tsx`에서 yesterday 처리 제거(스키마·프롬프트·프리뷰 UI·업서트 전부).
- `DmrParsedRow.values`를 `{ plan: {C,D,TOTAL}, actual: {C,D,TOTAL} }`로 개편, 타입 `DmrMetric = 'plan' | 'actual'`로 축소.
- 업서트 로직: 행마다 plot별 (plan, actual) 3개 행 upsert. diff는 생성 컬럼이므로 계산 불필요.

## 3. Raw Data UI 재작성 (`DmrRawDataPage.tsx`)

SM `DefectRawDataPage`의 패턴을 이식:
- 좌측 스티키 체크박스/키 컬럼, 상단 스티키 헤더, 100% 불투명 배경(메모리 규칙 준수).
- 컬럼: ✔ | Date | 공종 | System | Contractor | 유형(직영/협력사) | Plot | Plan | Actual | Diff.
- 컬럼별 드롭다운 필터(공종·System·Contractor·Plot·유형·Date 범위) — `ColumnFilterDropdowns` 패턴 이식, 텍스트 컬럼은 목록 필터 + Select all + Clear.
- 다중 필드 정렬 토글 헤더(현행 유지, Plan/Actual/Diff 정렬 추가). Diff 음수 강조(빨강), 양수 초록.
- 컬럼 순서/표시 메뉴(`ColumnOrderMenu` 이식) + `user_view_preferences`에 `view_key='dmr_raw_data'`로 저장.
- Bulk Edit Bar: 선택 행에 Plan/Actual 일괄 설정, 공종/System/Contractor/Plot 일괄 변경, Bulk Delete. 기존 `DmrBulkEditBar` 확장.
- Export 다이얼로그: 현재 필터/정렬/컬럼 순서 반영해 xlsx로 내보내기(SM `ExportDialog` 축소판).
- 필터된 전체 선택 및 페이지네이션(500행) UX는 SM 방식으로 재정렬.

## 4. 서버함수 조정

- `fetchDmrFilteredIds`, `bulkUpdateDmrEntries` 를 새 스키마(plan_manpower/actual_manpower)에 맞춤. `metric` 파라미터 대신 `field ∈ plan|actual` + 값.
- Dashboard/Progress 쿼리(`DmrDashboardPage`)에서 target/today 참조를 plan/actual로 치환.

## 기술 세부사항

**DB 마이그레이션 순서**
1. `ALTER TABLE dmr_entries ADD COLUMN plan_manpower int, actual_manpower int;`
2. UPDATE로 기존 target/today 값을 group별로 pivot(임시 CTE + upsert).
3. `DELETE FROM dmr_entries WHERE metric='yesterday';` 이후 target/today 중복 행 정리.
4. Unique index `(report_date, discipline, system_name, contractor_name, plot)` 신설, 기존 unique 제거.
5. `diff_manpower` generated 컬럼 추가.
6. RLS/GRANT는 기존 정책 유지.

**타입**
`DmrEntryRow`에 `plan_manpower`, `actual_manpower`, `diff_manpower` 추가. `metric` 필드는 deprecated 주석 후 UI에서 제거.

**영향 파일 (요약)**
- Migration 1건
- `src/lib/dmr/types.ts`, `src/lib/dmr-parse.functions.ts`, `src/lib/dmr-prompt.server.ts`, `src/lib/dmr-import.functions.ts`, `src/lib/dmr-mutations.functions.ts`, `src/lib/dmr/bulk-actions.ts`
- `src/components/resource/dmr/DmrRawDataPage.tsx`(전면 재작성), `DmrBulkEditBar.tsx`, `DmrPreviewTable.tsx`, `DmrImportPage.tsx`, `DmrDashboardPage.tsx`
- 신규: `DmrColumnFilterDropdowns.tsx`, `DmrColumnOrderMenu.tsx`, `DmrExportDialog.tsx` (SM에서 이식·축소)

## 확인 필요
- 위 스키마 변경(신규 컬럼 + generated diff + yesterday 삭제)이 임포트 히스토리에 영향이 있는데, **롤백 대상 배치의 yesterday 행이 이미 삭제되므로 과거 배치는 완전 롤백 불가**해집니다. 그래도 진행해도 되나요?
