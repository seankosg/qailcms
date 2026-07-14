# Header Mapping 관리자 편집 확장

Admin Mapping 탭의 3개 Header Mapping 테이블 (Spare Part / Task Management / Snag List) 에 관리자 편집 권한을 확장합니다.

## 범위 (사용자 승인)

1. **Target Field 인라인 편집** — 현재 읽기 전용 → 드롭다운 선택으로 변경
2. **System 매핑 삭제 허용** — 관리자에게만 (Custom 은 기존대로)
3. **비관리자 편집 UI 숨김** — admin/superuser 가 아니면 읽기 전용
4. **3개 탭 모두 동일 적용** — Spare Part, Task Management, Snag List

## 구현

### 1) 공용 컴포넌트 신규
`src/components/admin/EditableTargetFieldCell.tsx`
- Props: `row`, `fields` (선택 가능한 field_config 목록), `onSave(target_field)`
- 표시: `field_name` (mono) + `— display_name`
- 편집 모드: `Select` 로 대상 필드 변경
- 저장 시 동일 (source_header) row 가 이미 다른 target 으로 존재하면 경고 후 차단
- 비활성 field 선택 시 warning toast (매칭 후 Import 시 무시될 수 있음)

### 2) 권한 게이트
- `useCurrentUser` 의 `roles` 로 `canEdit = roles.includes('admin' | 'superuser')` 산출
- `canEdit` false → Add 버튼, Switch, 편집 아이콘, 삭제 버튼 모두 숨김/disabled
- Row hover 편집 아이콘은 `canEdit` 일 때만 렌더

### 3) System 삭제 정책
- `removeRow(r)`:
  - `canEdit` 필수
  - `!r.is_custom` 인 경우 confirm 문구를 `"System 매핑입니다. 시드 재배포 시 되돌아갈 수 있습니다. 정말 삭제할까요?"` 로 강화
  - 그 외 흐름 동일 (delete → invalidate)

### 4) 저장 로직
- `saveTargetField(r, next)`:
  - 동일 `(module, normalize(source_header), target_field=next)` 중복이면 실패
  - `update({ target_field: next, updated_by })` → invalidate → 관련 field_config 캐시도 무효화(선택 필드가 활성 field 목록에 있는지 확인)

### 5) 편집 대상 3개 컴포넌트
- `src/components/admin/HeaderMappingTable.tsx` (Spare Part)
- `src/components/admin/TmHeaderMappingTable.tsx` (Task)
- `src/components/admin/DefectHeaderMappingTable.tsx` (Snag)

모두 동일 패턴:
- `const canEdit = !!me?.roles?.includes('admin') || !!me?.roles?.includes('superuser')`
- Target Field 셀 → `<EditableTargetFieldCell>` (canEdit 일 때 편집 가능, 아니면 read-only 표시)
- Add 버튼, Switch, Actions(삭제) → `canEdit` 로 게이트

## 기술적 세부

- RLS 는 이미 `*_header_mappings_admin_write` 로 관리자 제한 → 서버 정책은 변경 없음
- 마이그레이션 불필요
- 3개 hook (`useSparePartHeaderMappings`, `useTaskManagementHeaderMappings`, `useDefectHeaderMappings`) 및 QK 재사용
- `EditableSourceHeaderCell` 도 `canEdit` prop 추가하여 비관리자에게는 편집 아이콘 렌더 안 함
- `validateSourceHeaderEdit` 로직을 참고해 `validateTargetFieldEdit` 유틸을 `src/lib/admin/header-mapping-validation.ts` 에 추가 (동일 source_header 중복 검사)

## 검증

- `bunx tsgo --noEmit` 통과
- 관리자 계정: Target Field 드롭다운으로 변경 → DB 반영 → 재조회 후 반영 확인
- 일반 계정: 편집 UI 미노출, 표만 표시
- System 매핑: 관리자만 삭제 가능, 경고 문구 표시
