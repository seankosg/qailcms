## 목표

Import Hub(`/import-log/import`)의 4개 탭(Task Management / Snag List / Spare Part / ABD) UI를 **Snag List 탭(DefectManagementImportPage)의 레이아웃/구성과 완전 동일하게** 이식합니다. 안내 문구, 규칙, 도메인별 필드는 각 탭의 현재 워딩을 그대로 유지합니다.

## 기준(Snag List) UI 구조

`DefectManagementImportPage`의 골격:

```text
<div class="space-y-4">
  <h1 (Snag List — Import)> + <p 안내문구/규칙>
  ┌ Card ────────────────────────────────────────┐
  │  Header: "1. Upload Files" + Description     │
  │  Body:  드롭존 (border-2 border-dashed, p-10)│
  └──────────────────────────────────────────────┘
  ┌ Card (files.length>0) ───────────────────────┐
  │  Header: "2. Files (N)"  |  [Clear all][Start│
  │           N ready to import        import(N)]│
  │  Body: FileRow 리스트                        │
  │    - FileSpreadsheet 아이콘                  │
  │    - 파일명 · size · rows · sheet · headers  │
  │    - 컨트롤바: Sheet select / Data Date /    │
  │      컬럼 선택 / (도메인 고유 스위치/셀렉트) │
  │    - 경고/에러/중복 알림 박스                │
  │    - 우측: 상태 Badge + X 제거 버튼          │
  │    - processing 시 Progress                  │
  │    - result 시 Inserted/Updated/... Badge 열 │
  └──────────────────────────────────────────────┘
  (도메인별 Dialog들: ColumnSelect, Duplicate 등)
</div>
```

## 적용 대상 및 처리 방식

### 1. Task Management 탭 (`TaskManagementImportPage.tsx`)
- 최상단 안내문구(`QAIL Task Management … (discipline, task_no)`) **그대로 유지**.
- 전역 옵션(Rollup mode, 판정 재계산 토글 등)은 `1. Upload Files` Card **위의 별도 Card**(제목 "Options")로 정리 — Snag에는 없지만 도메인 고유 기능이라 유지.
- 드롭존/파일 카드/헤더 문구("1. Upload Files", "2. Files (N)", "N ready to import", 버튼 라벨 `Clear all`, `Start import (N)`)를 Snag과 동일한 클래스/구조로 정렬.
- FileRow 재구성: 좌측 `FileSpreadsheet` 아이콘 → 파일명(+isReimport 등의 뱃지) → 메타라인 → 컨트롤바(Discipline Select · Data Date Input · 컬럼 매핑 버튼 · 충돌 검토 버튼 · Preview 버튼) → 경고/충돌 알림 박스 → 우측 상태 Badge + X.
- `processing` 시 Progress, `done` 시 결과 Badge 열 표시 방식 Snag과 동일.
- `ColumnMappingDialog`, `ConflictReviewDialog`, Preview `Dialog`는 그대로 사용(트리거만 재배치).

### 2. Spare Part 탭 (`SparePartImportPage.tsx`)
- 안내문구/규칙 워딩 유지.
- 동일 골격으로 재작성: 상단 헤더 → Upload Card → Files Card → FileRow(파일명 · 메타 · Data Date(있으면) · 컬럼 선택 버튼 · 경고 · 상태 Badge · X).
- `useSparePartImport`의 기존 기능(컬럼 제외, Start import 등) 그대로 연결.

### 3. ABD 탭 (`AbdImportPage.tsx`)
- 현재 안내문구/`임포트 규칙` Alert 내용은 그대로 유지하되, 위치를 Snag의 안내문구 자리로 옮기고 Alert 컴포넌트는 유지.
- 우상단 `Raw Data` 링크 버튼은 유지(Snag 상단 우측 액션과 시각적으로 동일한 위치).
- 드롭존을 Snag과 동일한 `border-2 border-dashed p-10` 클릭 카드로 교체(기존 `<label>` 폼).
- Files Card와 FileRow를 Snag과 동일한 구조로 재작성: 파일명 · 메타(size, sheet 수, ignored) · 컨트롤(팀 Select) · 시트별 상세는 Snag의 "Category 감지" 라인처럼 파일 카드 하단 텍스트 라인으로 표기 · 상태 Badge/X.
- `Start Import` / `모두 지우기` 버튼을 Files Card 헤더 우측으로 이동(Snag과 동일).
- 결과 뱃지 색상/스타일은 Snag과 동일한 outline+색 계열로 통일.

### 4. Snag List 탭
- 기준이므로 변경 없음.

## 변경 파일

- `src/components/task-management/import/TaskManagementImportPage.tsx` (레이아웃/JSX 재구성, 로직/컨텍스트/다이얼로그 그대로)
- `src/components/spare-part/import/SparePartImportPage.tsx` (레이아웃/JSX 재구성)
- `src/components/abd/import/AbdImportPage.tsx` (레이아웃/JSX 재구성, 상태값 → 영문 라벨(Ready/Processing/Done/Failed)로 통일해 Snag 스타일과 일치)

## 유지 원칙

- 데이터/로직/컨텍스트/서버 함수/컬럼 매핑 규칙은 **일절 변경하지 않음** — JSX 마크업과 Tailwind 클래스만 변경.
- 각 탭의 안내문구·규칙·경고 워딩은 원문 그대로 유지.
- 도메인 고유 필드(Discipline, Team, Rollup, AI 분류 등)는 FileRow 컨트롤바 안에 자연스럽게 배치.

## 위험 / 한계 (보고 사항)

- **완전 동일한 "기능"까지는 불가**: 각 도메인은 스키마·중복처리·컬럼매핑 규칙이 달라 Snag의 `Duplicate Review`, `Re-import`, `AI 분류`, `Category 자동 감지` 같은 기능은 그 도메인에 존재하지 않으면 이식하지 않습니다(요청도 UI/레이아웃 동일화로 확정됨).
- ABD 탭은 현재 `<label>` 기반 드롭존이라 클릭·드래그 동시 처리 방식이 Snag과 다릅니다. Snag과 동일한 `div + hidden input + ref.click()` 패턴으로 교체합니다.

## 검증

- `bunx tsgo --noEmit` 타입 체크.
- Playwright로 `/import-log/import?tab=task|snag|spare-part|abd` 4개 탭 스크린샷 비교하여 골격 일치 여부 확인.
