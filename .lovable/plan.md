## 목표
TM 임포트 시 Sub Task의 `plan_days`, `plan_progress`, `progress_variance`, `slip_days`를 서버에서 즉시 계산하여 DB에 저장한다. 기존 Sub 데이터도 동일 기준으로 1회 일괄 재계산한다.

## 계산 정의 (Sub 태스크 기준)
- `plan_days = plan_end - plan_start + 1` (둘 다 있을 때, 없으면 NULL)
- `plan_progress = T.Plan` = `clamp((data_date - plan_start + 1) / plan_days, 0, 1)`
  - `data_date < plan_start` → 0
  - `data_date >= plan_end` → 1
- `progress_variance = actual_progress - plan_progress`
- `slip_days`:
  - 완료(`actual_progress >= 0.999`): `max(0, actual_finish - plan_end)`
  - 미완료: `max(0, data_date - plan_end)` (아직 plan_end 이전이면 0)

## 실행 순서

### 1. DB 함수/트리거 (마이그레이션)
- `calc_sub_task_derived(row)` SQL 함수 신설: 위 4개 필드 계산 반환
- `BEFORE INSERT/UPDATE` 트리거를 `task_management_raw`에 부착하여 `level='sub'`이고 관련 원본 컬럼(`plan_start`, `plan_end`, `data_date`, `actual_progress`, `actual_finish`)이 바뀔 때 자동 채움
- 트리거 순서: Sub 파생 계산 → 기존 `actual_duration` 트리거 → 저장 → AFTER 트리거로 Main 롤업(`update_task_summary`) 유지
- Main 롤업은 Sub의 새로 채워진 값을 그대로 가중 평균하도록 확인/조정

### 2. 임포트 파이프라인
- `TaskManagementImportContext.tsx`에서 Sub의 위 4개 필드에 대한 `null` 강제 초기화 제거 → DB 트리거가 계산하도록 위임
- 파서(`parser.ts`)에서는 원본 엑셀 값이 있어도 무시하고 계산값이 우선되도록 유지 (수동 값 덮어쓰기 방지 옵션은 없음, 1-(a) 정책에 따름)

### 3. 기존 데이터 1회 재계산
- 마이그레이션 말미에 `UPDATE task_management_raw SET plan_start = plan_start WHERE level='sub'` 형태로 트리거 강제 재실행, 또는 전용 `recalc_all_sub_derived()` 함수 실행
- 이후 Main 롤업 `update_task_summary` 전체 재실행하여 상위 값 재정렬

### 4. 검증
- 랜덤 20건 Sub Task 샘플링하여 계산식 수동 검증
- Main Task 5건에서 Sub 값 가중 평균이 Main의 `plan_progress`/`progress_variance`와 일치하는지 확인
- 기존 대시보드/S-Curve/지연 리더보드 수치가 재계산 전후로 큰 왜곡 없는지 스팟체크

## 알려진 트레이드오프 (1-(a) 채택 결과)
- 임포트 시간 증가 (Sub 1,100+ 건 트리거 실행)
- Sub의 수동 편집값이 원본 컬럼 변경 시 자동 재계산으로 덮임 → 정책상 허용
- Main 롤업이 Sub 저장마다 실행되어 부하 증가 (기존 구조 유지, 배치 완료 후 일괄 롤업 최적화는 별도 이슈)

## 롤백 계획
- 트리거/함수 DROP 마이그레이션 준비
- 임포트 컨텍스트의 `null` 초기화 라인은 주석 처리 형태로 복원 가능하게 커밋 분리
