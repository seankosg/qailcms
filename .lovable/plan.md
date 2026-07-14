## 목표
`DeSnagMatrixBlock`의 매트릭스 테이블을 스크롤할 때, 상단 헤더(2행) 및 좌측 스티키 컬럼(Building / Level)이 고정되고 내부 데이터만 상하좌우로 스크롤되도록 변경.

## 현재 상태
- `overflow-x-auto` 만 있는 wrapper에 `<table>`이 들어 있어 세로 스크롤 없음(페이지 전체 스크롤). 헤더는 `sticky top-0`이 없어 페이지 스크롤 시 함께 밀림.
- 좌측 Building/Level `<th>`, `<td>`는 이미 `sticky left-0` / `sticky left-[100px]`가 걸려 있으나 컨테이너에 `overflow-y` 스크롤이 없어 세로 sticky는 무의미.

## 변경 (파일 1개: `src/components/defect-management/dashboard/DeSnagMatrixBlock.tsx`)

1. 테이블 wrapper 를 `overflow-auto` + `max-h`(뷰포트 기반, 예: `max-h-[calc(100vh-320px)]`) + `relative` 로 변경하여 블록 내부에서 세로/가로 동시 스크롤이 발생하도록 함. 블록 상단 타이틀 바(`블록 전체 보기` 헤더)는 스크롤 영역 밖(현재 구조 유지).
2. `<thead>`의 두 헤더 `<tr>` 내부 `<th>`들에 세로 스티키 추가:
   - Row 1 그룹 헤더 `<th>`: `sticky top-0 z-30` (기존 배경 유지, 반투명 금지 → 규칙에 맞게 `bg-muted` 계열 불투명 클래스로 조정 및 `style={{ background: "var(--muted)" }}` 로 확실히 불투명화).
   - Row 2 서브 헤더 `<th>`: `sticky top-[28px]`(Row1 높이 h-7=28px) `z-20`.
   - 좌측 sticky 헤더 셀 (Building/Level, `rowSpan={2}`)은 `sticky left-0/left-[100px] top-0 z-40` 로 좌상단 교차 영역에서 최상위.
3. 본문 스티키 컬럼 `<td>` (Building, Level, 소계의 Level 자리, Column Total 자리)의 배경을 mem 규칙에 맞춰 완전 불투명(`var(--card)` / `var(--muted)` 원본 유지, `hsl(var(--...))` 랩핑 금지) 유지 확인 — 이미 그렇게 되어 있어 그대로 두되, z 인덱스만 `z-10`(기존) 유지. 헤더 sticky 상단 쪽(`z-30~40`)이 본문(`z-10`)보다 위에 오도록 정리.
4. Column Total 행의 sticky `<td colSpan={2}>` 는 데이터 스크롤 시 위로 사라져도 무방(요청 범위는 헤더/좌측 컬럼 고정만).

## 검증
- `bunx tsgo --noEmit`
- Preview에서 매트릭스 세로/가로 스크롤 시 (a) 두 줄 헤더가 상단에 붙어 있는지 (b) Building/Level 컬럼이 좌측에 붙는지 (c) 좌상단 교차 영역에서 헤더가 컬럼 위에 그려지는지 (d) 스크롤 아래 뒤 셀이 sticky 컬럼 뒤로 비쳐 보이지 않는지 확인.

## 한계
- `max-h`는 뷰포트 상대값(예: `calc(100vh-320px)`)이 필요하며, 페이지 전체 레이아웃 상 값이 완전히 딱 맞지 않을 수 있음. 값 조정이 필요하면 이후 요청 시 미세 조정 예정.
