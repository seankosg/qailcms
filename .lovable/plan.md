
## 배경
파서(`toIsoDate`) 타임존 버그로 KST/Doha 환경에서 임포트된 TM 날짜 필드가 원본보다 -1일 앞당겨져 저장되었습니다. 이미 저장된 데이터를 원본 기준으로 일괄 보정합니다.

## 대상 (DB 실측, 총 1,298행)

**Step 1 — 원본 확보 파일: 셀 단위 대조 후 정밀 보정 (912행)**

| source_file (DB) | 행수 | 매칭 원본 |
|---|---:|---|
| Task Management_전기_260720.xlsx | 582 | `Task_Management_전기_260720_서창훈.xlsx` (유사본) |
| 20260719_Task Management_건축_REV03.xlsx | 331 | 없음 → Step 2로 이동 |
| Task Management_전기_260720_서창훈.xlsx | 34 | ✅ |
| Task Management_전기_260718 (1).xlsx | 6 | `Task_Management_전기_260713.xlsx` (유사본) |

원본이 확실히 확보된 것은 34행뿐이며, "유사본"은 시점이 다를 수 있어 부정확합니다. → **실질적으로 Step 1 정밀 대조는 불확실 → 사용자 지시(A안)에 따라 전체를 Step 2 방식으로 통일**하는 것이 오히려 일관적입니다.

## 확정 방침 (사용자 승인: A안)

**모든 1,298행에 대해 5개 날짜 컬럼을 `+ interval '1 day'` 일괄 shift**  
- 대상 컬럼: `plan_start`, `plan_end`, `actual_start`, `actual_finish`, `forecast_end`
- NULL 값은 NULL 유지 (COALESCE로 방어)
- 파서 버그 시점 이전/이후를 구분하지 않음: 현재까지의 모든 임포트가 동일 버그 하에 있었음

## 실행 단계

### 1. 사전 백업
`create_database_snapshot('pre_tm_date_shift_fix')` 호출로 `task_management_raw` 스냅샷 생성

### 2. 마이그레이션 실행
```sql
UPDATE public.task_management_raw
SET
  plan_start     = plan_start     + INTERVAL '1 day',
  plan_end       = plan_end       + INTERVAL '1 day',
  actual_start   = actual_start   + INTERVAL '1 day',
  actual_finish  = actual_finish  + INTERVAL '1 day',
  forecast_end   = forecast_end   + INTERVAL '1 day';
```
`date` 타입에 `INTERVAL '1 day'` 더하면 결과도 `date` 유지, NULL은 NULL 유지.

### 3. 파생 필드 재계산 강제
Sub Task 파생 트리거(`calc_sub_task_derived_fn`)는 원본 컬럼 변경 시 자동 발화하지만, 대량 UPDATE라 확실하게 하기 위해:
- `SELECT update_task_summary(id) FROM task_management_raw WHERE is_rollup = true;` 전 Main 롤업 재계산
- `SELECT recalc_task_auto_judgment(id) FROM task_management_raw;` 전 행 자동 판정 재계산

### 4. 검증
- 랜덤 샘플 20행 before/after 로그 (별도 임시 테이블 `_tm_date_shift_log`에 백업 후 대조)
- `plan_days`, `plan_progress`, `slip_days` 정합성 스팟체크

### 5. 파서 버그 자체 수정 (이번 계획 범위 외 · 알림용)
`src/lib/task-management/parser.ts`의 `toIsoDate`를 UTC 컴포넌트 기반으로 별도 계획서에서 처리 (이번 데이터 보정과 분리). 이 수정이 되기 전 재임포트하면 다시 -1일 문제가 재현됩니다 — 파서 수정 계획을 이어서 진행할지 별도 확인 부탁드립니다.

## 롤백 시 안전 장치
- 스냅샷 복원으로 즉시 원복 가능
- `_tm_date_shift_log` 임시 테이블에 UPDATE 전 상태 저장

## 산출물
- 스냅샷 ID
- 영향 행수 요약 (컬럼별 non-null 카운트)
- 샘플 검증 로그
