## Defect Raw Data — SHAW PROJECT CMS 대비 재점검 및 일치화 계획

SHAW `src/pages/DefectRawDataPage.tsx` (1,801줄) 와 현재 `src/components/defect-management/raw-data/DefectRawDataPage.tsx` (200줄) 를 1:1 대조한 결과입니다. UI 골격/필터/편집/네비게이션 대부분이 현재 미구현입니다. 아래 A/B 두 구획으로 나눠 진행합니다.

### A. 이번 회차 일치화 대상 (전면 재작성)

#### A-1. 테이블 인프라 & 필터
- `@tanstack/react-table`, `@tanstack/react-virtual`, `jszip` 도입 (아직 미설치 확인 후 `bun add`).
- 컬럼 정의를 SHAW `DEFECT_RAW_FIELDS` 순서/그룹과 동일하게 재구성. 상단 고정 컬럼: `__select`(체크박스), `is_critical`, `stage_progress`(가상), `issue_no`.
- 필터 훅: `multiSelectFilterFn`, `textFilterFn` (comma AND 토큰), `dateRangeFilterFn`, `progressFilterFn`, `globalDefectFilterFn` — 모두 이식.
- 컬럼별 드롭다운 UI: `MultiSelectDropdown`(facet count + `(Empty)` + Select/Clear all), `TextFilterDropdown`, `DateRangeDropdown`. 헤더 우측 filter 아이콘.
- 다중 정렬 (Shift+클릭), 리사이즈 (더블클릭 auto-fit), 컬럼 visibility 는 `useDefectFieldConfig().isFieldVisible(field, roles)` 결과에 연동.
- 가상 스크롤 바디(row 높이 36px, overscan 12), Sticky 헤더 + 좌측 frozen 컬럼(모바일 1개 / 데스크톱 1~4개, `useFrozenColumnCount` 훅 필요 시 신규 추가).
- `TopHorizontalScrollbar` 컴포넌트 신규 (SHAW 이식) 로 상단 미러 가로 스크롤.
- 500행 캡 제거.

#### A-2. 상단 컨트롤 바
- 전역 검색 (300ms debounce, comma AND, `RAW_SEARCH_FIELDS` 범위).
- Export 버튼 → `<Dialog>` 형식 선택 (View-friendly / Re-import ready) + 출력 (Single / Per-subcontractor, 서브콘 ≥ 7 시 ZIP 안내). `src/lib/defect-management/excel-export.ts` 신규 (SHAW `defect-excel-export.ts` 기반).
- Refresh / Dashboard / Import / Import Logs 링크 유지.
- Latest Data Date, 총건수, Critical 건수 요약 라인 유지.

#### A-3. URL Drill-down 파라미터
SHAW `urlMap` 전체 이식 (파라미터 → columnFilter 자동 세팅):
`source, actualComplete, closureComplete, overdue, atRisk, atRiskDays, dueOn, unplannedActualOn, stage, capturedByGroup, notClosureDone, catADispute, hdecVerification, hdecReason, dateStart, dateEnd, dateField` (총 17종). 대시보드에서 진입 시 localStorage 저장 상태 무시.

#### A-4. 상태 영속화
- 사용자별 키 `defect-raw-data-state:${userId}` 로 sorting / columnFilters / columnSizing / globalFilter / rowSelection 저장.
- Drill-down 파라미터 존재 시 우회.
- 활성 필터 chip UI 2행 (URL chip + column chip, `buildColumnFilterChips` 유틸 이식).

#### A-5. 셀 렌더링 규칙 (SHAW 일치)
- `issue_no`: 클릭 시 상세 페이지로 이동 + 코멘트 배지 (본 회차 상세 페이지는 존재하되 코멘트 배지는 스텁으로 표시).
- `closure_status / status / completion_status`: `DefectStatusBadge` 신규 (기존 `STATUS_COLORS` 재활용).
- `team`: `formatTeamLabel` 활용.
- `planned_progress_pct / actual_progress_pct`: `formatPct`.
- `classification_source`: rule/discipline/manual/unclassified 배지.
- 날짜 컬럼: `formatDdMmm` (SHAW 이식). Origin 헤더 배경색: `getOriginHeaderStyle` 이식 (`defect_field_config.origin` 컬럼 없으면 all `system`).
- Sticky 셀 배경: overdue = `hsl(var(--destructive) / 0.06)`, closed = `hsl(var(--muted) / 0.45)`.

