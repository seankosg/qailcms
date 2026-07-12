## 목표

Admin → Mapping의 **Header Mapping** 표(Spare Part / Task Management 양쪽)에서 `Source Header` 값을 직접 수정할 수 있게 하고, 저장 시 정규화·중복·연관 로직 오류를 재점검하여 문제 발생 시 경고를 표시한다.

## 적용 대상

- `src/components/admin/HeaderMappingTable.tsx` (Spare Part)
- `src/components/admin/TmHeaderMappingTable.tsx` (Task Management)

두 컴포넌트가 거의 동일한 구조라, 편집/검증 로직을 담은 공통 훅 `useSourceHeaderEditor`(신규, `src/hooks/`)로 뽑아 재사용한다. 각 테이블은 훅에 `table` 이름(`spare_part_header_mappings` / `task_management_header_mappings`) 및 `queryKey`, 현재 `rows`, `me` 만 넘긴다.

## UX

- 각 행의 Source Header 셀 우측에 연필 아이콘 버튼 → 클릭 시 그 행이 편집 모드로 전환(같은 셀에 `Input` + 저장/취소 버튼).
- Enter = 저장, Esc = 취소.
- 저장 성공 시 sonner `toast.success`, 검증 실패 시 `toast.error`(차단), 위험 조건은 `toast.warning`으로 계속 표시.
- System 매핑(`is_custom=false`)도 편집 허용하되, 편집 모드 진입 시 상단에 `Alert` 형태 배너("시스템 매핑입니다. 시드/재배포 시 값이 되돌아갈 수 있습니다.") 표시. 답변 반영.

## 저장 시 검증 (순서대로)

1. **필수/형식**: `trim()` 후 빈 문자열 금지 → 차단.
2. **변경 없음**: 정규화 결과가 원래 값과 동일하면 no-op으로 종료.
3. **중복 차단**: 같은 `module` 내 자기 자신(id) 제외 후 `normalizeHeader(source_header)`가 동일한 행이 존재하면 저장 거부. 토스트에 충돌한 대상 필드(target_field)를 함께 표기. 답변 반영.
4. **경고(비차단)**:
   - target_field가 현재 `useTaskManagementFieldConfig`/`useSparePartFieldConfig`의 활성 필드 목록에 없으면 `toast.warning("대상 필드 비활성/누락 — 매칭되어도 Import 시 무시될 수 있음")`.
   - 정규화 결과가 원문과 다르면(공백/개행 정리로 값이 실제로 달라진 경우) 정보성 안내 배지 표시.
5. **DB 업데이트**: `.update({ source_header: trimmed, updated_by: me.id })`. 오류 시 `toast.error(error.message)`.
6. **후속 동기화**:
   - `queryClient.invalidateQueries` — 해당 mapping 쿼리키 + Import 관련 프리뷰/매칭 관련 쿼리키(`spare-part-header-mappings`, `task-management-header-mappings`). Import Parser는 실행 시점에 매핑을 다시 읽어오므로 별도 마이그레이션 불필요.
   - `refetch()`로 즉시 반영.
   - 페이지 하단 **Mapping Test** 박스 값이 있으면 자동 재평가(useMemo 재실행되므로 별도 코드 없이 rows 갱신만으로 동작).

## "연관된 로직" 재점검 범위

Source Header는 Excel Import 시 `normalizeHeader(excel셀) === normalizeHeader(mapping.source_header)` 매칭에만 사용된다(파서 `src/lib/spare-part-import-parser.ts`, Task Management 파서). 따라서:

- 기존에 이 매핑을 참조하던 raw 데이터/이력 테이블 값은 변경 불필요(과거 import 결과에는 영향 없음).
- 다만 **동일 target_field에 매핑된 다른 활성 source_header가 이미 존재**하면 현재 저장은 허용하되(하나의 target에 여러 alias는 정상), 활성 alias 수를 배지로 안내.
- 편집 대상이 활성 상태(`is_active=true`)일 때만 위 검증을 강하게 적용. 비활성 매핑 편집은 검증은 하되 문구를 "저장은 되지만 활성화하기 전까지 매칭되지 않음"으로 안내.

## 파일 변경 요약

- 수정: `src/components/admin/HeaderMappingTable.tsx`
  - Source Header 셀을 편집 가능한 `EditableSourceHeaderCell`로 교체
  - 편집 상태(`editingId`, `draft`) 및 저장 핸들러 추가
- 수정: `src/components/admin/TmHeaderMappingTable.tsx` (동일 구조로 적용)
- 신규: `src/components/admin/EditableSourceHeaderCell.tsx` — 두 테이블 공용 셀 컴포넌트(Input + Save/Cancel + Pencil, 검증 결과 배지).
- 신규(선택): 훅 형태 대신 검증 유틸 `src/lib/admin/header-mapping-validation.ts` — `validateSourceHeaderEdit(rows, id, newValue, fieldsActiveSet)` 반환 `{ ok, error?, warnings[] }`. 두 테이블에서 공용.

## 검증(테스트) 계획

- 빌드 통과 확인.
- 프리뷰에서 `/admin/mapping` → Spare Part & Task Management 탭 각각:
  1. Custom 매핑 편집 → 정상 저장 → 목록 갱신
  2. System 매핑 편집 → 경고 배너 노출, 저장 성공
  3. 다른 매핑과 정규화 후 중복되는 값 입력 → 저장 차단 토스트
  4. 빈 문자열 저장 시도 → 차단
  5. Mapping Test 박스에 편집 후 새 문자열을 넣어 즉시 반영되는지 확인
