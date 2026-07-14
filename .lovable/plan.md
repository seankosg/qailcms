## Grand Total 카드 재설계 + Room Group 티어 추가

### 1. 기존 KPI 카드 개선 (`DeSnagGrandTotalCards.tsx`)

**카드 개수:** 6개 → **5개** (Closure % 카드 제거)
- Issued / Open / Rectified / Re-Opened / Closed

**시각적 변경:**
- 아이콘 전부 제거
- 라벨 크기 확대: `text-[11px]` → `text-sm` (uppercase tracking 유지)
- 값 크기 확대: `text-2xl` → `text-4xl`~`text-5xl`, `font-bold tabular-nums`
- 서브텍스트: `"236 (23% of ISSUED)"` → **`"23%"`만** 표시. Issued 카드는 서브텍스트 없음(또는 "Total")
- **카드별 색상 지정** (사용자 지정 톤 반영):
  - **Issued**: 배경/보더 색상 **없음** (중립, 기본 카드 스타일)
  - **Open**: 앰버 (`amber-500` 계열, `border-amber-500/40 bg-amber-500/5 text-amber-...`)
  - **Rectified**: 하늘색 (`sky-500` 계열)
  - **Re-Opened**: 로즈 (`rose-500` 계열)
  - **Closed**: 연한 초록 (`emerald-400/500` 계열, 약한 tint)
- **진도율 바** 각 카드 하단(값 아래): `<Progress value={pctOfIssued} />`. Issued는 100% 또는 미표시. indicator 색상은 카드 톤과 매칭(단, Issued는 기본색).

**클릭 동작:** 기존 `onMetric(slot)` 유지 — Raw Data로 status 필터 이동. `cursor-pointer` 명시.

### 2. 신규 티어: Room Group별 카드 (`DeSnagRoomGroupCards.tsx` 신규)

**위치:** Grand Total 카드 아래, Matrix 블록 위.

**데이터:** `matrix.blocks[*].colTotals`를 Room Group별로 병합하여 Plot 전체의 `Record<RoomGroupCol, Stats>` 산출 (issued>0인 그룹만 렌더).

**카드 구성 (Room Group당 1장):**
- 헤더: Room Group 이름 + 우측 그룹 총 Issued
- 아래 5개 status 미니 행 (Open/Rectified/Re-Opened/Closed; Issued는 헤더에 이미 표시):
  - 좌측 status dot(카드 색상 톤과 동일), 라벨, 카운트, **% (그룹 Issued 대비)**
  - 각 행 우측에 얇은 mini progress bar (해당 status 색)
- hover 시 배경 살짝, `cursor-pointer`
- **클릭:** 카드 헤더 = `room_group=<name>` 필터로 Raw Data 이동. 각 status 행 = `room_group + status` 조합 필터로 이동.

**레이아웃:** `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3`

### 3. `DeSnagDashboardPage.tsx` 배선
- Room Group 집계 `useMemo`로 계산 후 `DeSnagRoomGroupCards`에 전달.
- `goRaw` 헬퍼로 `room_group`(+선택적 `status`) 파라미터 전달.

### 스코프 외
- Matrix 블록 테이블, Toolbar, Basement/Podium 블록 로직, RPC/데이터 파이프라인 변경 없음.
- `dashboard-shape.ts` 데이터 구조 변경 없음 (읽기만).

### 검증
- `bunx tsgo --noEmit` 타입 통과
- Playwright 스크린샷으로 색상·크기·진도바·Room Group 카드 렌더 확인
- 카드 클릭 시 Raw Data 필터 URL 확인
