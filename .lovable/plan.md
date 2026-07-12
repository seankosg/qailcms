## 목표
Task Raw Data의 라벨/헤더를 완전 영문화하고, 신규 컬럼 `actual_finish` / `actual_duration`을 추가. 기존 한글 Source Header는 alias로 유지(Option B).

## 1. 신규 컬럼 추가 (DB 스키마)

`task_management_raw` 테이블에 두 컬럼 신설:
- `actual_finish date` — 실제 완료일 (사용자 입력, 편집 가능)
- `actual_duration integer` — 실제 소요일수. 다음 로직으로 자동 계산:
  - `actual_start`와 `actual_finish`가 모두 있으면 `actual_finish - actual_start + 1`
  - `actual_finish`가 없고 `actual_start`만 있으면 `current_date - actual_start + 1` (진행중)
  - `actual_start`가 없으면 null

`task_management_status_history` 트리거(`trg_task_history_fn`)에 두 필드 추가 → 편집 이력 기록.

Parent 롤업 함수(`update_task_summary`)에 `actual_finish = max(child.actual_finish)` 추가. `actual_duration`은 각 row에서 계산되므로 롤업 시 재계산 로직만 반영.

Rollback 함수(`rollback_task_management_import`)에 두 필드의 date/int 캐스팅 케이스 추가.

## 2. 코드 반영

- **`src/lib/task-management/columns.ts` — `TM_COLUMNS`**
  - 모든 `label` 값을 아래 영문 매핑으로 교체.
  - `actual_finish` (A.Finish, date, group: actual, editable date) 신규 추가.
  - `actual_duration` (A.Duration, number, group: actual, 자동 계산 - editable 아님) 신규 추가.
  - `TM_AUTO_CALCULATED`에 `actual_duration` 추가.

  | field_name | 신규 label |
  |---|---|
  | task_no | Task No |
  | level | Tier |
  | discipline | Discipline |
  | team | Team |
  | category | Category |
  | plot | Plot |
  | location | Location |
  | floor_level | Level |
  | task_name | Task |
  | risk | Risk |
  | sub_task_desc | Sub-Task |
  | pic | PIC |
  | row_type | Work Type |
  | status_manual | Status |
  | auto_judgment | Alarm |
  | plan_start | P.Start |
  | plan_end | P.Finish |
  | plan_days | P.Duration |
  | actual_start | A.Start |
  | actual_finish | A.Finish (신규) |
  | actual_duration | A.Duration (신규) |
  | actual_progress | Actual % |
  | plan_progress | Plan % |
  | progress_variance | Variance (%p) |
  | expected_progress_today | T.Plan |
  | today_gap | T.Diff |
  | forecast_end | Revised Finish |
  | slip_days | Slip (days) |
  | data_date | Data Date |
  | source_file | Source File |
  | imported_at | Imported |

- **Excel Import 파서 / 매퍼**: 신규 두 필드도 매핑 대상에 포함되도록 컬럼 목록 기반으로 자동 반영 확인.
- **Bulk Edit / Filters / Export**: `TM_COLUMNS` 기반이므로 자동 반영. 스팟체크만.

## 3. DB 데이터 갱신 (Option B — alias 유지)

### `task_management_field_config`
각 `field_name` row의 `display_name`을 위 표대로 UPDATE.
`actual_finish`, `actual_duration` row는 신규 INSERT (sort_order는 `actual_start` 뒤).

### `task_management_header_mappings` (Option B: alias 유지)
- 기존 한글 `source_header` row는 **삭제/수정하지 않고 그대로 유지** → 과거 한글 Excel 파일도 계속 Import 가능.
- 각 `target_field`에 대해 **영문 신규 매핑 row를 INSERT** (중복 방지: `(module, source_header)` 조합 확인 후 없을 때만):
  - `Discipline`, `Location`, `Level`, `Task`, `Risk`, `Sub-Task`, `PIC`, `Work Type`, `Status`, `Alarm`,
  - `P.Start`, `P.Finish`, `P.Duration`, `A.Start`, `A.Finish`, `A.Duration`,
  - `Actual %`, `Plan %`, `Variance (%p)`, `T.Plan`, `T.Diff`, `Revised Finish`, `Slip (days)`
- 결과: 한 target_field에 한글+영문 두 개의 활성 매핑이 공존. Header Mapping 검증 로직은 `(module, source_header)` unique만 요구하므로 문제없음.

## 4. 롤업 / 자동계산 로직 재점검

- `update_task_summary`: `actual_finish = max(child.actual_finish)` 추가. `actual_duration`은 parent에서 `actual_finish - actual_start + 1`로 재계산.
- `calc_auto_judgment_value`: 기존 로직 유지. `actual_finish` 존재 시 `auto_judgment='완료'` 판정을 강화할지는 후속 논의 (이번 범위에서는 기존 progress 기반 유지).
- 트리거 이력 기록에 신규 두 필드 반영.

## 5. UI 검증

- Task Raw Data 페이지: 신규 A.Finish/A.Duration 컬럼 표시, 라벨 영문화.
- Admin > Field Config: 24개 필드 라벨 갱신 확인, 신규 2개 row 추가 확인.
- Admin > Header Mapping: 한글+영문 alias 공존 확인.
- Excel Import: 영문 헤더 / 한글 헤더 두 종류 모두 매핑 성공하는지 스팟체크.

## 6. 실행 순서 (승인 필요)

1. **Migration 1 (스키마)**: 신규 컬럼 2개 + 트리거/롤업/롤백 함수 갱신.
2. **코드 수정**: `TM_COLUMNS` 라벨/신규 컬럼 반영.
3. **데이터 UPDATE/INSERT**: field_config, header_mappings 갱신 (Option B alias).
4. UI 스팟체크.

## 주의사항

- 신규 `actual_duration`은 계산 필드이므로 사용자 편집 UI에서는 read-only. `actual_finish` 편집 시 즉시 재계산 필요 (client-side 또는 트리거).
- Option B로 한글 alias를 유지하지만, 시스템 표준은 영문. 향후 신규 Excel 템플릿은 영문 헤더 권장.
- `TmFieldConfigTable`의 "Reset to defaults" 버튼은 `TM_COLUMNS`를 기준으로 되돌리므로, 코드 라벨과 DB 라벨이 항상 일치해야 함 → 두 곳을 동일한 값으로 반영.
