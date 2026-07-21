## SM Raw Data — planned_start_date 1회 보정 마이그레이션

### 목적
`defect_items_raw` 테이블에서 `actual_start_date`는 있으나 `planned_start_date`가 비어있는 행에 대해, `planned_start_date = actual_start_date`로 1회 채워 넣습니다.

### 실행 SQL
```sql
UPDATE public.defect_items_raw
SET planned_start_date = actual_start_date,
    updated_at = now()
WHERE actual_start_date IS NOT NULL
  AND planned_start_date IS NULL;
```

### 안전장치
- 사전 카운트(대상 건수)를 확인 후 실행 결과와 대조.
- `actual_start_date IS NOT NULL` 조건만 적용 — 기존 `planned_start_date` 값은 절대 덮어쓰지 않음.
- `updated_at`도 함께 갱신하여 이력 추적 가능.
- 이번 작업은 `planned_start_date`만 대상으로 하며, `planned_rectified_date`/`planned_closure_date`는 건드리지 않음.

### 비영향 범위
- 스키마 변경 없음, RLS/트리거/RPC 변경 없음.
- UI 코드 변경 없음.

### 검증
1. 실행 전: 대상 후보 건수 SELECT COUNT.
2. 실행 후: `planned_start_date IS NULL AND actual_start_date IS NOT NULL` 건수가 0인지 확인.
