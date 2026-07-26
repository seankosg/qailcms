# Aconex Preset — 원본 헤더 전체 노출로 개편

## 목표
현재 Aconex Preset의 "필드 편집" 팝오버는 시스템 sync 필드 8개만 노출한다. 이를 **Header Mapping 탭에 등록된 Aconex 원본 헤더 전체**를 노출하도록 바꾸고, 프리셋 저장 단위도 "원본 헤더 이름" 기준으로 통일한다.

## 현재 vs 목표 (diff 요약)

| 항목 | 현재 | 목표 |
| --- | --- | --- |
| 팝오버 옵션 소스 | `ABD_ACONEX_SYNC_FIELDS` 하드코딩 8개 | `abd_header_mappings` 에서 Aconex 원본으로 등록된 `source_header` 전체 |
| 저장 값(`abd_import_presets.fields`) | 시스템 필드 키 (예: `latest_status`) | 원본 헤더 문자열 (예: `Document No`, `Status`, `Review Status` …) |
| 유니크 키 | 별도 강제 없음 | `Document No` (canonical) 항상 체크 + 잠금 |
| 뱃지 표시 | `getLabel(field)` = 시스템 라벨 | 원본 헤더 그대로 (매핑된 시스템 필드는 서브텍스트로 병기) |
| 임포트 반영 로직 | 프리셋 fields → sync 필드 필터 | 프리셋 헤더 → `ACONEX_HEADER_TO_FIELDS` + 헤더 매핑 lookup → sync 필드 필터 |
| 매핑되지 않은 헤더 | 노출 안 됨 | 노출·선택 가능하나 "이 헤더는 아직 시스템 필드에 매핑되지 않음" 경고 뱃지 표시 |

## 변경 파일

### 1) `src/components/admin/AbdImportPresetTable.tsx`
- `mode === "aconex"` 분기에서 `ABD_ACONEX_SYNC_FIELDS` 대신 `useAbdHeaderMappings()` 결과 사용.
  - `abd_header_mappings` 전체 로우 중 `is_active=true` 이고 Aconex 계열로 판정되는 것만 필터.
  - Aconex 판정 규칙: `target_field` 이 다음 중 하나 → `latest_status`, `latest_rev`, `approval_date`, `aconex_status_raw`, `aconex_review_status_raw`, `aconex_date_modified`, `is_terminated`, `r{n}_dar_actual` (또는 `round_actual`). 추가로 canonical Aconex 헤더(`Document No`, `Revision`, `Status`, `Review Status`, `Date Modified`) 는 매핑이 없어도 노출.
- 팀별(MECH/ELEC/ARCH) 로 동일 `source_header` 가 있을 수 있으므로 `source_header` 기준 dedupe. 여러 시스템 필드에 걸리면 뱃지에 `latest_status, approval_date …` 처럼 나열.
- `fieldOptions` 타입: `{ header: string; targets: string[]; teams: string[]; }`
  - 검색: `header` 및 `targets` 모두 대상.
  - 정렬: `Document No` 상단 고정 → 나머지 알파벳.
- 옵션 리스트에 아래 요소 노출:
  - 라인 1: 원본 헤더 이름 (예: `Status`)
  - 라인 2: `→ Latest Status, Approval Date, …` (매핑된 시스템 필드) 또는 `→ (미매핑 — 임포트 시 무시됨)`
- 저장 스키마는 그대로 유지(`fields: string[]`) — 값 의미만 "원본 헤더"로 전환. 기존 데이터는 마이그레이션 없이 다음 항에서 하위호환 처리.

### 2) 하위호환 (마이그레이션 없음)
- 기존 프리셋의 `fields` 는 시스템 필드 키가 들어있음. 편집 팝오버 진입 시 다음 규칙으로 자동 변환하여 초기 selected 세트를 만든다:
  - 값이 원본 헤더 후보 목록에 있으면 그대로 사용.
  - 값이 시스템 필드 키이면 `ACONEX_HEADER_TO_FIELDS` 역맵 + Header Mapping lookup 으로 대응 헤더로 치환.
- 사용자가 저장(체크박스 토글) 하는 순간부터 새 스키마(원본 헤더)로 덮어써짐.

### 3) `src/components/abd/import/AbdAconexImportPage.tsx`
- `buildPresetHeaders(fileHeaders, presetFields)` 를 수정:
  - `presetFields` 를 "원본 헤더" 로 간주. `canonicalHeader()` 로 정규화 후 파일 헤더와 매칭.
  - 하위호환: presetFields 중 시스템 필드 키가 섞여 있으면 이전 로직으로 매핑 (한 번 열면 정상화됨).
- `Document No` 는 항상 포함 (현행 유지).
- Aconex 임포트 실행 시 실제 sync 필드 필터(`computeApplyFieldsFromHeaders`) 는 현행 그대로 사용.

### 4) 파일 헤더가 없을 때 (Preset 관리 화면)
- 관리 화면에서는 특정 파일이 없으므로 "모든 등록 헤더" 를 그대로 노출. 실제 임포트 시점에는 파일에 없는 헤더는 자동 skip.

## 사이드 이펙트 방지 체크리스트
- [ ] `HDEC Preset` 은 손대지 않는다 (`mode === "hdec"` 분기 unchanged).
- [ ] `abd_import_presets` 테이블 스키마·RLS·GRANT 변경 없음.
- [ ] `ABD_ACONEX_SYNC_FIELDS` export 는 유지 (`AbdAconexImportPage` 가 여전히 sync 필드 키 집합으로 사용).
- [ ] Header Mapping 이 비어 있는 신규 프로젝트를 위해 canonical 5개 헤더는 하드 폴백으로 항상 노출.
- [ ] 팀 필터(MECH/ELEC/ARCH) 는 이번 단계에서는 도입하지 않는다 (요청 범위 밖).

## 수용 기준
1. Admin → Mapping → As Built Drawing → Aconex Preset → "필드 편집" 팝오버에 `Document No / Revision / Status / Review Status / Date Modified` 및 Header Mapping 에 Aconex 대상으로 등록된 모든 원본 헤더가 노출된다.
2. 각 옵션 아래 대응 시스템 필드가 병기된다. 미매핑 헤더는 경고 문구로 표시된다.
3. `Document No` 는 체크 표시 + 잠금(해제 불가) 상태로 항상 포함된다.
4. 기존 프리셋을 열면 이전 선택이 원본 헤더 기준으로 자동 복원되어 표시된다.
5. 임포트 시 프리셋을 클릭하면 파일에 실제 존재하는 헤더만 선택 상태로 매핑되고, 그에 대응하는 sync 필드만 업데이트된다.
