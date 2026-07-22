## 목적
SM Progress 페이지의 상단 KPI 카드 5개(PLAN / ACTUAL / DIFFERENCE / DONE / PROGRESS)를 TM 대시보드의 `RiskKpiCard`("Start Delayed" 등)와 동일한 UI 톤·hover 반전·클릭 이동 UX로 통일합니다. 기존 스테이지별(Start/Rectified/Closure) 브레이크다운은 그대로 유지합니다.

## 범위
- `src/components/defect-management/progress/SnagProgressPage.tsx` 내부의 `KpiCard` 로컬 컴포넌트만 수정.
- KPI 계산·클릭 시 이동 라우팅(`handleKpiClick`)·필터 전달 로직은 손대지 않음(이미 raw data로 이동).
- TM 파일(`RiskKpiCard.tsx`, `TmKpiCards.tsx`)은 변경하지 않음.

## 변경 사항 (파일 단위)

### 1) `SnagProgressPage.tsx` — 로컬 `KpiCard` 리뉴얼
TM `RiskKpiCard`의 시각적 특성을 이식:
- 레이아웃: `<CardContent className="p-3">` + `flex items-start gap-3`. 좌측(라벨+큰 값), 우측(border-l pl-2, min-w [~112px], max-h-28 overflow-y-auto)로 스테이지 리스트.
- 라벨: `text-[11px] font-semibold uppercase tracking-wide text-muted-foreground` (아이콘 사용 시 인라인, PROGRESS의 `TrendingUp` 유지).
- 값: `text-3xl font-bold tabular-nums leading-tight` + 카드별 `tone` 컬러 클래스 적용.
- 카드 hover: `cursor-pointer transition-colors hover:bg-primary/10` (accent/40 → primary/10 로 반전 강화).
- 스테이지 행: 고정 높이 `h-5`, `text-[11px] tabular-nums`, hover `hover:bg-primary/10 rounded px-1`, 클릭 시 `e.stopPropagation()` 후 콜백. 라벨은 좌측(muted), 숫자는 우측(font-medium + tone 색). DIFFERENCE의 short/over 색은 기존대로 유지.
- 카드 자체 클릭과 스테이지 행 클릭 분리(현재 유지). 우측 브레이크다운 컨테이너에도 `onClick={e => e.stopPropagation()}` 추가.

### 2) 카드별 톤(tone) 지정
새 prop `tone?: "neutral" | "info" | "emerald" | "danger" | "warn"` 를 `KpiCard`에 추가하고 값(text-3xl) 색에만 적용. TM 팔레트를 재사용:
- PLAN → `neutral` (기본 foreground)
- ACTUAL → `emerald` (`text-emerald-600 dark:text-emerald-400`)
- DIFFERENCE → 값 자체를 기존 `accent` prop으로 부호에 따라 red/green 유지 (`text-schedule-short` / `text-schedule-over`), tone은 `neutral` 폴백
- DONE → `info` (`text-blue-600 dark:text-blue-400`)
- PROGRESS → `emerald`

DIFFERENCE 카드의 `suffix`(괄호 안 %)와 스테이지 tone(short/over)은 현행 유지.

### 3) 호출부(508~588행) 조정
- 각 `<KpiCard>` 에 `tone` prop 전달.
- PROGRESS 카드는 `icon={TrendingUp}` 유지, 라벨 우측 정렬을 위한 flex 정리(라벨과 아이콘 함께 왼쪽 정렬).
- 그리드는 현행 `sm:grid-cols-2 lg:grid-cols-5` 유지 → 5개 카드 모두 동일 규격.

## 비변경 항목
- KPI 값 계산 로직 (`kpis`, `handleKpiClick` 파라미터 및 라우팅).
- 스테이지 브레이크다운의 데이터·클릭 콜백.
- TM 파일 및 라우팅 스키마.
- SM 대시보드의 다른 카드(`DeSnagGrandTotalCards`).

## 기술 노트
- `RiskKpiCard`를 직접 재사용하지 않는 이유: SM 쪽 브레이크다운은 stage 3종(문자열 + short/over tone) 구조이고 TM쪽은 팀 count 구조라 인터페이스가 다릅니다. 로컬 `KpiCard`에 TM의 시각 규격을 이식하는 편이 안전하고 최소 침습적입니다.
- 다크모드 대응: 톤 클래스 전부 `text-*-600 dark:text-*-400` 형식으로 정의(TM과 동일).
- hover 색은 TM과 동일하게 `bg-primary/10` 사용(시맨틱 토큰). 하드코드 색상 없음.

## 검증
1. 5개 카드 hover 시 카드 배경이 `primary/10` 로 즉시 반영되는지.
2. 카드 본체 클릭 → 기존 handleKpiClick(mode, "all") 라우팅 유지.
3. 스테이지 행 클릭 시 카드 클릭이 발생하지 않고 해당 스테이지 필터로 이동하는지(stopPropagation).
4. DIFFERENCE 부호별 색상, `(±%)` suffix, 스테이지 short/over 색이 그대로 유지되는지.
5. 좁은 뷰포트(sm)에서 2열, lg 이상에서 5열 유지 및 우측 리스트가 잘리지 않는지(min-w/max-h 확인).
