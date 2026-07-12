# 의도 vs 실제 export 비교 → 개선 계획

## 1. 파일 차이 요약

| 항목 | 의도(20260711_Task_Management_건축-3) | 실제(task-management_view_20260712_0939) |
| --- | --- | --- |
| 시트 구성 | `Gantt` + `설정` + `일일 모니터링` + 세부 태스크 시트 다수 | `Task Management` 단일 시트 |
| 헤더 구조 | 4행 배너 + 2행 병합 그룹헤더(row5+row6) + 캘린더 헤더 U5(월 수식)/U6(일자 수식) | 배너 4행 + 헤더 1행, 캘린더 월/일 구분 행 없음 |
| Data Date | `설정!$B$3` 단일 셀 → 전체 재계산 트리거 | 정적 텍스트("Data Date ▶ 2026-07-12") |
| 계산 컬럼 (M/P/Q/S/T) | 전부 수식 (`=L-K+1`, `=IF($D$4<K,0,MIN(1,($D$4-K+1)/M))`, `=O-P`, `=IF(ISNUMBER(R),R-L,"")`, 중첩 IF 자동판정) | **하드코딩 정적 숫자** |
| 부모행 rollup | K/L/M/N/O/R = 자식 범위 MIN/MAX/SUMPRODUCT | 하드코딩 (스코프 유지) |
| 캘린더(U~FQ) 헤더 | `U6=설정!$B$3`, `V6=U6+1`, `U5=IF(OR(DAY(U6)=1,U6=설정!$B$3),TEXT(U6,"m월"),"")` | 정적 date serial, 월 라벨 행 없음 |
| Gantt 바 렌더링 | **14종 조건부서식**: 계획(실행/승인/대기/항목 4색), 실적, 지연 갭, 계획완료, 예상완료, Data Date/Today 세로선, 금요일 회색 | 각 셀에 **정적 fill** |
| 판정 T열 색상 | CF (지연/주의/완료) | 정적 fill |
| 진도차 Q열 색상 | CF (`$Q<0` 빨강, `$Q>=0 & $O>0` 초록) | 없음 |
| 지연행 하이라이트 | CF `$T7="지연"` → 행 전체 톤 다운 | 없음 |
| 판정 로직 | 중첩 IF 수식 (기준 `설정!$B$8`) | 없음 (DB `judgment` 값 그대로) |
| numFmt | 진도율 `0.0%`, 계획일수 `0`, 날짜 `dd-mmm` | 진도율 소수 그대로 등 일부 누락 |
| 재임포트 안전성 | 수식 존재로 그대로 재임포트 불가 | 값 기반이라 재임포트 가능 |

## 2. 개선 방향 (옵션 A 확정 · view 포맷 한정)

**"파생값만 수식화 + Gantt 바는 조건부서식"**. 부모행 rollup 미도입, reimport 포맷은 건드리지 않음.

### 2-1. 시트 구성
- 첫 시트명은 **`Task Management` 로 유지** (변경 없음).
- **`설정` 시트 추가** (2번째 시트, view 포맷 한정):
  - `B3` = 차트 시작일(계산된 `gantt.startDate`)
  - `B4` = 차트 일수 (`ganttDays.length`)
  - `B5/B6/B7` = 데드라인 슬롯 3개 (값 없으면 공란)
  - `B8` = 진도차 알람 기준 (기본 `-0.05`)
  - A11~A22 범례 텍스트 + 색상 샘플 셀
- `Data Date ▶` 배너의 값 셀 `D4` 를 `=설정!$B$3` 참조로 두어 `설정!B3` 한 셀만 바꾸면 캘린더·판정이 전부 이동.

### 2-2. 헤더
- 데이터 컬럼 헤더: row5+row6 병합(그룹헤더+세부헤더 통합 자리).
- 캘린더 영역:
  - `row5` 월 라벨 수식: `=IF(OR(DAY(U6)=1,U6=설정!$B$3),TEXT(U6,"m월"),"")` (i=0 특별 케이스 포함)
  - `row6` 일자 수식: `U6=설정!$B$3`, `V6=U6+1`, … numFmt `"d"`
- 프리즈 `U7`. 폰트/배경은 현행 gantt 테마 유지.

### 2-3. 파생 컬럼 수식화 (`format==="view"` 만)

컬럼 문자는 `columns` 배열의 실 위치에서 계산 (하드코딩 금지). 필요한 원본(K plan_start, L plan_end, O actual_progress, R forecast_end, J status)이 export 스코프에 없는 경우 해당 파생은 값 유지로 폴백.

