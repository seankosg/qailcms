## 소스파일 필드 파싱 재점검 결과

업로드하신 `260711_MECH_Snagging_PLOT-C_D-2.xlsx` 의 Sheet1 헤더 25개를 XLSX XML에서 직접 읽어 현재 파서(`src/lib/defect-management/parser.ts`) 매핑과 1:1 대조했습니다.

### 매핑 대조표 (소스 헤더 → canonical field → DB 컬럼)

| # | Excel 헤더 | canonical field | DB 컬럼 | 상태 |
|---|---|---|---|---|
| 1 | `ID` | source_issue_no | source_issue_no | ✓ |
| 2 | `Location` | location_raw | location_raw | ✓ |
| 3 | `PlanTitle` | plan_title | plan_title | ✓ |
| 4 | `PlanGroup` | plan_group | plan_group | ✓ |
| 5 | `Status` | status_raw | status_raw | ✓ |
| 6 | `AssignedTo` | assigned_to | assigned_to | ✓ |
| 7 | `Category` | category | category | ✓ |
| 8 | `Type` | defect_type | defect_type | ✓ |
| 9 | `Item` | item | item | ✓ |
| 10 | `Description` | description | description | ✓ |
| 11 | `Priority` | priority | priority | ✓ (locked 로직 존재) |
| 12 | `DueBy` | due_by | due_by (date) | ✓ toIsoDate |
| 13 | `CreatedBy` | created_by_name | created_by_name | ✓ |
| 14 | `CreatedByTeamName` | created_by_team_name | created_by_team_name | ✓ |
| 15 | `CreatedDate` | created_date | created_date (timestamptz) | ✓ toIsoDateTime |
| 16 | `IR` | ir | ir | ✓ |
| 17 | `Forms` | forms | forms | ✓ |
| 18 | `LastUpdated` | last_updated_at | last_updated_at (timestamptz) | ✓ toIsoDateTime |
| 19 | `UpdatedDescription` | updated_description | updated_description | ✓ |
| 20 | `UpdatedBy` | updated_by_name | updated_by_name | ✓ |
| 21 | `UpdatedStatus` | updated_status | updated_status | ✓ |
| 22 | `UpdatedDate` | updated_date_raw | updated_date_raw (timestamptz) | ✓ toIsoDateTime |
| 23 | `LocationReference` | location_reference | location_reference | ✓ |
| 24 | `Classification` | classification | classification | ✓ |
| 25 | `Podium area` | podium_area | podium_area | ✓ (공백은 `normalizeHeader` 에서 제거 → `podiumarea` 매핑) |

**결론: 25개 소스 헤더 전부가 canonical field 로 매핑되고, upsert payload 에 실제 값이 채워지고 있습니다.** 추가 안전망으로 파서는 `raw_payload` (jsonb) 에 25개 헤더의 원시 값을 그대로 저장하므로, 향후 매핑되지 않은 헤더가 새로 등장해도 DB 에는 항상 원본이 보존됩니다.

### 함께 확인한 견고성

- `normalizeHeader` 가 대소문자/공백을 제거하므로 `PODIUM AREA`, `Podium Area`, `podium_area`, `Podium  area` 등 표기 변형도 모두 `podiumarea` 로 정규화되어 매핑됩니다.
- 날짜 필드(4개)는 Excel 시리얼(예: `45539.5902829051`) 도 `XLSX.SSF.parse_date_code` 로 UTC ISO 로 변환됩니다.
- `defect_header_mappings` 테이블에 사용자 정의 alias 를 넣으면 `extraAliases` 로 반영되어 위 25개와 다른 헤더 이름도 자동 매핑됩니다.
- Re-import 파일(`QAIL_DEFECT_REIMPORT_V1` 마커 포함)에서 등장하는 확장 필드 26종(team / area_type / area_level / area_location / main_trade / sub_trade / work_type / subcontractor_name / subsub_name / hdec_pic_name / hdec_eng_name / hdec_verification / hdec_reason / hdec_comments / planned_* / actual_* / progress_pct / completion_status / closure_status / remarks / data_date) 도 `EXTRA_REIMPORT_FIELDS` 를 통해 파싱됩니다.

### 최종 판정

**코드 변경 필요 없음.** 현재 파서는 이 샘플 파일의 25개 컬럼을 모두 파싱하고 있으며, 임포트 시 `defect_items_raw` 의 대응 컬럼(+ `raw_payload` jsonb)에 값이 저장됩니다. 이번 점검에서 누락된 필드는 발견되지 않았습니다.

### 선택 옵션 — 안심 강화 (진행 여부 확인)

원하시면 아래 두 가지 가시성 개선을 추가로 진행하겠습니다. 지시가 없으면 이번에는 코드를 건드리지 않고 위 재점검 보고로 마감합니다.

- **옵션 1. Column Select Dialog 에 "Mapped/Unmapped/Unknown" 배지 카운터 요약**
  다이얼로그 상단에 `매핑됨 25/25 · 확장 0 · 미매핑 0` 처럼 총합을 표시하여 새 파일마다 커버리지를 한눈에 확인.
- **옵션 2. 임포트 완료 요약에 "파싱된 필드 수" 명시**
  `defect_import_logs` 요약 카드에 이 임포트에서 실제로 값이 채워진 필드 수(비어있지 않은 컬럼 수)를 표시.

둘 다 진행할지, 하나만 할지, 아니면 재점검 보고만으로 마감할지 알려주세요.