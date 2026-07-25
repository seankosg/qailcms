## 배경

세 파일 실측 audit 결과:

| 파일 | 비교 행 | 총 diff | -1일 시프트 |
|---|---|---|---|
| 신민호 `Task_Management_전기_260723_신민호_2.xlsx` | 93 | 190 | **190 (100%)** |
| 서창훈 `Task_Management_전기_260725_서창훈_1.xlsx` | 66 | 170 | **155 (91%)** |
| 임대현 `task-management_reimport_20260725_임대현.xlsx` | 57 | 8 | 1 (재수출본이므로 이미 시프트된 값끼리 재-일치) |

**근본 원인 (`src/lib/task-management/parser.ts` + `src/lib/time/doha.ts`)**

1. `XLSX.read(buf, { cellDates: true })` — 숫자 serial 셀을 `Date` 객체로 자동 변환.
2. `toIsoDate` 안에서 `dohaDateOnly(v)` 호출 → `dohaDateOnly`는 `d.getFullYear/getMonth/getDate()`를 사용해 **브라우저 로컬 TZ의 wall-clock**을 읽음.
3. Cloudflare Worker(SSR) 또는 UTC+ 오프셋 브라우저 조합에서 `cellDates`가 만든 `Date`의 로컬 Y/M/D가 원본 셀의 Y/M/D와 하루씩 어긋남 → -1일 시프트 대량 발생.
4. 문자열 fallback 경로에서 `toDohaDateKey(s)`도 내부적으로 `new Date(string)`을 사용해 동일 위험.

## 목표

1. TM 파서에서 **TZ 개입을 원천 차단**하여 향후 임포트에서 -1일 시프트 재발 방지.
2. 이번 3개 배치(신민호·서창훈·임대현 재임포트)가 최종 write한 행들의 시프트된 날짜 컬럼을 **+1일 복구**.
3. 세 파일 재-audit로 -1일 시프트 0건 확인.

## Phase 1 — 파서 근본 수정 (코드)

**대상 파일**: `src/lib/task-management/parser.ts`

- `XLSX.read` 호출 3곳(라인 354, 369, 422)에서 `cellDates: true` → **`cellDates: false`** 로 변경.
- `toIsoDate`(라인 184~232) 재작성:
  - `Date` 입력 분기 유지하되(레거시 안전), `dohaDateOnly` 대신 **UTC getters** 사용 (`d.getUTCFullYear/…`). SheetJS가 cellDates 없이 반환한 값이 아니라 외부에서 넘어오는 Date 대비.
  - `number` 입력 → 기존대로 `XLSX.SSF.parse_date_code`로 Y/M/D 추출 (이미 TZ 무관).
  - `string` 입력 fallback:
    - `YYYY-MM-DD`, `dd/mm/yyyy`, `dd-mm-yyyy`, `dd-MMM-yyyy`, `MMM dd yyyy`, `m/d/yy` 등 **정규식으로 Y/M/D 숫자만 추출**하는 헬퍼 신설.
    - `toDohaDateKey(s)` 최종 fallback 호출을 **완전히 제거**.
- `src/lib/time/doha.ts`: `dohaDateOnly` 주석에 "TZ 의존 함수 — 파서에서 사용 금지" 명시 (다른 UI 표시용 호출은 그대로 유지).

## Phase 2 — 데이터 복구 (마이그레이션 아님, `insert` 툴)

**대상 배치** (import_logs id로 특정):
- 신민호: `Task Management_전기_260723_신민호 (2).xlsx` (도하시간 2026-07-25 17:48)
- 서창훈: `Task Management_전기_260725_서창훈 (1).xlsx` (도하시간 2026-07-25 16:38)
- 임대현: `task-management_reimport_20260725_1321.xlsx` (도하시간 2026-07-25 16:47)

**복구 규칙**:
- 각 배치의 `_batch_no`로 필터한 `task_management_raw` 행들에서 아래 컬럼을 **`+ INTERVAL '1 day'`**:
  - `plan_start`, `plan_end`, `actual_start`, `actual_finish`, `forecast_end`, `data_date`
- **적용 조건**: 해당 행의 `source_file`이 위 세 파일 중 하나이고, 이후 다른 배치가 같은 `task_no`를 덮어쓰지 않았을 때만 (즉 `updated_at`이 그 배치 임포트 시각 근처인 행만 대상). 안전을 위해 배치 단위 `_batch_no` 매칭을 1차 조건으로 사용.
- 롤업/트리거 재계산이 필요한 파생 필드(`plan_progress`, `progress_variance`, `expected_progress_today`, `forecast_end` 자동값 등)는 기존 트리거 `calc_sub_task_derived_fn` / `recalc_task_auto_judgment` / `rollup_task_all_mains`가 UPDATE 발생 시 자동 재계산되므로 별도 조치 불필요 (계획 검증 시 실행 후 spot-check).

**보호 장치**:
- 실행 전 `task_schedule_change_audit`에 스냅샷 자동 기록 여부 확인. 없다면 수동으로 `SELECT INTO` 백업 테이블 `_tm_date_shift_backup_20260725` 생성.
- 시프트 대상이 아닌(이미 정상 저장된) 행 오염 방지를 위해, `UPDATE ... WHERE _batch_no = $batch AND <col> IS NOT NULL` 형태로 좁힘.

## Phase 3 — 검증

1. `parser.ts` 수정본으로 세 파일 재-parse (테스트 스크립트) → 엑셀 원본 값과 100% 일치 확인.
2. Phase 2 복구 후 세 배치 대상 `task_management_raw` vs 엑셀 원본 diff 재-실행 → -1일 시프트 0건 확인.
3. 파생 필드(plan_progress, forecast_end 자동값) 트리거 재계산 결과 spot-check.

## 사용자 조치 순서

Phase 1 (코드) → Phase 2 (`insert` 툴로 복구 SQL 실행 승인) → Phase 3 (검증 리포트).

## 기술 노트

- 다른 모듈 파서(defect, abd, aconex)도 동일한 `cellDates:true` + `dohaDateOnly` 조합을 사용하므로 **동일 결함 잠재** — 이번 계획에는 포함하지 않되, 완료 후 별건으로 감사 권장.
- Phase 2 복구는 오직 **이번 3개 배치**만 대상 (사용자 확정). 다른 과거 배치의 시프트는 남으며, 필요 시 별도 논의.
