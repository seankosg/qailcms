## 목표
2026-07-22 이전 레거시 데이터 중 계획일과 실제일이 **둘 다 비어있는** 경우 두 필드 모두 **2026-07-20**로 채워 완료 처리한다.

## 대상 및 조건

공통 필터: `created_at < '2026-07-22 00:00:00+03'` (도하 시간 기준)

### 1) Rectified 스테이지
- `rectified_status = 'Rectified'`
- `actual_rectified_date IS NULL`
- `planned_rectified_date IS NULL`
- → `planned_rectified_date = '2026-07-20'`, `actual_rectified_date = '2026-07-20'`

### 2) Start 스테이지
- `status_raw`가 완료 계열(rectified/complete/completed/closed/verified) 이거나 `rectified_status = 'Rectified'` (= Start가 Done으로 간주되는 조건)
- `actual_start_date IS NULL`
- `planned_start_date IS NULL`
- → `planned_start_date = '2026-07-20'`, `actual_start_date = '2026-07-20'`

## 실행 방법
- `defect_items_raw`에 대해 단일 마이그레이션으로 두 개의 UPDATE 실행
- 실행 전 대상 건수를 조회하여 사용자에게 보고 후 반영
- 파생 필드(rectified_status, start_status)는 서버 RPC에서 자동 재계산되므로 별도 조치 불필요

## 스코프 외
- 7/22 이후 데이터는 건드리지 않음
- Closure 스테이지는 이번 지시 범위 외 (요청 시 동일 로직 확장 가능)
