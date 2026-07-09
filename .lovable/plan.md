
# Spare Part Raw Data — SHAW Defect Raw Data 완전 이식

현재 `SparePartRawDataPage.tsx`(약 570줄, 기본 필터·정렬·가상화만)를 SHAW의 `DefectRawDataPage.tsx`(1,801줄, 완전한 데이터그리드 워크벤치)와 동일한 UI/기능으로 재구현합니다. Defect → Spare Part 도메인 필드로 매핑만 바꾸고 헤더 레이아웃·툴바 구성·필터 팝오버·툴팁·상호작용·저장 규칙까지 SHAW와 동일하게 맞춥니다.

## 사용자 결정사항 반영

1. **Export 그룹핑 기준**: `Plot / Supplier / Manufacturer` 3개 축을 라디오로 선택. 각 축별 그룹 수가 7개 이상이면 ZIP.
2. **Bulk 편집 가능 필드**: `remarks, action, proc_remarks, is_active, is_duplicate` + Aconex Sync 대상인 `approval_code, approval_status, revision`까지 총 8개. (Aconex Sync 재실행 시 수동 편집값이 덮어써질 수 있음을 확인 다이얼로그에 명시)
3. **Detail 페이지 링크**: 행 클릭 → `/closure/spare-part/records/:docRef`로 이동, 빈 스텁 페이지만 생성(“Detail — 준비 중” + doc_ref 표시). 실제 구현은 이후 단계.
4. **Sticky (Frozen) columns**: 좌측 4개 고정. **`doc_ref`는 최좌측 고정 불변**, 나머지 3개 슬롯은 사용자가 컬럼 목록에서 순서 조절 가능. drag-and-drop 재정렬 후 localStorage 영속.

## SHAW parity 대상 기능 (모두 이식)

**툴바 (상단)**
- 좌: 페이지 타이틀 + 최신 데이터 일자 배지 + Selection count + 필터/총 rows 카운트
- 중: 전역 검색 인풋 (comma = AND 토큰, `RAW_SEARCH_FIELDS` 매칭, debounced)
- 우: Column visibility & 순서 조절 메뉴, Frozen slot 편집기, Reset filters, Refresh, Import(→ /import), Export(다이얼로그)

**Export 다이얼로그**
- 모드: Single file / Per group
- Group by: **Plot / Supplier / Manufacturer** 라디오
- Format: View format(현재 컬럼/정렬/필터 반영) / Re-import format(46 표준 헤더 원본 형식)
- Per group에서 그룹 수 ≥ 7이면 자동 ZIP, 미만이면 개별 xlsx 순차 다운로드

**컬럼 헤더 & 순서**
- 최좌측 pinned: `__select` (row checkbox, all-select), `doc_ref` (고정, 재정렬 불가)
- 그 뒤 3개 슬롯: 사용자가 지정한 컬럼 (기본값: `plot`, `subject`, `approval_code`) — 순서 조절 가능
- 그 이후 컬럼: 사용자가 visibility 메뉴에서 dnd로 순서 조절
- 컬럼 리사이즈, 사이즈/순서/frozen slot 모두 localStorage 영속
- 각 헤더에 정렬 아이콘 + 필터 아이콘 팝오버
- Multi-sort (Shift+click)
- 그룹(id/approval/vendor/qty/cost/…)별 헤더 배경 색상 (SHAW `getOriginHeaderStyle` 대응)

**컬럼 필터 팝오버 4종 (SHAW UX 동일)**
- MultiSelect + faceted count + `(Empty)` + Select all / Clear all
- Text: comma-AND 토큰 + Empty only
- DateRange: from/to + Empty only
- NumberRange: cost/qty/progress용 min/max + Empty only (SHAW `NumberRangeDropdown` 포팅)
- 필터 타입은 `SPARE_PART_COLUMNS.type`으로 자동 추론

**필터 칩바**
- 활성 필터 개별 chip, x로 제거, "Clear all filters" 버튼

**Bulk Edit Bar (SHAW 포팅)**
- Row 선택 시 하단 sticky bar
- 편집 필드: `remarks, action, proc_remarks, is_active, is_duplicate, approval_code, approval_status, revision`
- admin/superuser만 노출, 낙관적 업데이트 + refetch
- approval_* 편집 시 "이 값은 다음 Aconex Sync에서 덮어써질 수 있습니다" 경고 표시

