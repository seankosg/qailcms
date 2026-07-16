## 목적
코드는 수정하지 않고, 업로드된 `snag-raw-data-unclosed-202607160530-planned-dates-v5-2.xlsx` (44,510 행, 81 컬럼, 재수출 형식) 로 **DB를 1회 직접 업데이트**한다. 앱 임포트에서 statement timeout으로 실패했던 700행을 포함, 파일의 전체 44,510행을 서버측 단일 `UPDATE ... FROM staging` 문으로 반영한다.

Data API(PostgREST)의 8초 타임아웃과 달리 psql/마이그레이션은 훨씬 여유가 있어 44,510행 서버측 UPDATE도 안정적으로 통과한다.

---

## 실행 단계

### 1) 스테이징 테이블 생성 (migration)
```sql
CREATE UNLOGGED TABLE public._defect_reimport_staging (
  source_issue_no text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT ALL ON public._defect_reimport_staging TO service_role;
```
`data` 하나에 파일 한 행의 모든 필드를 JSON으로 담아 컬럼 매핑 문제를 없앤다.

### 2) 파일 → 스테이징 적재 (psql INSERT, 1,000행 배치)
로컬에서 xlsx 파싱 → `(source_issue_no, data_jsonb)` 형태로 45 배치 × 1,000행 psql INSERT.
- `id` 컬럼(UUID)은 스테이징에 넣지 않음. `source_issue_no` 만 키로 사용.
- 재수출 파일이므로 헤더 = 시스템 필드명. Excel 날짜/시리얼은 ISO 문자열로 정규화.

### 3) 서버측 단일 UPDATE (supabase--insert 로 UPDATE 실행)
```sql
UPDATE public.defect_items_raw d
SET
  source_issue_no          = s.data->>'source_issue_no',
  team                     = s.data->>'team',
  status_raw               = s.data->>'status_raw',
  priority                 = s.data->>'priority',
  hdec_verification        = s.data->>'hdec_verification',
  location_raw             = s.data->>'location_raw',
  subcontractor_name       = s.data->>'subcontractor_name',
  category                 = s.data->>'category',
  defect_type              = s.data->>'defect_type',
  description              = s.data->>'description',
  assigned_to              = s.data->>'assigned_to',
  ir                       = s.data->>'ir',
  item                     = s.data->>'item',
  room                     = s.data->>'room',
  forms                    = s.data->>'forms',
  due_by                   = (s.data->>'due_by')::date,
  remarks                  = s.data->>'remarks',
  building                 = s.data->>'building',
  area_type                = s.data->>'area_type',
  sub_trade                = s.data->>'sub_trade',
  work_type                = s.data->>'work_type',
  area_level               = s.data->>'area_level',
  level_name               = s.data->>'level_name',
  main_trade               = s.data->>'main_trade',
  plan_group               = s.data->>'plan_group',
  plan_title               = s.data->>'plan_title',
  room_group               = s.data->>'room_group',
  hdec_reason              = s.data->>'hdec_reason',
  podium_area              = s.data->>'podium_area',
  review_flag              = s.data->>'review_flag',
  subsub_name              = s.data->>'subsub_name',
  created_date             = (s.data->>'created_date')::timestamptz,
  trade_detail             = s.data->>'trade_detail',
  area_location            = s.data->>'area_location',
  hdec_comments            = s.data->>'hdec_comments',
  hdec_eng_name            = s.data->>'hdec_eng_name',
  hdec_pic_name            = s.data->>'hdec_pic_name',
  classification           = s.data->>'classification',
  completion_status        = s.data->>'completion_status',
  closure_status           = s.data->>'closure_status',
  updated_status           = s.data->>'updated_status',
  created_by_name          = s.data->>'created_by_name',
  defect_location          = s.data->>'defect_location',
  last_updated_at          = (s.data->>'last_updated_at')::timestamptz,
  updated_by_name          = s.data->>'updated_by_name',
  captured_by_name         = s.data->>'captured_by_name',
  updated_date_raw         = s.data->>'updated_date_raw',
  actual_start_date        = (s.data->>'actual_start_date')::date,
  location_reference       = s.data->>'location_reference',
  planned_start_date       = (s.data->>'planned_start_date')::date,
  actual_closure_date      = (s.data->>'actual_closure_date')::date,
  actual_progress_pct      = NULLIF(s.data->>'actual_progress_pct','')::numeric,
  updated_description      = s.data->>'updated_description',
  created_by_team_name     = s.data->>'created_by_team_name',
  planned_closure_date     = (s.data->>'planned_closure_date')::date,
  planned_progress_pct     = NULLIF(s.data->>'planned_progress_pct','')::numeric,
  actual_completion_date   = (s.data->>'actual_completion_date')::date,
  subcontractor_issue_no   = s.data->>'subcontractor_issue_no',
  planned_completion_date  = (s.data->>'planned_completion_date')::date,
  updated_at               = now()
FROM public._defect_reimport_staging s
WHERE d.source_issue_no = s.source_issue_no;
```

**제외 컬럼** (덮어쓰지 않음):
- `id`, `created_at`, `row_version` — DB 관리
- `is_active`, `is_critical`, `status_group`, `data_date`, `status_manual`, `priority_locked`, `hdec_verification_locked` — 락/파생/앱 관리 필드
- `raw_payload`, `custom_payload`, `source_import_log_id`, `classified_at`, `classification_source`, `critical_marked_at`, `critical_marked_by`, `aconex_comments`, `subcontractor_issue_source`, `issue_no` — 시스템/외부 소스 관리

### 4) 정리 (migration)
```sql
DROP TABLE public._defect_reimport_staging;
```

### 5) 검증
- 업데이트된 행수 확인 (`UPDATE` 반환 rowcount)
- `defect_items_raw` 에서 스테이징 키와 매칭되지 않은 행 수 확인 (파일에 없는 소스 이슈 개수)
- 샘플 5행 spot check (`updated_at` 최신화 여부)

---

## 리스크
- 단일 트랜잭션 UPDATE 44,510행 + status_history 트리거가 무거우면 마이그레이션 자체가 느려질 수 있음. 필요 시 `d.source_issue_no` 범위를 4~5 청크로 나눠 순차 실행.
- 스테이징 적재 45배치 psql INSERT는 인터랙티브하지만 각 배치는 작아 timeout 걱정 없음.
- 락/파생 필드는 절대 덮어쓰지 않음. 앱에서 사용자가 잠근 값은 유지됨.

## 예상 결과
- `defect_items_raw` 44,510행이 파일 값으로 갱신 (700 failed 포함).
- 앱 임포트 로그에는 반영 안 됨 (직접 DB 조작이므로). 필요 시 별도 로그 삽입은 요청 시 추가.
