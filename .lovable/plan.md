# Task Raw Data Export — 원본 템플릿 완전 재현 (Step 1+2+3)

원본 `업무_간트차트_예제_최종_v3.xlsx`의 `Gantt` 시트 및 `설정` 시트 구조/수식/서식을 완전히 재현하도록 Export 파이프라인을 재작성한다.

---

## Step 1. Gantt 시트 헤더·데이터·달력 정렬

### 1-1. 시트 및 상단 영역
- 시트명: `Gantt` (기존 `Task Raw Data` 사용 중지)
- `B1`: 타이틀 (예: `업무 간트차트`)
- `D4`: Data Date = `=설정!$B$3`
- 5행: A열~T열 헤더

### 1-2. A~T 열 원본 순서 고정 (`TM_GANTT_ORIGINAL_ORDER`)
```text
A  No
B  Category
C  Plot
D  항목
E  리스크
F  단계별 세부 업무
G  담당
H  유형
I  상태
J  계획시작
K  계획완료
L  계획일수
M  실제시작
N  실적진도율
O  계획진도율
P  진도차
Q  예상완료
R  차이(일)
S  자동판정
T  (예비/여백)
```
(주의: 요약에 있던 컬럼 매핑을 원본 파일 A..T 순서로 강제 정렬. `parser.ts`가 채우는 필드 키를 이 순서로 매핑)

### 1-3. U열 이후 캘린더
- `U6 = 설정!$B$3` (차트 시작일)
- `V6 = U6 + 1`, `W6 = V6 + 1` … 오른쪽으로 확장
- 일수: 원본 값 `설정!B4 = 153`을 그대로 사용, 상한 730으로 캡
- 6행: 날짜 헤더 (숫자 저장, 표시형식 `yyyy-mm-dd`)
- 5행 캘린더 영역은 병합 없음(원본과 동일)

### 1-4. 셀 서식
- J·K·M·Q 등 날짜 컬럼: `yyyy-mm-dd`
- L·R (일수): `0`
- N·O·P (진도율/차): `0%`
- U6 이후 헤더: `yyyy-mm-dd`
- 폰트/굵기/정렬/테두리: 원본과 동일하게 헤더행 굵게, 데이터행 얇은 테두리, 가운데정렬(캘린더), 좌측정렬(F열 세부업무)

### 1-5. 파일 편집
- `styled-workbook.ts::applyGanttTemplate` — 헤더 5행, 6행 캘린더 헤더, 데이터 시작 7행으로 재정렬
- `ExportDialog.tsx::ganttViewCols()` — A..T 원본 순서 반환
- `ExportDialog.tsx::NUMFMT_BY_KEY` — 위 서식 반영
- `ExportDialog.tsx::computeGanttRange` — 기본 153일, 상한 730
- `columns.ts` — `TM_GANTT_ORIGINAL_ORDER` 상수 신설

---

## Step 2. 설정 시트 + 조건부서식(CF) 규칙

### 2-1. `설정` 시트 (원본 배치 그대로)
```text
B3  Data Date (실제 진도 기준일)
B4  차트 시작일
B5  차트 일수 (기본 153)
B8  진도차 알람 임계값 (예: -0.05)
```
- A열에 라벨 텍스트, B열 값
- 값 셀은 노란색 배경(입력 셀 강조)로 원본과 동일
- 날짜셀 `yyyy-mm-dd`, 임계값 `0.00`

### 2-2. 캘린더(U7 이하) 조건부서식 14규칙
우선순위 순 (원본 파일 규칙 그대로):

1. **지연 갭**: `계획완료 < Data Date AND 진도율<100%` 구간 → `FFE06666`
2. **실적 진척 구간**: `계획시작 ≤ U$6 ≤ 실제완료계산일` → `FF548235`
3. **예상 완료일**: `U$6 = 예상완료(Q)` → `FF7030A0`
4. **계획 완료일 (실행)**: 상태=실행 → `FF2E75B6`
5. **계획 완료일 (승인)**: 상태=승인 → `FFC55A11`
6. **계획 완료일 (대기)**: 상태=대기 → `FF7F7F7F`
7. **계획 완료일 (항목/부모)**: 유형=항목 → `FF1F4E79`
8. **계획 구간 (실행)**: J≤U$6≤K, 상태=실행 → 연한 파랑
9. **계획 구간 (승인)**: 연한 주황
10. **계획 구간 (대기)**: 연한 회색
11. **계획 구간 (항목)**: 연한 남색
12. **Data Date 열**: `U$6 = $D$4` → `FFFFC000`
13. **오늘 열**: `U$6 = TODAY()` → `FFFFE699`
14. **금요일 표시**: `WEEKDAY(U$6,2)=5` → `FFE7E6E6`