**셀 렌더링**
- approval_code / plot 색상 뱃지
- boolean 체크/엑스
- progress: 미니 바 + %
- cost: tabular-nums 2 decimals
- date: `formatDdMmm`
- overdue 행 배경 하이라이트 (delivery_date 기준)
- 셀 hover 툴팁 = 원본 값

**가상화 & 스크롤**
- TanStack Virtual, overscan 12
- 상단 `TopHorizontalScrollbar` 포팅

**URL 드릴다운**
- `useSearch`로 `plot`, `approval_code`, `overdue`, `supplier`, `category`, `manufacturer` 프리필터
- Dashboard 카드 클릭 → Raw Data 이동 시 자동 적용

**상태 영속**
- `qail-spare-part-raw-data-state:{user.id}` localStorage에
  sorting, columnSizing, visibility, columnOrder, frozenSlots, columnFilters, globalFilter 저장
- Reset 버튼으로 초기화

**행 클릭**
- `/closure/spare-part/records/:docRef` 이동 (빈 스텁 페이지)

## 파일 변경

**신규**
```
src/components/spare-part/raw-data/
  BulkEditBar.tsx                # 8개 필드 편집 + Aconex 경고
  ColumnFilterDropdowns.tsx      # MultiSelect/Text/DateRange/NumberRange
  TopHorizontalScrollbar.tsx
  ExportDialog.tsx               # Plot/Supplier/Manufacturer 그룹핑
  ColumnOrderMenu.tsx            # dnd 재정렬 + frozen slot 편집
  filter-fns.ts
src/hooks/
  useFrozenColumnSlots.ts        # doc_ref + 3 slots, localStorage
src/lib/spare-part/
  filter-chip-utils.ts
  field-filter-type.ts
  excel-export.ts                # single / per Plot|Supplier|Manufacturer / ZIP
  origin-header-style.ts
  format.ts
src/routes/_authenticated/closure/spare-part/
  records.$docRef.tsx            # Detail 스텁
src/components/spare-part/detail/
  SparePartDetailStub.tsx        # "준비 중" 페이지
```

**수정**
- `src/components/spare-part/raw-data/SparePartRawDataPage.tsx` — SHAW `DefectRawDataPage.tsx` 구조 1:1 이식, Spare Part 46 필드 + 커스텀 필드
- `src/lib/spare-part/columns.ts` — `filterType`, `group` 헤더 스타일 보강

**의존성**
- `xlsx`, `jszip` (없으면 추가)
- `@dnd-kit/core`, `@dnd-kit/sortable` (컬럼 순서 조절용, 없으면 추가)

## 기술 노트

- SHAW는 React Router DOM, QAIL은 TanStack Router — `useSearch`, `useNavigate`, `Link`로 치환만.
- SHAW의 `useDefectFieldConfig`는 미포팅. 1차는 `SPARE_PART_COLUMNS` 정적 + `spare_part_custom_fields` 동적 병합.
- `is_active=false`는 기본 숨김 + "Include inactive" 토글.
- Bulk 편집 RPC: 기존 `spare_parts_raw` UPDATE 정책(admin/superuser)에 의존.
- `records.$docRef.tsx`는 스텁이지만 `head()`로 `title: "Spare Part — {docRef}"` 설정.

## 진행 단계

1. 유틸/훅 신규 파일 스캐폴딩 (filter-fns, filter-chip-utils, useFrozenColumnSlots, origin-header-style, format, excel-export)
2. 필터 팝오버 4종 + TopHorizontalScrollbar 포팅
3. ColumnOrderMenu (dnd) + frozen slot 편집기
4. BulkEditBar (8개 필드, Aconex 경고)
5. ExportDialog (Plot/Supplier/Manufacturer × View/Reimport, ZIP≥7)
6. `SparePartRawDataPage.tsx` 재작성 — SHAW 구조 1:1
7. `columns.ts` filterType/group-header 보강
8. Detail 스텁 라우트 추가
9. URL 드릴다운(`useSearch`) 매핑
10. localStorage 상태 영속 & Reset
11. Playwright E2E: 필터/정렬/컬럼 순서 dnd/Frozen slot/Export 3축/Bulk edit 검증
