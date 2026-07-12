
## 목표
Task Raw Data → Export 결과 xlsx에 업로드 템플릿(`20260711_Task_Management_건축.xlsx`) Gantt 시트와 동일한 **디자인·셀서식 + 일별 간트 바차트**를 함께 렌더링.

## 1. 데이터/컬럼 스타일 (기존 계획 유지)

- 폰트: Malgun Gothic 8.5 / Noto Sans CJK SC (한글). 타이틀 14pt bold `#1F4E79`.
- Data Date 배너: `#C00000` + 노란 셀 `#FFF2CC` (`yyyy-mm-dd`).
- 헤더 3그룹 컬러:
  - 기본/계획 `#1F4E79`, 실제 `#548235`, 진도/차이 `#2E75B6` (모두 흰 bold).
- 데이터 행 그룹 fill: Plan `#F2F2F2` / Actual `#EBF6EB` / Progress `#DEEBF7`.
- Risk="High" 셀 `#ED7D31`.
- numFmt: 날짜 `mm-dd-yy`, 진도 `0.0%`/`0%`, variance `+0%;-0%;0%`, 정수 `0;-0;-`.
- Freeze: 기본 컬럼 끝(=`status_manual`) + 헤더 6행.

## 2. Gantt 바차트 렌더링 (신규)

### 2-1. 일자 범위
- 데이터셋에서 `min(plan_start)` ~ `max(plan_end, actual_finish, forecast_end)` 자동 계산.
- 유효 날짜가 하나도 없으면 Gantt 영역 생략(옵션은 그대로 통과).

### 2-2. 헤더 (좌측 기본컬럼 끝 이후 오른쪽으로 확장)
- 행 5: `MONTH` 라벨. 매월 1일 및 Data Date 열에만 `mmm` 표시, 나머지 공란. fill 헤더 그룹색 상속(`#1F4E79`), 폰트 7pt bold white.
- 행 6: 실제 날짜(serial, `d` numFmt), 폰트 7pt `#444444`.
- 컬럼폭: 각 일자 열 `wch=2.3` (템플릿 U열 폭과 동일).

### 2-3. 바 렌더링 (한 셀 통합, 색상 우선순위)
각 데이터 행 × 각 일자 열에 대해 다음 우선순위로 단일 fill 결정:

1. **지연(Slip)** `plan_end < day ≤ forecast_end` (있고 미완료) → `#FFC7CE` (연한 빨강)
2. **실적 완료분** `actual_start ≤ day ≤ actual_finish` (또는 진행중이면 `day ≤ Data Date`) → `#548235` (진한 녹색)
3. **계획 잔여** `plan_start ≤ day ≤ plan_end` (위 두 조건 미해당) → `#BDD7EE` (연한 파랑)
4. 이외: 아래 4의 배경만 적용

### 2-4. 배경 규칙 (바가 없는 셀)
- **Today 열** (day == Data Date): 좌우 세로선 = 빨간 medium 테두리(`#C00000`) 상단~하단 연속 → 템플릿과 동일한 세로 강조선.
- **금요일(중동 휴일)**: fill `#F2F2F2` (연회색). 토·일은 정상 근무이므로 무처리.
- 그 외: fill 없음.

### 2-5. Freeze / Row height
- Freeze는 기본 컬럼 끝 열 & 데이터 시작 행에 고정(스크롤 시 좌측 데이터 + 상단 헤더 유지, 우측 Gantt만 스크롤).
- 행 높이: 헤더 32, 데이터 22.

## 3. 구현 변경 파일

### `src/lib/excel/styled-workbook.ts`
- `StyledSheetOptions`에 옵션 추가(모두 optional, SHAW 등 기존 사용자 영향 없음):
  - `theme?: "default" | "gantt"`
  - `columnGroup?: (key) => "basic"|"plan"|"actual"|"progress"`
  - `dataDate?: string` (ISO)
  - `numFmtByKey?: Record<string,string>`
  - `cellStyleOverride?: (key, value, row) => Partial<Style> | null`
  - `gantt?: { startDate: string; endDate: string; rowDates: (row) => { planStart?; planEnd?; actualStart?; actualFinish?; forecastEnd?; done?: boolean } }`
- Gantt 프리셋 상수(위 색상) 추가.
- Gantt 활성 시:
  1. 좌측 데이터 컬럼 후 오른쪽으로 `endDate - startDate + 1` 개 컬럼 append.
  2. 헤더 2행(월/일) 채우기.
  3. 데이터 행 루프에서 각 일자 셀 fill/border 결정 & 기록.

### `src/components/task-management/raw-data/ExportDialog.tsx`
- `format === "view"`에서만 Gantt 옵션 전달, `reimport`는 기존 방식 유지(재업로드 파서 안정성).
- `gantt.rowDates`는 각 row에서 `plan_start`, `plan_end`, `actual_start`, `actual_finish`, `forecast_end`, `actual_progress` 추출; `done = actual_progress >= 100`.
- 컬럼폭·Freeze·numFmt는 위 정책대로.

## 4. 검증

- `tsgo` 타입체크.
- 실제 데이터로 export 후 openpyxl로 파싱하여:
  - 헤더 fill 그룹, Gantt 영역 폭·numFmt·요일별 배경, 지연/실적/계획 색 순서, Today 세로선 좌우 위치 검증.
- 대량 데이터(수백 행 × 수백 일) 성능 확인 — 셀 fill 직접 지정 방식이므로 조건부 서식보다 파일 크기가 크지만 뷰어 호환성 우선.

## 결정된 사항 (질문 응답 반영)
- 통합 1줄 바, 데이터 자동 범위, Today 세로선, 금요일만 회색.
- Re-import 포맷은 Gantt 미포함.
- 부모 롤업 하이라이트는 이번 스코프에서 제외(추후 `row_type` 기반 확장 가능).

승인 시 위 순서대로 구현하겠습니다.
