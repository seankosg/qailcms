# 모바일 버전 개선 계획

정적 코드 점검(파일:라인 근거는 하단 "기술 상세") 결과, 앱 골격(사이드바 슬라이드/오버레이, 상단바, Tailwind 브레이크포인트 그리드, TanStack Table 가로 스크롤)은 반응형을 잘 지키고 있습니다. 그러나 모바일에서 실사용을 방해하는 5가지 지점이 확인되어 이를 우선 개선합니다.

## 개선 범위 (우선순위 순)

### 1. 뷰포트 높이 단위 교체 (`vh` → `dvh`) — 치명
현재 앱 전 구간이 `min-h-screen`(=100vh)과 `calc(100vh-6rem)`을 사용합니다. iOS Safari / Android Chrome은 주소창이 나타났다 사라질 때 `100vh`가 실제 보이는 높이와 어긋나 하단이 잘리거나 빈 여백이 생깁니다.

- `min-h-screen` → `min-h-dvh` 일괄 교체 (전역 레이아웃, 인증 페이지, 라우트 루트)
- Raw Data 페이지들의 `h-[calc(100vh-6rem)]` → `h-[calc(100dvh-6rem)]`

### 2. Raw Data 툴바 모바일 축약 — 중대
현재 TM / ABD / SM(Defect) / DMR / Spare Part의 Raw Data 툴바가 모두 8~10개 버튼을 `flex-wrap`으로만 나열해, 모바일에서 세로로 4~5줄이 쌓여 테이블 영역을 잠식합니다. 검색 인풋도 `w-64` 고정입니다.

- 검색 인풋: `w-64` → `w-full sm:w-64`
- 보조 액션(컬럼 메뉴, Reset, Refresh, Collapse/Expand, Rollup, Judgment, Threshold, Import, Export)을 모바일에서는 **한 개의 "메뉴" DropdownMenu**로 접기 (`sm:hidden` / `hidden sm:inline-flex` 페어링). Import/Export처럼 자주 쓰는 2개만 남기는 것도 옵션 — 아래 질문 참조.
- Data Date Picker, 페이지 타이틀, 뱃지는 유지

### 3. 임포트 Preview 다이얼로그 가로 스크롤 — 중대
TM/ABD/SM/DMR 임포트의 Preview 테이블은 15개 이상 컬럼을 `<table className="w-full">`로 렌더링하며, 감싼 `ScrollArea`는 수직만 처리해 모바일 폭에서 셀이 극단적으로 압축됩니다.

- 각 Preview 테이블을 `<div className="overflow-x-auto">`로 감싸고 테이블에 `min-w-[900px]` 부여 → 자연스러운 가로 스크롤

### 4. 아이콘 전용 버튼 터치 타깃 — 중대
`Button` 기본 `icon` 변형이 36×36(`h-9 w-9`)이고, 페이지네이션 화살표 등에서 `h-7 w-7`(28×28)까지 축소되어 있어 WCAG 44×44 미달입니다.

- 페이지네이션·인라인 편집 아이콘 버튼 클러스터에 `min-h-9 min-w-9 sm:min-h-8 sm:min-w-8` 부여(모바일에서만 확대)
- 인접 아이콘 사이 `gap-1` → `gap-2 sm:gap-1`로 오조작 여백 확보
- 대상: `AbdRawDataPage.tsx` 페이지네이션, `AdminAbdHeaderMappingTable.tsx`, `EditableSourceHeaderCell.tsx` 등 반복 패턴

### 5. 사이드바 상단 사용자 정보의 모바일 노출 — 경미
사이드바 헤더의 이름/역할/로그아웃 블록이 `hidden sm:flex`로 걸려 있어, 모바일에서 사이드바를 열어도 사용자 이름과 로그아웃 버튼이 노출되지 않습니다.

- `hidden sm:flex` → `flex` (사이드바 자체가 `w-64`이므로 폭 문제 없음, 이미 `max-w-[140px] truncate` 방어 있음)

## 이번 계획에서 제외

- **차트 반응형 (KPI/S-Curve/추이)**: 코드 grep으로 `ResponsiveContainer` 매치가 잡히지 않아 미사용으로 보이나, DMR/ABD/TM 대시보드의 실제 차트가 이미 유동 폭으로 렌더링되고 있다면 불필요한 변경입니다. 실제 모바일 렌더링 캡처로 이슈가 확인되면 별도 후속 조치로 다루겠습니다.
- **다이얼로그 세부 컨텐츠 재배치**: Export/Comments 등 대부분 shadcn Dialog(`sm:max-w-md`)로 이미 모바일 대응이 됨.
- **필터 바 재설계**: 현재 `flex-wrap`으로 세로 확장은 되나 깨지지는 않아 기능상 문제 없음. UX 개선은 별도 이터레이션.

## 확인 질문

각 Raw Data 페이지 툴바를 모바일에서 어떻게 축약할지 선호를 알려주세요:
- **(A) 전체 접기**: Import/Export를 포함한 보조 버튼 전부를 한 개의 "⋯" 메뉴로 접음 (가장 깔끔, 두 번 탭 필요).
- **(B) 절충**: Import/Export/Refresh 3개만 아이콘으로 남기고 나머지는 "⋯" 메뉴로 접음 (권장).

미지정이면 (B)로 진행합니다.

## 기술 상세 (파일:라인)

- 뷰포트 대상: `src/components/layout/AppLayout.tsx:229`, `src/routes/__root.tsx:21,49`, `src/routes/auth.tsx:49`, `src/routes/change-password.tsx:55`, `src/routes/index.tsx:27`, `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx:939` 및 동일 패턴 4곳(ABD/SM/DMR/Spare Part Raw Data)
- Raw Data 툴바 대상: `TaskManagementRawDataPage.tsx:940-1061`, `AbdRawDataPage.tsx`, `DefectRawDataPage.tsx`, `DmrRawDataPage.tsx`, `SparePartRawDataPage.tsx` 툴바 블록
- 임포트 Preview 대상: `TaskManagementImportPage.tsx:869-900`, ABD/SM/DMR 임포트 Preview
- 아이콘 버튼 대상: `AbdRawDataPage.tsx:590-594`, `AdminAbdHeaderMappingTable.tsx:118`, `EditableSourceHeaderCell.tsx:95,98`, `src/components/ui/button.tsx:24`(공용 기본값은 유지, 사용처만 확장)
- 사용자 정보 노출: `src/components/layout/AppLayout.tsx:243`

DB, 서버 함수, 비즈니스 로직 변경 없음. 순수 CSS/JSX 조정만 수행합니다.
