# Snag Import 유니크 키(ID/source_issue_no) 시스템 수정 + 관리자 매핑/설정 반영

## 배경

- `defect_items_raw`의 유니크 키는 `source_issue_no` 하나뿐입니다 (`defect_items_raw_source_issue_no_key`).
- 두 원본 파일에서 `ID`/`id`의 의미가 다릅니다.
  - LetsBuild 원본(`7days_snagging_6333.xlsx`): 첫 컬럼 `ID`(예: 113663) → LetsBuild Issue No., 즉 `source_issue_no`
  - 시스템 재수출(`snag-raw-data-...v5-3.xlsx`): 첫 컬럼 `id`(UUID), 두 번째 컬럼 `source_issue_no`. `id`는 절대 유니크 키가 아님
- 현재 `defect_header_mappings`는 `ID → source_issue_no`, `source_issue_no → source_issue_no` 두 매핑이 활성 상태.
- 현재 파서(`src/lib/defect-management/parser.ts`)는 안전을 위해 `source_issue_no` 대상에 대해 `id` alias를 무조건 무시. 그 결과 LetsBuild 원본 `ID`가 매핑되지 않아 `필수 헤더 누락: ID` 및 "행을 찾지 못했습니다" 오류 발생.
- 이번에는 도움말/문구가 아니라 파서·업서트·관리자 매핑까지 전 계층에서 시스템적으로 UUID 오염을 차단하고 LetsBuild `ID`만 키로 인식하도록 수정합니다.

## 수정 원칙

`ID`/`id` 텍스트만 보고 판단하지 않고, 파일 형태 + 헤더 조합 + 값 형식으로 판정.

1. `source_issue_no` 헤더가 있으면 항상 그것을 유니크 키로 사용.
2. `source_issue_no`가 없고 LetsBuild 원본 25컬럼 형태이면 `ID`를 `source_issue_no`로 승격.
3. 재수출 파일(`QAIL_DEFECT_REIMPORT_V1` 마커 존재 또는 `source_issue_no` 헤더 존재)에서는 `id`/`ID` alias를 완전 무시.
4. 사용자가 UUID `id`를 `source_issue_no`로 강제 매핑해도 파서 단계에서 차단.
5. 업서트 직전에도 `source_issue_no` 값이 UUID 형식이면 해당 행을 reject.
6. 관리자 매핑/설정 화면에서도 동일 규칙이 눈에 보이고, 잘못된 매핑을 저장하지 못하도록 검증.

## 구현 계획

### 1. 파서 유니크 키 전용 resolver 추가

수정 파일: `src/lib/defect-management/parser.ts`

- `resolveSourceIssueNoColumn()`을 신설해 `source_issue_no` 대상에는 이것만 사용.
  - 우선순위: `source_issue_no` 헤더 → LetsBuild 원본 형태 검증 후 `ID`/`id` 헤더 → 없음.
  - LetsBuild 원본 형태 검증: `source_issue_no` 헤더 부재 + `QAIL_DEFECT_REIMPORT_V1` 마커 부재 + 원본 시그니처 헤더 다수 존재(`Location`, `PlanTitle`, `PlanGroup`, `Category`, `CreatedDate` 등 중 3개 이상).
  - 후보 컬럼의 첫 데이터 샘플이 UUID 형식이면 후보에서 제외.
- 일반 `resolveColumn()`은 `source_issue_no`에 대해 호출하지 않음(전용 resolver로 대체).
- `columnOverrides.source_issue_no`가 넘어와도 위 검증(재수출 파일에서 `id` UUID 컬럼 지정 여부, 샘플 UUID 여부)을 통과할 때만 허용.
- 파서 반환 결과에 `sourceKeyOrigin: "source_issue_no" | "letsbuild_id" | null` 를 추가하여 UI/로그에서 어떤 컬럼이 키로 쓰였는지 명확히 노출.

### 2. `toDefectFieldName` 확장

수정 파일: `src/lib/defect-management/parser.ts`

- 정규화된 헤더가 `id`일 때 무조건 빈 문자열을 반환하지 않고, 파일 컨텍스트가 LetsBuild 원본이면 `source_issue_no`로 반환하도록 옵션 인자 추가.
- 재수출 파일 컨텍스트에서는 기존 동작 유지(빈 문자열).

### 3. 업서트 직전 UUID reject 방어선

수정 파일: `src/contexts/DefectManagementImportContext.tsx`

- `deduped` → `workingRows` 사이에 `source_issue_no`가 UUID 형식인 행을 걸러 별도 배열로 이동.
- 걸러진 행은 `defect_import_row_logs`에 `action_taken: "rejected"`와 사유("UUID key detected")로 기록.
- 파일 카드 결과에 "UUID 키 감지로 제외된 행 수" 표시.

### 4. 관리자 Header Mapping 반영