#### A-6. Bulk 편집 / Critical 토글 바
- `BulkEditBar` 이식 (defect 엔티티, `getDefectBulkEditableFields` 기반). Reassign 다이얼로그 제외 (별도 필요 시 후속).
- `CriticalPendingBar` + `CriticalBulkBar` 이식. Admin 판정은 `useCurrentUser` 확장으로 `isAdmin` 반환값 추가.
- 낙관적 업데이트: 로컬 items 캐시 patch + `useDefectRawData` refetch.

#### B-4. 상세 페이지 (`/closure/defect-management/detail/$issueNo`)
- 신규 라우트 파일 + 컴포넌트: 그룹화된 필드 뷰(identity / status / classification / content / location / plan / trade / people / audit / dates / progress / refs / flags), 상태 이력 타임라인(`defect_status_history`), 뒤로가기 시 `location.search` 복원, 필드별 inline 편집(A-B-6 재사용).

#### B-6. 인라인 편집 (`EditCellPopover`)
- 컬럼 정의 `editable / editorType` 기반 (text / textarea / select / date / number).
- 잠금: `priority_locked`, `hdec_verification_locked` 존중.
- 저장은 `defect_items_raw` 직접 upsert (`requireSupabaseAuth` 사용하는 신규 서버 함수 `updateDefectField.functions.ts`).
- 감사 로그: `defect_status_history` 에 change_type='inline_edit' 로 기록 (기존 스키마 재활용).

### B. 일치 불가/후속 보고 (본 회차 제외)

| 항목 | 사유 | 대안 |
|---|---|---|
| B-1. 코멘트/지시(`defect_comments`) 배지·필터·Realtime | 테이블·RPC 부재 | 별도 승인 시 스키마 도입 |
| B-2. `DefectStageProgress` 정식 pip UI | `defect-dashboard-utils`(isStageDelayedAsOf 등) 미이식 | 이번 회차는 문자열 라벨(`Not Started/In Progress/Completed/Closed/Delayed`)만 표시 |
| B-3. Origin 헤더 색상(hdec/aconex/system) | `defect_field_config.origin` 컬럼 미존재 | 마이그레이션+세팅 후 후속 |
| B-5. Aconex Comments 필드 sync | 파이프라인 미존재 | 별도 승인 시 도입 |
| B-7. Captured By Group | 규칙 사전(`captured-by-groups`) 미존재 | 별도 승인 시 도입 |
| Reassign 다이얼로그 | 마스터 데이터 규모 필요 | 후속 |

### 구현 순서 & 산출 파일 (신규)

1. `bun add @tanstack/react-table @tanstack/react-virtual jszip xlsx-js-style`
2. `src/lib/defect-management/filter-fns.ts`, `filter-utils.ts`, `url-filters.ts`, `state-storage.ts`, `excel-export.ts`
3. `src/components/defect-management/raw-data/`
   - `ColumnFilters.tsx` (Multi/Text/Date)
   - `DefectStatusBadge.tsx`
   - `EditCellPopover.tsx`
   - `BulkEditBar.tsx`
   - `CriticalPendingBar.tsx`, `CriticalBulkBar.tsx`
   - `TopHorizontalScrollbar.tsx`
   - `ExportDialog.tsx`
   - `DefectRawDataPage.tsx` (전면 재작성)
   - `DefectRawTableView.tsx`
4. 상세 페이지: `src/routes/_authenticated/closure/defect-management/detail.$issueNo.tsx` + `src/components/defect-management/detail/DefectDetailPage.tsx`
5. 서버 함수: `src/lib/defect-management/mutations.functions.ts` (`updateDefectField`, `bulkUpdateDefects`, `toggleCritical`).
6. `useCurrentUser` 에 `isAdmin` 추가 (user_roles 조회 이미 존재하는지 확인 후 확장).
7. 로컬 검증: `bun run build`, Playwright 로 `/closure/defect-management/raw-data` 스크린샷 (필터 열기 / 정렬 / 상세 이동 3장).

### 스코프 준수 확인

- 이전 미구현 지시(A + B4 + B6)를 이번 회차에서 실행합니다.
- 상기 "일치 불가" 항목은 임의로 축소·대체하지 않고 사용자에게 보고 후 별도 승인 대기합니다.
- 진행 승인 시 위 순서대로 실행합니다.