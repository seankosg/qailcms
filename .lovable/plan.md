
## 목표
`DmrDashboardPage.tsx`의 "Daily Manpower Status" 카드 라벨을 **"Daily Manpower Record"**로 변경하고, 매트릭스를 **Subcon**과 **System** 두 개 탭으로 분리한다. Subcon 탭은 현재 구성(Sub Contractor × Date) 그대로 이동, System 탭은 동일한 로직·UI로 축만 `system_name`으로 교체한다.

## 변경 파일
- `src/components/resource/dmr/DmrDashboardPage.tsx`

## 구현 상세

1. **카드 제목 변경** — 기존 "Daily Manpower Status" 텍스트를 전면 "Daily Manpower Record"로 교체.

2. **매트릭스 데이터 확장** — 기존 `matrix` useMemo를 일반화하여 두 그룹 축(`contractor_name`, `system_name`)에 대한 dates/keys/cell 함수를 각각 계산 (`subconMatrix`, `systemMatrix`). 로직·정렬·집계 방식은 현행 Subcon 매트릭스와 100% 동일.

3. **UI 탭화** — 카드 헤더에 `Tabs`(shadcn)로 Subcon / System 두 TabsList 추가. TabsContent 각각에 동일한 테이블 구조를 렌더:
   - 좌측 sticky 컬럼 라벨: Subcon 탭은 "Sub Contractor"(+ 직영 뱃지 유지), System 탭은 "System"(뱃지 없음).
   - 나머지 헤더/셀/합계/빈상태 문구·클래스는 현행과 동일.
   - sticky 컬럼 배경 100% 불투명 규칙 유지(mem 규칙).

4. **동작 유지** — 기존 필터(Team/Plot/Work Description/Sub Contractor/유형/Data Date/기간) 및 `rows` 필터링 결과를 두 탭 공통으로 사용. KPI/Discipline/Trend 카드 영향 없음.

## 스코프 외
- 다른 카드(KPI, Discipline, Trend), 데이터 로딩 쿼리, 컬럼 정의, 필터 UI는 변경하지 않음.
