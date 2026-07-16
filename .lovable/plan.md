## 목표
Snag Raw Data에서 나가는 두 종류의 XLSX Export 파일을 모두 별도 가공 없이 Snag List Management Import에 재사용할 수 있게 파서 별칭을 확장한다.

- 파일 A (Raw DB 컬럼 export): 헤더가 `snake_case` (예: `source_issue_no`, `status_raw`, `plan_title`)
- 파일 B (View export): 헤더가 사람이 읽는 라벨 (예: `Area Type`, `HDEC Verification`, `Planned Start`)

파서 코드는 수정하지 않고, `defect_header_mappings` 테이블에 별칭 행을 추가하는 데이터 변경만 수행한다. 이 테이블 값은 파서의 `extraAliases`로 주입되어 `normalizeHeader`(공백 제거 + 소문자) 규칙으로 매칭된다.

## 배경
- `normalizeHeader`는 공백만 제거하고 언더스코어는 유지한다. 그래서
  - snake_case 헤더 `area_type` → 정규화 `area_type` (canonical/EXTRA 키와 불일치)
  - 라벨 헤더 `Area Type` → 정규화 `areatype` (역시 EXTRA `area_type`와 불일치)
- 파서 코드(`parser.ts`)에 손대지 않고, DB `defect_header_mappings.source_header`를 두 표기 모두 등록하면 파서가 자동으로 매핑한다.

## 변경 내용

### 1) `defect_header_mappings`에 별칭 행 추가 (`supabase--insert`)
공통 속성: `module = 'defect-management'`, `is_custom = true`, `is_active = true`. 중복 방지를 위해 `ON CONFLICT (module, source_header) DO NOTHING`.

**A. snake_case DB 컬럼용 (파일 A 대응, 23행)**

| source_header | target_field |
|---|---|
| source_issue_no | source_issue_no |
| status_raw | status_raw |
| location_raw | location_raw |
| defect_type | defect_type |
| assigned_to | assigned_to |
| due_by | due_by |
| level_name | level_name |
| plan_group | plan_group |
| plan_title | plan_title |
| room_group | room_group |
| updated_by | updated_by_name |
| podium_area | podium_area |
| review_flag | review_flag |
| created_date | created_date |
| created_by_name | created_by_name |
| created_by_team_name | created_by_team_name |
| defect_location | defect_location |
| last_updated_at | last_updated_at |
| updated_status | updated_status |
| updated_by_name | updated_by_name |
| updated_date_raw | updated_date_raw |
| location_reference | location_reference |
| updated_description | updated_description |

**B. View 라벨용 (파일 B 대응, 20행)**

| source_header | target_field |
|---|---|
| HDEC Verification | hdec_verification |
| HDEC Reason | hdec_reason |
| HDEC Comments | hdec_comments |
| HDEC PIC | hdec_pic_name |
| HDEC ENG | hdec_eng_name |
| Area Type | area_type |
| Area Level | area_level |
| Area Location | area_location |
| Subcontractor | subcontractor_name |
| Sub-Sub | subsub_name |
| Created Team | created_by_team_name |
| Planned Start | planned_start_date |
| Actual Start | actual_start_date |
| Planned Completion | planned_completion_date |
| Actual Completion | actual_completion_date |
| Completion Status | completion_status |
| Planned Closure | planned_closure_date |
| Actual Closure | actual_closure_date |
| Closure Status | closure_status |
| Planned Progress % | planned_progress_pct |
| Actual Progress % | actual_progress_pct |
| Updated Date (Raw) | updated_date_raw |
| Data Date | data_date |

### 2) `id` 헤더 충돌 관련
파일 A는 `id`(행 UUID)와 `source_issue_no`가 동시에 존재하며 기존 canonical 규칙상 `id`가 `source_issue_no`로 매핑돼 값이 잘못 들어갈 위험이 있다. 이 스코프에서는 별칭만 추가하고, 사용자에게 임포트 시 Column Select Dialog에서 `id` 헤더를 수동으로 제외하도록 안내한다. 파서 우선순위 조정은 별도 작업으로 남긴다.

## 스코프 밖
- 파서 코드(`parser.ts`) 수정
- Export 파일 포맷 재정비, REIMPORT 마커 자동 삽입
- 파서가 알지 못하는 순수 파생/시스템 컬럼(`Start Status`, `Trade Detail`, `Defect Element`, `Captured By`, `Classification Source`, `Subcon Issue No`, `Critical`, `is_active`, `raw_payload`, `created_at`, `updated_at` 등)의 매핑 — 임포트 대상 아님

## 검증
- 마이그레이션 후 Import 화면에서 파일 A, 파일 B 각각 업로드 → Column Select Dialog에서 위 별칭 대상 헤더가 각 target field로 표시되는지 확인.
- `id` 헤더가 `source_issue_no`로 표시되면 사용자에게 제외를 안내한다.
