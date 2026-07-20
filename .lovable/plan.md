# DMR 대시보드 차트 SHAW식 이식

## 결정 사항 반영
- **라인축**: SHAW 기준 — 단일 지표(**Actual manpower**) + 카테고리별 다중 라인, Group-By 토글로 축 선택
- **KPI/보조 UI 이식 범위**: **Today's Manpower 강조 텍스트만** (생산성 카드/테이블 제외)

## 대상 파일
- `src/components/resource/dmr/DmrDashboardPage.tsx`

## 구현 상세

### 1) 차트 축 SHAW식 전환
현재 `Actual vs Plan` 2라인 → **선택한 카테고리 값별 다중 라인** (`actual_manpower` 합계)

- **Group-By 토글**: 카드 헤더 우측에 4개 토글 버튼
  - `Team` (discipline)
  - `Plot` (C / D)
  - `Sub Contractor` (contractor_name)
  - `Work Description` (system_name)
- 기본값: `Team`
- 각 카테고리의 라인 = 상단 필터 조건 하에서 "선택된 값들"만 표기
  - 예: Team 필터에서 CIVIL·MECH만 선택 & Group-By=Team → 라인 2개(CIVIL, MECH)
  - Group-By가 Team이 아닐 때 팀 필터는 데이터 필터 역할만 수행
- 라인 색상: SHAW의 10-color 팔레트 그대로 이식
  ```
  ['hsl(var(--primary))','#ef4444','#f59e0b','#10b981','#06b6d4',
   '#8b5cf6','#ec4899','#84cc16','#f97316','#6366f1']
  ```
  단, hsl(var(--primary))는 OKLCH 테마와 충돌하므로 `'#2563eb'`로 치환 (이전 버그와 동일 이유)
- Plan 라인은 **제거** (Plan은 KPI 카드에서만 표기, 결정사항에 따라)

### 2) SHAW 시각 스타일 이식
- 차트 높이 `h-64 → h-[320px]`
- 마진 `{ top: 10, right: 20, left: 0, bottom: 8 }`
- X-Axis: `tickFormatter={fmtDate}` (예: `20-Jul`)
- Y-Axis: `niceMax()` + 6-tick 스텝 (SHAW 유틸 그대로 이식)
- CartesianGrid stroke `hsl(var(--border))`
- Line: `type=monotone`, `strokeWidth=2`, `dot={r:3}`, `activeDot={r:5}`
- Loading/Empty 상태 문구 (`Loader2`, "No data for current selection")

### 3) Today's Manpower 강조 텍스트
차트 카드 상단(또는 KPI Strip 자리)에 SHAW 스타일로 큰 붉은 텍스트 배치:
```tsx
<div className="text-[22px] font-bold text-red-500 truncate">
  Today's Manpower: {latestDateActualSum}
</div>
```
- 기준일: `currentAsOf` (Data Date 선택값, 없으면 최신 report_date)
- 값: 현재 필터 적용된 rows의 해당일 `actual_manpower` 합계
- Subcontractor 요약 라인은 이식 **하지 않음** (KPI 범위 외)

### 4) 필터 상호작용 개선 (SHAW 패턴 일부)
- Sub Contractor 옵션이 Team/Plot 선택에 종속되도록 `subContractorOptions` 계산에 Team/Plot 필터 반영
- 상위 필터 축소로 선택된 Sub Contractor가 옵션 밖으로 나가면 자동 pruning (`useEffect`)
- Work Description도 동일하게 스코프 종속

### 5) 유지 항목
- 상단 필터 바(Team/Plot 토글, Work Desc/Sub Contractor Popover, 유형, 기간, Data Date) — 그대로
- Discipline별 카드 3개 (Actual/Plan/Δ) — 유지
- Sub Contractor × 일자 매트릭스 — 유지

## 검증
- Group-By=Team & 상단 Team 필터 미선택 → CIVIL/ELEC/MECH 3라인
- Group-By=Plot → C/D 2라인
- Group-By=Sub Contractor 상단 Sub Contractor 3개 선택 → 3라인
- Today's Manpower가 KPI Actual과 값 일치
- 라인이 실제로 그려짐 (OKLCH stroke 이슈 재발 없음)

## 기술 노트
- DB/RPC 변경 없음
- 새 유틸(`fmtDate`, `niceMax`)은 파일 로컬 헬퍼로 복제 (다른 페이지에서 재사용 가능성 낮음)
