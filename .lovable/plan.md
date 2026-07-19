## 원인

SM Raw Data의 `Start Status` 컬럼은 `src/lib/defect-management/columns.ts`에 `derived: true`(파생 컬럼)로만 정의되어 있고, DB `defect_field_config` 테이블에는 행이 존재하지 않습니다. Mapping 화면의 Field Config 탭은 `defect_field_config` 테이블을 소스로 표시하므로 `start_status`만 목록에서 빠져 있습니다.

참고: `rectified_status`, `closure_status`, `updated_status`는 origin='aconex'로 이미 등록되어 있으나 `start_status`는 앱에서 실시간 계산되는 파생값이라 등록되지 않았습니다. Header Mapping(엑셀 별칭)은 원본 헤더가 없으므로 해당 없음 — Field Config에만 노출을 추가하면 됩니다.

## 변경 사항

1. 마이그레이션으로 `defect_field_config`에 `start_status` 행 1건 삽입
   - `field_name`: `start_status`
   - `display_name`: `Start Status`
   - `origin`: `derived` (신규 값; 기존 aconex/hdec와 구분)
   - `source_label`: `Derived`
   - `group_key`: `progress`
   - `sort_order`: 178 근처 (P.Start / A.Start 다음)
   - `is_visible`: `true`

2. `FieldConfigTable`(SM용 `DefectFieldConfigTable.tsx`)에서 `origin='derived'` 행은:
   - Header Mapping 대상으로 선택할 수 없도록 잠금 표시 (파생값은 엑셀 매핑 불가)
   - 라벨/노출/정렬만 편집 허용

3. Header Mapping 화면의 Target Field 드롭다운(`EditableTargetFieldCell`)에서 `origin='derived'` 필드는 제외 — 사용자가 실수로 엑셀 헤더를 파생 필드에 매핑하지 못하도록 방지.

## 검증

- Mapping > Snag List Management > Field Config 탭에서 `Start Status` 행 노출 확인
- Header Mapping 탭 Target Field 드롭다운에는 `start_status` 미노출 확인
- SM Raw Data 페이지에서 Start Status 컬럼 렌더링 회귀 없는지 확인 (파생 계산 로직 변경 없음)
