
## 변경 목표
1) Row1 KPI 라벨 정리
2) 모든 KPI 팀 breakdown 순서를 MECH → ELEC → 기타 알파벳 순으로 통일
3) KPI 카드의 라벨 텍스트를 크기 유지, 굵기만 강화하여 시인성 개선

## 수정 파일
- `src/components/abd/dashboard/AbdKpiRows.tsx`

## 상세

### 1) Row1 라벨 변경 (`AbdRow1Kpis`)
- `"UR (Under Review)"` → `"Under Review"`
- `"DS (Drafting)"` → `"Draft Start"`
- `"NS (Not Started)"` → `"Not Started"`
- `Approved`, `Total`은 유지.

### 2) 팀 순서 통일 정렬 함수
- 파일 상단에 `TEAM_ORDER = ["MECH","ELEC"]`와 `sortByTeamOrder(list)` 유틸 추가.
  - MECH 최상단, ELEC 그다음, 나머지 팀은 알파벳순.
- 적용 지점:
  - `AbdRow1Kpis`의 `mk()`에서 `byTeam.get(key)` 결과를 정렬 후 breakdown 매핑.
  - `AbdRow1Kpis`의 Total 카드용 `totalByTeam` 계산 시 (count 내림차순 대신) `sortByTeamOrder` 적용.
  - `AbdRow2Kpis`의 `mk()`에서도 동일 적용.

### 3) 라벨 시인성 강화 (`AbdKpiCard`)
- 카드 상단 라벨의 클래스에서 `font-semibold` → `font-bold`로 강화.
- 크기(`text-[11px]`), uppercase, tracking, muted-foreground 색상은 그대로 유지.

## 사이드 이펙트
- 라벨/스타일 텍스트 변경만 발생. 내부 key/status_group 미변경 → Raw Data 필터 링크 로직 영향 없음.
- Row2 라벨(RS Delay/SB Delay/DS Delay/No Plan)은 유지, 팀 정렬 통일만 적용.
