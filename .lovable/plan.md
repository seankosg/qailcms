# Snag List Raw Data — 가상 스크롤 + "All" 페이지 옵션

## 목표
현재 `PAGE_SIZE_OPTIONS = [50, 100, 200, 500]` 상한을 확장해, "All"을 선택하면 서버에서 전체 행을 가져와 한 페이지에 표시. 성능 저하 없이 표시하기 위해 테이블 바디에 가상 스크롤(row virtualization)을 도입.

## 범위
- 대상: **Snag List (Defect Management) Raw Data 페이지만** — Task/Spare/ABD는 이번 스코프에서 제외 (동일 패턴이 검증되면 후속 이관).
- UI/렌더 계층만 변경. Business logic, 서버 함수, DB, 필터/정렬 로직은 그대로 유지.

## 변경 사항

### 1. `src/components/defect-management/raw-data/DefectRawDataPage.tsx`
1. `PAGE_SIZE_OPTIONS`에 `"all"` 옵션 추가. 내부적으로 `pageSize` 상태는 숫자 유지하되, "all" 선택 시 매우 큰 값(예: `Number.MAX_SAFE_INTEGER` 또는 계산된 `total`) 대신 **별도 플래그 `isAllPage`**를 두고 서버 쿼리에 전달.
2. URL search schema (`pageSize`)는 `number | "all"` 허용하도록 `raw-data.tsx` 라우트의 `zod` 스키마 확장.
3. Select UI에 "All" 항목 추가. "All" 선택 시:
   - 페이지네이션 컨트롤(이전/다음, 페이지 번호) 숨김.
   - 표시 카운트: `1–{total} / {total}`.
   - `page`는 강제로 1 고정.
4. `useDefectItemsQuery`에 `pageSize: "all"`을 넘길 수 있게 파라미터 확장. 서버에서 `range` 없이 전체 조회하도록 처리(내부적으로 1000행 단위 페이지네이션 루프 — `fetchAllByUploadId`와 동일한 패턴).
5. 테이블 바디에 `@tanstack/react-virtual`의 `useVirtualizer` 적용:
   - 스크롤 컨테이너: 기존 `<div ref={tableRef} className="... overflow-auto">`.
   - `estimateSize`: 기본 행 높이(예: 40px), `overscan: 10`.
   - `<TableBody>`를 커스텀 렌더로 교체: 상단/하단 스페이서 `<tr>`(높이 = virtualizer가 계산한 offset)로 스크롤 영역 유지, 중간에 가상화된 행만 `<TableRow>`로 렌더.
   - Sticky column, hover, selection, row click 등 기존 로직은 그대로 유지.
6. Horizontal `TopHorizontalScrollbar`와의 좌표 동기화는 기존 로직 유지 (수직 가상화만 도입, 수평은 그대로).
7. Bulk selection 관련 카운트/`selectedIds` 로직은 이미 `rows` 배열 기반이라 그대로 동작 (렌더만 가상화되고 데이터 배열은 전체 유지).

### 2. `src/hooks/useDefectItems.ts` (또는 관련 쿼리 훅)
- `pageSize: number | "all"` 시그니처 확장. "all"일 때 서버 함수에 무제한 요청 전달.

### 3. `src/lib/defect-management/mutations.functions.ts` 또는 items 조회 서버 함수
- 조회 함수에 `pageSize: number | "all"` 처리 추가. "all"이면 1000 단위 페이지네이션 루프로 전체 수집.

### 4. `src/routes/_authenticated/closure/snag-management/raw-data.tsx`
- `pageSize` zod 스키마를 `z.union([z.number().int(), z.literal("all")])`로 확장.

## 사용자 경고 (UX)
"All" 선택 시 첫 로드는 데이터 양에 따라 느릴 수 있으므로 Select에 "All (전체)" 라벨 표시. 별도 다이얼로그는 생략(가상화 덕분에 렌더 자체는 부드러움).

## 기술 세부 사항 (참고)
```text
<div ref={tableRef} overflow-auto>       ← 스크롤 컨테이너 = virtualizer scrollElement
  <Table>
    <TableHeader sticky />
    <TableBody>
      <tr style="height: {paddingTop}px" />   ← 상단 스페이서
      {virtualItems.map(vi => <TableRow row={rows[vi.index]} />)}
      <tr style="height: {paddingBottom}px" />  ← 하단 스페이서
    </TableBody>
  </Table>
</div>
```

`@tanstack/react-virtual` v3.14는 이미 설치되어 있어 추가 설치 불필요.

## 검증
- `bunx tsgo --noEmit` 타입 체크.
- Playwright: Snag List → pageSize를 "All"로 변경 → 스크롤 시 새 행이 렌더되는지 스크린샷 확인, 콘솔 에러 확인.
- Sticky column 배경 불투명 규칙(기존 memory) 유지 확인.

## 스코프 외 (명시적으로 제외)
- Task/Spare/ABD raw-data 테이블 가상화 이관 — 별도 요청으로 처리.
- 컬럼 필터 드롭다운 집계 최적화(대용량에서 여는 속도) — 필요 시 후속.
