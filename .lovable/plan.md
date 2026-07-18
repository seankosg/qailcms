## 목적
신규 임포트 로직에 반영된 "상태 전이 → Actual Date 자동 채움" 규칙을 기존 `defect_items_raw` 전체 행에도 일회성으로 소급 적용(backfill)한다.

## 현재 상태 (실측)
- 전체 행: 110,322
- `closure_status = 'Closed'`: 65,812 — 모두 `rectified_status='Rectified'`로 이미 정합 (사용자 승인 백필 완료 상태)
- `actual_closure_date` 누락 Closed 행: 0 (이미 채워짐)
- `actual_rectified_date` 누락 (Closed/Rectified): 65,812 — **미채움**
- `actual_start_date` 누락 (Closed/Rectified): 65,812 — **미채움**
- `rectified_status='In Progress'` & `actual_start_date` 누락: 7,256 — **미채움**
- `last_updated_at` / `data_date`: 모든 행 보유 → 폴백 날짜 확보 가능

## 백필 규칙 (임포트 로직과 1:1 매칭)

우선순위 날짜: `COALESCE(last_updated_at::date, data_date)` (기존 값이 있으면 덮어쓰지 않음)

1. **Closed 진입 소급** (`closure_status='Closed'`):
   - `actual_closure_date` IS NULL → 채움
   - `actual_rectified_date` IS NULL → 채움
   - `actual_start_date` IS NULL → 채움
   - `rectified_status` != 'Rectified' → 'Rectified' 로 강제 (현재 mismatch 0건이지만 안전장치)

2. **Rectified 진입 소급** (`rectified_status='Rectified'` AND `closure_status` != 'Closed'):
   - `actual_rectified_date` IS NULL → 채움
   - `actual_start_date` IS NULL → 채움

3. **In Progress 진입 소급** (`rectified_status='In Progress'`):
   - `actual_start_date` IS NULL → 채움

**보존 원칙**: 기존에 값이 있는 컬럼은 절대 덮어쓰지 않음(임포트 로직과 동일). Re-Opened(파생: Not Started)는 소급 대상 아님.

## 실행 방식
`supabase--insert` 툴로 위 3개 UPDATE 문을 순서대로 실행(단일 트랜잭션 불가하므로 순차, 각각 `WHERE ... IS NULL` 로 idempotent).

Closed → Rectified → In Progress 순서로 실행하여, 상위 단계가 하위 단계의 date를 먼저 채우도록 함.

## 실행 후 검증
동일 카운트 쿼리 재실행하여 다음 확인:
- Closed no_actual_* → 0
- Rectified no_actual_rect / no_actual_start → 0
- InProgress no_actual_start → 0

## 롤백 고려
소급된 날짜는 사용자가 이후 정규 임포트로 실제 값이 들어오면 자연스레 덮어쓰지 못하도록(임포트 로직도 기존 값 보존) — 이 백필 이후 정확한 실제 Actual Date가 필요한 케이스는 원본 소스 재임포트로 갱신 필요. 이 부분 사전 고지.

## 승인 요청
이 규칙 그대로 3개 UPDATE 실행할까요? 아니면 조정 원하시는 부분(예: `last_updated_at` 대신 `data_date` 우선, 특정 프로젝트만 적용 등) 있나요?