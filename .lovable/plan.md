## 목표
TM 대시보드 중단부의 Status Mix(현재 좌 절반, 가로 스택 바)를 도넛형 카드로 교체하고, 기존 Status Mix가 차지하던 폭(전체의 절반)을 다시 반으로 나눠 좌측 = Status Mix 도넛, 우측 = 자동 판정 분포(JudgmentDonut) 배치. 우측 절반(기존 스테이지 판정 스택)은 현재 그대로 유지.

## 최종 레이아웃
```text
[ KPI 카드 4개 그리드 ]
[ Status Mix 도넛 | 자동 판정 분포 도넛 || 스테이지별 판정 스택 (변경 없음) ]
  └──── 폭 25% ────┴──── 폭 25% ────┘└─────── 폭 50% (기존 그대로) ───────┘
```
- 3개 카드 모두 `h-full`, 그리드 `items-stretch` → 우측 스테이지 판정 스택 카드의 자연 높이에 좌/중 도넛 카드가 맞춰 늘어남 (요청한 "높이 정합" 유지).

## 현재 상태 (확인 완료)
- `TmKpiCards.tsx`의 `<div className="grid gap-3 lg:grid-cols-2">` 내부: 좌 = `StatusMixBar`, 우 = `statusMixSideSlot`.
- `TmDashboardPage.tsx`에서 `statusMixSideSlot`에 `<JudgmentStageBreakdown compact />`(= 스테이지 판정 스택만)를 전달.
- `JudgmentDonut.tsx`는 이미 SVG 도넛으로 구현되어 있고 `counts` prop 하나만 받음.
- `JudgmentStageBreakdown` 은 `compact=true`면 스테이지 스택 카드 단독 렌더 → 그대로 재사용.
- `StatusMixBar.tsx`는 `TmKpiCards`에서만 사용.

## 변경 사항

### 1. `StatusMixDonut.tsx` 신규
- `JudgmentDonut`과 동일한 시각 사양(반경/두께/중앙 total 텍스트/우측 범례)의 SVG 도넛.
- 세그먼트 3개: Completed / WIP / Not Started.
  - 색상: Completed = `var(--schedule-actual)`, WIP = `var(--schedule-plan)`, Not Started = 중립 muted 톤. 기존 `StatusMixBar` 색과 일관.
- 범례 각 행 클릭 시 `onSegmentClick(seg)` 호출 → 기존 raw-data 필터 연동 유지.
- 카드 타이틀: "Status Mix".
- 카드에 `h-full flex flex-col` 부여, SVG 영역은 `flex-1`로 세로 여백을 흡수하여 스테이지 스택 카드 높이 정합.

### 2. `TmKpiCards.tsx` 수정
- 기존 `<div className="grid gap-3 lg:grid-cols-2">` 를 `<div className="grid gap-3 lg:grid-cols-4">` 로 변경.
- 왼쪽에 `<StatusMixDonut ... className="lg:col-span-1" />` (총 4 중 1칸).
- 그 옆에 `<div className="lg:col-span-1">{statusMixLeftExtraSlot}</div>` (자동 판정 분포용, 1칸).
- 오른쪽에 `<div className="lg:col-span-2">{statusMixSideSlot}</div>` (스테이지 판정 스택 그대로, 2칸).
- Props에 `statusMixLeftExtraSlot?: ReactNode` 추가.

### 3. `TmDashboardPage.tsx` 수정
- `judgmentCounts` `useMemo` 추가: `computeJudgmentStageBreakdown(scopedItems, asOfDate).judgmentCounts` 산출.
- `TmKpiCards`에 아래 두 slot 전달:
  - `statusMixLeftExtraSlot={<JudgmentDonut counts={judgmentCounts} />}`
  - `statusMixSideSlot={<JudgmentStageBreakdown items={scopedItems} asOfDate={asOfDate} compact />}` (현재와 동일 — 변경 없음)

### 4. 정리
- `StatusMixBar.tsx`는 다른 사용처 없음을 build 진입 시 재확인 후 파일 삭제(사용처 있으면 존치).

## 영향 없음
- 하단 "지연 Top + Owner Leaderboard" 행: 변경 없음.
- KPI 카드 4개 그리드: 변경 없음.
- 스테이지 판정 스택 카드 자체(내용/스타일/데이터): 변경 없음. 위치도 유지.
- Raw Data 드릴다운 필터 로직: 기존 `goRaw(seg)` 동일 재사용.
