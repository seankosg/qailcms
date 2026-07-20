# DMR Dashboard 추이 차트 필터 개편

## 목표
- "일자별 총원 추이 (Actual vs Plan)" 차트의 데이터 소스를 `plot='TOTAL'` 집계 행에서 **Raw Data(C, D 개별 행) 합산**으로 변경
- 차트 상단에 4종 다중선택 필터 배치: Team(토글), Plot(토글), Work Description(풀다운), Sub Contractor(풀다운)

## 대상 파일
- `src/components/resource/dmr/DmrDashboardPage.tsx`

## 구현 상세

### 1) 데이터 소스 변경
- `entriesQuery`에서 `.eq('plot', 'TOTAL')` 제거
- `plot IN ('C','D')`로 조회하여 Raw Data 행 그대로 합산
- 이로써 하위 필터(Plot 개별 선택 시 C만/D만 등)가 의미를 갖게 됨
- `kpi`, `byDiscipline`, `trend`, `matrix` 계산 모두 새 소스 사용

### 2) 필터 상태 (모두 다중선택, 빈 배열 = 전체)
- `teams: string[]` — 기존 단일 `discipline` 대체
- `plots: ('C'|'D')[]` — 신규
- `workDescriptions: string[]` — `system_name` 컬럼 기준
- `subContractors: string[]` — `contractor_name` 컬럼 기준
- 기존 `유형(직영/협력사)` 필터는 유지 (별도 축)

### 3) 필터 UI (차트 상단, 기존 필터 바 확장)
- **Team, Plot**: `ToggleGroup type="multiple"` 형태 버튼 그룹
  - Team 옵션: `DMR_DISCIPLINES` (CIVIL/ELEC/MECH 등)
  - Plot 옵션: `C`, `D`
- **Work Description, Sub Contractor**: 체크박스 리스트가 있는 `Popover` 풀다운
  - "Select all / Clear" 버튼 포함 (앱 전반 관례)
  - 선택 개수 배지 표시 (예: "Work Desc (3)")
  - 옵션은 현재 로드된 window 데이터에서 distinct 추출 (report_date, contractor_name, system_name 셀렉트에 이미 포함)

### 4) 필터 적용 순서
1. 서버 쿼리: `report_date` 범위 + `plot IN ('C','D')`
   (Team/Work Desc/Sub Contractor는 옵션 목록 유지를 위해 클라이언트 필터)
2. 클라이언트 필터: teams / plots / workDescriptions / subContractors / 직영·협력사

### 5) 기존 요소 처리
- KPI Strip, Discipline 카드, Contractor 매트릭스: 동일한 `rows` 파생을 사용하므로 필터 자동 반영
- Data Date, 기간(7/14/30d): 유지

## 기술 노트
- 새 UI 컴포넌트는 기존 `@/components/ui/toggle-group`, `popover`, `checkbox`, `command` 사용 (앱 내 이미 활용 중)
- DB 스키마 변경 없음, 마이그레이션 없음
- 서버 함수 추가 없음 (창 크기가 작아 클라이언트 필터로 충분)

## 검증
- Plot=C만 선택 → 차트 값이 Raw Data의 C행 합계와 일치
- Team 2개 토글 → 해당 팀 합산만 표기
- Work Desc / Sub Contractor 다중 선택 시 차트, KPI, 매트릭스 모두 갱신
