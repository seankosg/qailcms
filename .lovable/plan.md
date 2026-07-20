TMDB 대시보드 제목의 아이콘을 제거하고, 상단 KPI 카드의 메인 숫자 크기와 클릭 피드백, 지연/음수 숫자 색상을 통일합니다.

### 1. 제목 아이콘 제거
- 파일: `src/components/task-management/dashboard/TmDashboardPage.tsx`
- `Task Management Dashboard` 앞의 `<Gauge ... />` 아이콘을 삭제하고 텍스트만 남깁니다.
- 뒤로가기 화살표와 Data Date 선택 영역은 그대로 유지합니다.

### 2. KPI 카드 메인 숫자 크기 확대
- 파일: `src/components/task-management/dashboard/ProgressKpiCard.tsx`
  - 퍼센트 메인 숫자를 `text-2xl` → `text-3xl` 또는 `text-4xl`로 확대합니다.
- 파일: `src/components/task-management/dashboard/RiskKpiCard.tsx`
  - count / percent 메인 숫자를 `text-2xl` → `text-3xl` 또는 `text-4xl`로 확대합니다.
  - breakdown 영역(우측 팀별 리스트)과 겹치지 않도록 레이아웃을 유지하며, 카드 높이가 너무 커지지 않게 조정합니다.

### 3. 클릭 가능한 항목 hover 피드백 강화
- 파일: `src/components/task-management/dashboard/ProgressKpiCard.tsx`, `RiskKpiCard.tsx`
  - `onClick`이 있는 카드 전체에 `cursor-pointer`와 눈에 띄는 hover 배경(`hover:bg-primary/10` 또는 `hover:bg-accent/80`)을 적용합니다.
- 파일: `src/components/task-management/dashboard/RiskKpiCard.tsx`
  - breakdown 행(팀별 숫자)에도 동일한 hover 스타일과 커서 변화를 적용합니다.
- 파일: `src/components/task-management/dashboard/StatusMixBar.tsx`
  - 세그먼트 hover 효과를 유지/보강하여 클릭 가능함을 명확히 합니다.

### 4. 지연 및 음수 숫자 색상 통일
- 파일: `src/components/task-management/dashboard/TmKpiCards.tsx`
  - `Start Delayed`, `Behind Schedule` 카드의 `tone`을 `warn`에서 `danger`로 변경하여 빨간색으로 통일합니다.
  - `In Delay`, `Completion Overdue`, `Critical Delay`는 이미 danger로 유지합니다.
- 파일: `src/components/task-management/dashboard/RiskKpiCard.tsx`
  - breakdown 영역의 count에도 카드의 `tone` 색상을 적용하여 지연 카드는 팀별 숫자도 빨간색으로 보입니다.
- 파일: `src/components/task-management/dashboard/ProgressKpiCard.tsx`
  - 메인 퍼센트가 음수일 경우 `text-destructive`로 처리하는 예방 로직을 추가합니다.

### 검증
- `/closure/task-management/dashboard` 프리뷰에서 캡처로 확인합니다.
- 제목 아이콘 제거, 메인 숫자 크기 확대, 카드 hover 시 배경/커서 변화, 지연 카드 및 breakdown 숫자의 빨간색 통일 여부를 확인합니다.