| key | 수식 (행 r) | numFmt |
| --- | --- | --- |
| `plan_days` (M) | `=IF(AND(ISNUMBER(K{r}),ISNUMBER(L{r})),L{r}-K{r}+1,"")` | `0;-0;-` |
| `plan_progress` (P) | `=IF(OR(NOT(ISNUMBER(K{r})),NOT(ISNUMBER(L{r})),(L{r}-K{r}+1)=0),"",IF($D$4<K{r},0,MIN(1,($D$4-K{r}+1)/(L{r}-K{r}+1))))` | `0.0%;-0.0%;-` |
| `delta_pp` (Q) | `=IF(AND(ISNUMBER(O{r}),ISNUMBER(P{r})),O{r}-P{r},"")` | `0.0%;-0.0%;-` |
| `slip_days` (S) | `=IF(AND(ISNUMBER(R{r}),ISNUMBER(L{r})),R{r}-L{r},"")` | `0;-0;-` |
| `judgment` (T) | `=IF(OR($J{r}="완료",$O{r}>=1),"완료",IF(AND(ISNUMBER($R{r}),$R{r}>$L{r}),"지연",IF($D$4>$L{r},"지연",IF($Q{r}<=설정!$B$8,"지연",IF(AND($D$4>=$K{r},$O{r}=0),"주의(미착수)",IF($D$4>=$K{r},"진행","예정"))))))` | 텍스트 |

### 2-4. Gantt 바 → 조건부서식 대체
캘린더 셀 렌더 루프에서 계산해 넣던 `fillRgb` 를 제거하고, `U7:{lastCal}{lastRow}` 범위에 규칙만 심음 (우선순위 순):

1. `WEEKDAY(U$6)=6` → 금요일 회색 `#F2F2F2`
2. `U$6=$D$4` → Data Date 세로선 (옅은 노랑 + 빨강 border)
3. `U$6=TODAY()` → Today 세로선
4. `AND($I7<>"항목",ISNUMBER($R7),U$6=$R7)` → 예상완료 마커
5. `AND($I7<>"항목",ISNUMBER($K7),U$6>=$K7+$O7*($L7-$K7+1),U$6<=$L7,U$6<$D$4)` → 지연 갭 `#FFC7CE`
6. `AND($I7<>"항목",ISNUMBER($K7),U$6>=$K7,U$6<$K7+$O7*($L7-$K7+1))` → 실적 `#548235`
7. `AND(U$6=$L7,$I7=...)` → 계획완료일 강조 4종 (실행/승인/대기/항목)
8. `AND(U$6>=$K7,U$6<=$L7,$I7="실행"/"승인"/"대기"/"항목")` → 계획 구간 4색

### 2-5. 판정·진도차·지연행 CF
- `T7:T{last}` 3규칙 (지연/주의/완료 색).
- `Q7:Q{last}` 2규칙 (`$Q<0` 빨강 글자, `$Q>=0 & $O>0` 초록 글자).
- `B7:B{last}` 1규칙 `$T7="지연"` → 행 하이라이트 (부모행 override 와 충돌 없게 자식행만).

### 2-6. 파일/포맷 옵션
- view 포맷에서만 상기 로직 활성화 (`formulaMode:"template"`).
- reimport 포맷은 순수 값 유지 (회귀 없음).

## 3. 변경 파일
- `src/lib/excel/styled-workbook.ts` — 캘린더 헤더 수식, 파생 컬럼 수식, CF 규칙 주입, `설정` 시트 빌더.
- `src/components/task-management/raw-data/ExportDialog.tsx` — view 분기에서 `formulaMode:"template"` 옵션 전달.

## 4. 위험/체크리스트
- **xlsx-js-style 의 조건부서식 지원 확인이 최우선**. 먼저 최소 파일 1개로 CF 1개 저장 → openpyxl 로 읽어 규칙이 살아있는지 스파이크. 미지원 시 `exceljs` 병용 후처리로 전환(라이브러리 교체는 별도 승인 필요).
- 캘린더 시작이 `설정!$B$3` 참조 → CF 범위는 넉넉히(최대 730행/열) 고정.
- 파생 필드가 view 스코프에 없거나 이름이 바뀐 경우 값 폴백 처리.

## 5. 검증
1. openpyxl 로 `설정!B3`, `D4=수식`, K/L/M/P/Q/S/T `data_type=="f"` 확인.
2. CF 규칙 수·수식 텍스트를 의도 파일과 대조.
3. Excel/LibreOffice 에서 `설정!B3` 하루 변경 시 캘린더/판정 재계산 육안 확인.
4. Reimport 회귀 테스트.

## 6. 스코프 외
- 부모행 rollup 수식.
- 세부 태스크 시트, `일일 모니터링` 시트.
- Task Tree UI/계산 변경.