수정 파일: `src/components/admin/DefectHeaderMappingTable.tsx`, `src/hooks/useDefectHeaderMappings.ts`

- `target_field === "source_issue_no"`인 매핑에 대해 다음을 강제.
  - 허용 `source_header`: `ID`, `source_issue_no`.
  - 그 외 텍스트(예: 그냥 `id` 소문자만 등록해도 UUID와 혼동 여지가 있으므로) 저장 시 확인 다이얼로그 표시 후 저장.
  - 시스템 시드 매핑(`ID → source_issue_no`, `source_issue_no → source_issue_no`)은 UI에서 "시스템 필수"로 표시하고 삭제 시 확인 강화.
- 저장 API 호출 전 클라이언트 측 검증 함수 `validateSourceIssueNoMapping(sourceHeader)`를 `src/lib/admin/header-mapping-validation.ts`(기존 파일)에 추가.
- 잘못된 저장이 되지 않도록 UI 오류 메시지: "source_issue_no에는 LetsBuild의 ID 또는 source_issue_no 헤더만 매핑할 수 있습니다."

### 5. Header Mapping DB 정합성 마이그레이션

`supabase--migration` 사용.

- 활성 매핑 중 `target_field='source_issue_no'`인데 `source_header`의 정규화값이 `id`/`sourceissueno` 외인 항목을 비활성화.
- LetsBuild 원본 시그니처를 안정적으로 지원하기 위한 시드 보강.
  - `('ID','source_issue_no', active)` 존재 보장.
  - `('source_issue_no','source_issue_no', active)` 존재 보장.
- 부작용 방지: 이번 마이그레이션은 데이터 삭제 없이 활성화 플래그만 조정(비활성). 필요 시 사용자가 관리자 화면에서 재활성 가능.

### 6. Field Config 반영

수정 파일: `src/components/admin/DefectFieldConfigTable.tsx`, `src/hooks/useDefectFieldConfig.ts`

- `source_issue_no`가 이미 "시스템 필수"로 처리되고 있으므로 라벨/툴팁을 명확화:
  - 라벨 옆에 뱃지 "Unique Key (LetsBuild ID)" 표시.
  - 숨김 토글/삭제 UI 비활성.
- 시스템 UUID `id` 컬럼은 Raw Data용 시스템 컬럼이므로 Field Config 편집 대상에서 제외되도록 목록 필터를 명시적으로 추가(현재 존재하지 않으면 no-op).

### 7. Column Select 다이얼로그 반영

수정 파일: `src/components/defect-management/import/DefectColumnSelect.tsx`

- 파서에서 넘어온 `sourceKeyOrigin`과 후보 UUID 감지 결과를 이용해:
  - `source_issue_no`로 매핑될 컬럼을 상단에 강조 표시.
  - 사용자가 재수출 파일의 UUID `id`를 강제로 `source_issue_no`에 지정하려 하면 disable + 이유 툴팁 표시.
  - LetsBuild 원본에서는 `ID` 컬럼이 자동으로 `source_issue_no`에 배정된 상태로 표시.

### 8. 검증

- `7days_snagging_6333.xlsx` 업로드 → `필수 헤더 누락: ID` 사라짐, 첫 행 키 `113663`.
- `snag-raw-data-...v5-3.xlsx` 업로드 → `id`(UUID) 무시, 키는 `100000`.
- 두 파일 병행 업로드 시 `source_issue_no` 기준 dedupe 정상.
- 관리자 Header Mapping에서 `source_issue_no` 타겟에 임의 문자열 저장 시도 시 오류.
- Header Mapping DB 마이그레이션 후 잘못된 활성 매핑 없음 재확인.
- `tsgo` 통과 및 Playwright로 Import 화면 회귀.

## 변경 파일 요약

- `src/lib/defect-management/parser.ts`: 전용 resolver, UUID 감지, sourceKeyOrigin 반환.
- `src/contexts/DefectManagementImportContext.tsx`: 업서트 직전 UUID reject.
- `src/lib/admin/header-mapping-validation.ts`: `source_issue_no` 매핑 검증.
- `src/components/admin/DefectHeaderMappingTable.tsx`: 저장 전 검증 + 시스템 필수 표시.
- `src/components/admin/DefectFieldConfigTable.tsx`, `src/hooks/useDefectFieldConfig.ts`: `source_issue_no` 뱃지 및 편집 잠금 강화.
- `src/components/defect-management/import/DefectColumnSelect.tsx`: UUID 컬럼 지정 차단 UI.
- 마이그레이션 1건: `defect_header_mappings` 잘못된 `source_issue_no` 매핑 비활성 + 표준 시드 보강.

## 하지 않는 것

- `defect_items_raw`의 기존 데이터 자동 수정 없음. UUID로 저장된 오염 행이 발견되면 별도 승인 후 처리.
- ABD/Task/Spare Part 임포트에는 변경 없음(이번 요청은 Snag 범위).
