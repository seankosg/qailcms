## 목표

SM 규칙 보강: `status_raw`가 `rectified` (동등 값: `complete`, `completed` 포함)인 항목은
- Start 스테이지가 무조건 `Done` 으로 표시/집계되어야 함
- `rectified_status`도 무조건 `Rectified` 로 표시/집계되어야 함

Closed/Verified는 이미 rectified 후행이므로 동일 규칙을 함께 적용(기존 로직과 일관).

## 현재 상태 vs 목표

| 항목 | 현재 | 목표 |
|---|---|---|
| DB RPC `_start_status_expr` (search / search_ids / facets) | `actual_*` 날짜/진도만 검사 → `status_raw=rectified`이고 actual_start_date 비어있으면 `Delay/Planned`로 뜸 | `status_raw ∈ {rectified, complete, completed, closed, verified}` 이면 즉시 `Done` |
| 클라이언트 `stage-utils.isStageDone('start')` (`DefectStageProgress` pip, matrix classify 등) | `actual_*` 기반만 | 동일하게 `status_raw` 완료계열이면 `true` |
| 클라이언트 `derived.ts isStartDone` (rectified_status 파생 시 사용) | `actual_*` 기반만 | 동일하게 `status_raw` 완료계열이면 `true` |
| `deriveRectifiedStatus` | `rectified/complete/completed/closed/verified` → `Rectified` (이미 OK) | 변경 없음 |
| 저장된 기존 행 (`defect_items_raw.rectified_status`) | 과거 임포트 시 규칙 이전이면 `Not finish yet` 등으로 남아 있을 수 있음 | 1회 마이그레이션으로 `status_raw`가 완료계열이면 `rectified_status='Rectified'` 로 일괄 UPDATE |

## 변경 사항

### 1) DB 마이그레이션 (신규 파일)

`_start_status_expr` 를 아래 형태로 교체하여 3개 RPC (`defect_items_search`, `defect_items_search_ids`, `defect_items_facets`) 모두 재정의:

```text
CASE
  WHEN lower(trim(status_raw)) IN
       ('rectified','complete','completed','closed','verified')
       THEN 'Done'
  WHEN actual_start_date IS NOT NULL
       OR COALESCE(actual_progress_pct,0) > 0
       OR actual_rectified_date IS NOT NULL
       OR actual_closure_date IS NOT NULL
       THEN 'Done'
  WHEN planned_start_date IS NOT NULL
       AND planned_start_date <= (now() at time zone 'Asia/Qatar')::date
       THEN 'Delay'
  WHEN planned_start_date IS NOT NULL THEN 'Planned'
  ELSE NULL
END
```

동일 마이그레이션에서 저장값 백필:

```sql
UPDATE public.defect_items_raw
   SET rectified_status = 'Rectified'
 WHERE lower(trim(status_raw)) IN
       ('rectified','complete','completed','closed','verified')
   AND (rectified_status IS DISTINCT FROM 'Rectified');
```

### 2) `src/lib/defect-management/stage-utils.ts`

`isStageDone(row,'start')` 상단에 `status_raw` 완료계열이면 즉시 true 반환.

### 3) `src/lib/defect-management/derived.ts`

`isStartDone(row)` 에도 동일 완료계열 조기 반환 추가. 결과적으로 rectified 원본은 항상 `Rectified` 로 파생되며 (기존 로직 유지) Start 스테이지 판정도 Done으로 이어짐.

## 영향 범위

- Raw Data의 Start Status 컬럼(서버 정렬/필터/facet 카운트 포함) 즉시 반영.
- Progress 매트릭스 Start Stage 집계(Cum Actual, Done, Progress) 자동 반영.
- `DefectStageProgress` 3-pip UI에서 Start pip이 Done(초록)으로 표시.
- 자동판별 없이 원본 `status_raw` 값은 그대로 유지(사용자 확인 규칙 준수). 파생/저장 컬럼만 갱신.

## 검증

1. `status_raw='rectified'` 이고 `actual_start_date IS NULL` 인 샘플 몇 건을 SQL로 조회 → 마이그레이션 이후 `rectified_status='Rectified'` 확인.
2. Raw Data에서 Start Status 필터로 `Done` 선택 시 위 항목 포함되는지 확인.
3. Progress 매트릭스 해당 Plot/팀의 Start Cum Actual 이 증가하는지 확인.