## 목표

1. "Cum. Diff" 컬럼값이 **누계 실적(Actual %) − 누계 계획(Plan %)** 산식으로 파생 계산되도록 확실히 반영한다. 임포트값(엑셀 R열 "진도차 (%p)")은 표시에 사용하지 않는다.
2. 라벨 변경(`Variance (%p)` → `Cum. Diff`)에 맞춰 임포트 매핑 alias 를 보강하고, 관리자 헤더 매핑 UI 에서 신규 alias 를 인식하도록 시스템을 정비한다.

3. "오늘" 3형제 컬럼(T.Plan / T.Actual / T.Diff) 재정의는 직전 계획대로 유지.

## Cum. Diff 산식 반영 위치 (세부)

Cum. Diff 파생 산식 = `clamp(actual_progress, 0..1) − computeTPlan(row, asOf)`.

- `computeTPlan` 은 `elapsed / duration_days` (0..1)로 asOf 시점의 **누계 계획진도율**. 이미 존재하는 함수(변경 없음).
- clamp 이유: `actual_progress` 는 저장 스케일이 0..1 이지만 임포트 오류 등으로 넘칠 수 있어 방어.
- computeTPlan == null(plan_start 없음) 이면 Cum. Diff = "—" (판정도 "정상").

### 변경 파일 상세

**A. `src/lib/task-management/derived.ts`**
- 신설 `computeVariance(row, asOf): number | null` — 위 산식. null 규칙 포함.
- `computeVariance` 를 `isBehindSchedule / isCriticalDelay / computeJudgment(WIP)` 에서 공통으로 재사용해 산식 단일화.

**B. `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`**
- `progress_variance` 컬럼 렌더 분기 추가(현재는 일반 accessorKey로 DB값을 그대로 표시 중):
  - `accessorFn: (r) => computeVariance(r, selectedDataDate)` — DB 저장값 무시.
  - 셀 표기: `+/-0.0%p`, 색상 `< behind_late_gap` 로즈 / `< behind_warn_gap` 오렌지 / `< 0` 앰버 / `≥ 0` 에메랄드 / null 은 muted "—".
  - 정렬은 accessorFn 값 기준. 필터는 number-range 유지.

**C. `src/components/task-management/raw-data/ExportDialog.tsx`**
- `progress_variance` 내보내기 값도 `computeVariance` 로 파생 계산해서 출력(엑셀-화면 정합).

## 헤더 alias 보강 & 신규 매핑 로직

### D. `src/lib/task-management/parser.ts` — `TASK_FIELD_ALIASES.progress_variance`
- 현재: `["진도차 (%p)", "진도차(%p)"]`
- 확장:
  ```
  progress_variance: [
    "진도차 (%p)", "진도차(%p)",
    "Cum. Diff", "Cum Diff", "Cumulative Diff", "Cumulative Difference",
    "누계 차이", "누계차이", "누계 진도차", "Variance (%p)", "Variance(%p)",
  ]
  ```
- `plan_progress` alias 도 방어적으로 보강: `["계획 진도율", "Plan %", "Cum. Plan", "Cumulative Plan %", "누계 계획", "누계 계획%"]`.
- `actual_progress` alias 도 방어적으로 보강: `["실적 진도율", "Actual %", "Cum. Actual", "Cumulative Actual %", "누계 실적", "누계 실적%"]`.
- 정규화 규칙은 기존 `normalizeHeader`(공백/대소문자/특수문자) 로직을 재사용하므로 공백·괄호 변형(예: `Cum.Diff`)까지 자동 매치.

### E. 관리자 헤더 매핑 저장소 — 신규 alias 시스템 등록
- 테이블 `task_management_header_mappings` (기존)에 신규 alias 를 seed:
  - `progress_variance ← "Cum. Diff"` 를 우선순위 상위로 삽입.
  - 위 D 항목의 모든 alias 를 `INSERT ... ON CONFLICT DO NOTHING` 로 등록.
- 마이그레이션이 아닌 **insert 툴**로 데이터 삽입(스키마 변경 없음).
- 관리자 UI(`TmHeaderMappingTable`)에서 즉시 조회·수정 가능.

### F. `src/lib/task-management/parser.ts` — `toTaskFieldName` 라운드-트립
- 이미 `extraAliases`(DB 저장 매핑)를 우선 병합하는 구조이므로 코드 변경 불필요. 시드만 등록되면 자동 동작.
- 신규 alias 추가 시에도 대소문자·공백·`.` 무시하도록 `normalizeHeader` 규칙 재확인만.

## 스코프 외

- Alarm / Progress Icon 가운데 아이콘 / Behind Schedule / Critical Delay 산식 — 직전 계획대로 누계 Cum. Diff 기준 유지, 이번 계획에서 재변경 없음.
- Gantt 원본 xlsx 재현 템플릿(R열 라벨 "진도차 (%p)")은 그대로 유지.
- DB 스키마 변경 없음(파생 계산은 클라이언트, 매핑은 데이터 삽입).

## 검증

1. Raw Data 임의 5개 행: 화면의 `Cum. Diff` = `Actual %` − `Plan %`(=computeTPlan) 산술 일치.
2. `Cum. Diff` null 케이스(plan_start 미기입): 셀 "—", Alarm 정상.
3. 임포트 파일 헤더에 `Cum. Diff` / `Variance (%p)` / `누계차이` 각각을 넣고 세 번 임포트해도 모두 `progress_variance` 로 매핑되는지 확인.
4. 관리자 헤더 매핑 화면에서 신규 alias 목록이 노출되고 삭제·복원 가능한지 확인.
5. 엑셀 내보내기 파일의 `Cum. Diff` 컬럼값이 화면과 100% 일치.