### 2-3. 데이터 컬럼 CF
- **S열 자동판정**: `지연`→`FFC00000`, `주의`→`FFED7D31`, `완료`→`FF548235` (텍스트 흰색/검정 대비)
- **P열 진도차**: `<설정!$B$8`(음수 임계값 초과) → `FFFCE4D6` / `≥0` → `FFE2EFDA`
- **A열 No**: 해당 행 S=`지연` → `FFFCE4E4`

### 2-4. 파일 편집
- `styled-workbook.ts::buildSettingsSheet` 신설/개정
- `styled-workbook.ts::applyGanttTemplate` 내 CF 규칙 14개 추가 + 데이터 컬럼 CF 3세트 추가

---

## Step 3. 부모(항목) 행 집계 수식

### 3-1. 유형=`항목` 행의 컬럼별 수식
`cs`=자식 시작행, `ce`=자식 종료행이라 할 때:
- **J (계획시작)**: `=MIN(J{cs}:J{ce})`
- **K (계획완료)**: `=MAX(K{cs}:K{ce})`
- **L (계획일수)**: `=K{r}-J{r}+1`
- **M (실제시작)**: `=IFERROR(MIN(IF(M{cs}:M{ce}<>"",M{cs}:M{ce})),"")` (배열)
- **N (실적진도율)**: `=IFERROR(SUMPRODUCT(N{cs}:N{ce},L{cs}:L{ce})/SUM(L{cs}:L{ce}),0)`
- **O (계획진도율)**: 동일 가중평균
- **P (진도차)**: `=N{r}-O{r}`
- **Q (예상완료)**: `=MAX(Q{cs}:Q{ce})`
- **R (차이일)**: `=Q{r}-K{r}`
- **S (자동판정)**: `=IF(N{r}>=1,"완료",IF(P{r}<설정!$B$8,"지연",IF(P{r}<0,"주의","정상")))`

### 3-2. 자식 행 수식
- **L**: `=K{r}-J{r}+1`
- **P**: `=N{r}-O{r}`
- **O (계획진도율)**: `=IF(TODAY()<J{r},0,IF(TODAY()>=K{r},1,(TODAY()-J{r}+1)/L{r}))`
- **R**: `=IF(Q{r}="","",Q{r}-K{r})`
- **S**: 위와 동일

### 3-3. 항목 그룹 판별
- `parser.ts` 결과에서 `유형` 컬럼 값이 `항목`인 행을 부모로, 다음 부모 이전까지를 자식 범위로 설정
- Export 시 부모 행 배열 위치를 계산해 `cs`/`ce`를 실제 엑셀 행 번호로 치환

### 3-4. 파일 편집
- `useDefectRawData.ts` (또는 task 대응 훅) — 파서 결과에서 항목 그룹 인덱스 계산 후 workbook 빌더에 전달
- `styled-workbook.ts::applyGanttTemplate` — 위 수식을 셀 값 대신 formula로 기입
- `ExportDialog.tsx` — hardcoded 값 대신 formula 우선 기입 로직

---

## 변경 파일 요약
- `src/features/task-management/export/styled-workbook.ts` (대폭 개정)
- `src/features/task-management/export/ExportDialog.tsx`
- `src/features/task-management/export/columns.ts` (`TM_GANTT_ORIGINAL_ORDER` 상수)
- `src/features/task-management/export/parser.ts` (참조 확인, 필요 시 항목 그룹 인덱스 노출)
- `src/hooks/useTaskRawData.ts` (해당 훅) — 그룹 인덱스 전달

## 검증
1. Export 후 파일을 원본과 나란히 열어 다음을 확인:
   - 5행 헤더 A..T 문자열 일치
   - U6부터 153개 날짜 헤더 일치
   - 캘린더 색상 14규칙이 동일 좌표에 발현
   - 부모 행 J/K/L/N/O/P/Q/R/S가 수식으로 저장되어 있고 계산값 일치
   - 설정!B3/B4/B5/B8이 원본 좌표와 값 형식 일치
2. `openpyxl`로 열어 formula 문자열 스팟체크
3. LibreOffice로 재계산 후 `#REF!/#DIV0/#VALUE` 없음 확인
