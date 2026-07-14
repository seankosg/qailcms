# Snag List Dashboard 매트릭스 테이블 UI 개선

## 현재 문제 (캡쳐 분석)
각 셀 안에 6개 지표(ISSUED / Open / Rect. / Re-Op / Closed / Cls%)를 `grid-cols-3` 미니 그리드로 밀어넣어 렌더 → 라벨과 숫자가 겹치고("ISSUED 236pen 236", "Closed 0 (0%s -" 등), 컬럼 폭이 좁을 때 텍스트가 뭉개져 판독 불가. Room Group 헤더가 단일 행이라 지표별 정렬·비교도 불가.

## 개선 방향
셀 내부 미니 그리드를 없애고, **다중 헤더(Two-row `<thead>`) + 지표당 개별 `<td>`**로 재구성한다. Room Group 하나가 6개의 서브컬럼(Issued / Open / Rect / Re-Op / Closed / Cls%)으로 확장되며, 상단 헤더가 이 6개를 `colSpan=6`으로 묶는다.

```text
┌──────────────────┬────────────────────────────────────┬────────────────────────────────────┬─────────
│ Building │ Level│              TENANT                 │               BOH                  │  ...
│          │      ├───────┬─────┬─────┬─────┬──────┬───┼───────┬─────┬─────┬─────┬──────┬───┤
│          │      │Issued │Open │Rect │Re-Op│Closed│Cls│Issued │Open │Rect │Re-Op│Closed│Cls│  ...
├──────────┼──────┼───────┼─────┼─────┼─────┼──────┼───┼───────┼─────┼─────┼─────┼──────┼───┤
│ Tower    │ L70  │   0   │  0  │  0  │  0  │  0   │ - │  236  │ 236 │  0  │  0  │  0   │0% │
```

## 변경 사항

### 1. `src/components/defect-management/dashboard/DeSnagMatrixBlock.tsx` (핵심)
- `<thead>`를 **2행**으로 재구성:
  - 1행: Building / Level (rowSpan=2 sticky) + 각 Room Group (`colSpan=6`, 가운데 정렬, 클릭 시 Room Group 전체 필터로 이동) + Row Total (`colSpan=6`).
  - 2행: 각 Room Group·Row Total 아래에 반복되는 6개 지표 서브헤더 (Issued / Open / Rect / Re-Op / Closed / Cls%).
- 서브헤더는 텍스트 아이콘화 없이 짧은 라벨과 tabular-nums 사용. 지표별 배경 tint(예: Issued는 muted, Cls%는 primary/5)를 옅게 넣어 열 그룹 내부에서도 위치를 빠르게 인지.
- 각 Room Group의 6개 컬럼 묶음에 **교차 배경**(짝수/홀수 그룹 `bg-muted/20` vs 카드 배경) + 그룹 사이 **두꺼운 세로 구분선**(`border-l-2 border-border`)을 넣어 시각적 그룹핑.
- N/A 그룹은 기존과 동일하게 muted tint 유지, Row Total은 `bg-primary/5`로 강조.

### 2. `src/components/defect-management/dashboard/DeSnagStatusCell.tsx` → **폐기/대체**
- 현재 6-in-1 셀 렌더 컴포넌트를 제거하고, **`DeSnagStatusRow`** (또는 인라인) 로 대체: `Stats`를 받아 `<td>` 6개를 반환하는 함수. 각 `<td>`는 단일 숫자 버튼(우측 정렬, tabular-nums, hover:bg-muted/50, 클릭 시 해당 `MetricSlot`으로 drilldown).
- Cls% 셀은 값에 따라 텍스트 색(red/amber/green) 유지. 셀 전체 배경 색(`closureBg`)은 **행 전체가 아닌 Cls% 셀 하나에만** 적용해 다른 숫자의 가독성을 해치지 않음.
- Issued=0인 셀 세트는 dim(opacity-50) 유지, 숫자 0은 muted-foreground로 dim 처리하여 노이즈 감소.
- Cell 크기 계산: 각 서브컬럼은 `min-w-[38px]` 정도, Issued만 `min-w-[46px]`. Room Group 하나당 총 폭이 기존 180px보다 오히려 좁아지는 경우가 많음 → 화면 밀도 개선.

### 3. Body 행 (`FragmentRows`)
- 각 데이터 `<tr>`의 셀은 이제 Room Group당 6개 `<td>` (10개 그룹 × 6 = 60 + Row Total 6 + Building/Level 2 = 68 컬럼). 렌더 로직은 `ROOM_GROUP_ORDER.flatMap((rg) => renderMetricCells(r.cells[rg], (m) => goCell(..., rg, m)))` 패턴.
- Building/Level sticky 컬럼과 rowSpan Building 셀은 그대로 유지. sticky 배경은 **불투명**(`var(--card)` / `var(--muted)`)으로 지정하여 스크롤 시 뒤 셀이 비쳐 보이지 않도록 함 (기존 memory 규칙 준수).
- Building 소계 / Column Total 행도 동일한 6-cell 패턴으로 재구성.

### 4. 시각적 세부
- 폰트: 서브헤더 `text-[10px] uppercase tracking-wide font-medium text-muted-foreground`, 숫자 `text-xs tabular-nums`.
- 0 값은 `text-muted-foreground/60`으로 dim. 양수는 `text-foreground`.
- Hover: 셀은 `hover:bg-primary/10`, 컬럼 그룹 전체 하이라이트는 도입하지 않음(구현 복잡도 대비 이득 낮음).
- 상단 Room Group 헤더 클릭 → 기존과 동일하게 Room Group 필터로 drilldown.
- 가로 스크롤은 그대로. 좌측 Building/Level 2컬럼 sticky 유지.

### 5. 스코프 외 (명시)
- 데이터 파이프라인 (`dashboard-shape.ts`, RPC) 은 변경 없음.
- Toolbar, Plot 그랜드 토탈 배너, Basement 블록 로직은 그대로.
- Tree View, Task/Spare Part 대시보드는 이번 스코프에서 제외.

## 검증
- `bunx tsgo --noEmit` 타입 체크.
- Playwright로 `/closure/snag-management/dashboard?plot=C` 접속 후 스크린샷 캡쳐 → 다중 헤더가 정상 렌더되는지, 숫자 겹침이 사라졌는지, sticky 컬럼이 불투명한지 확인.
- 셀 클릭 → Raw Data 페이지로 올바른 필터(building/level/roomGroup + 지표) 이동 확인.
