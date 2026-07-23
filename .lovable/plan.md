## 목표
`admin/mapping` 페이지의 **As Built Drawing → Header Mapping** 탭을 Snag List Management → Header Mapping 탭과 동일한 UI/기능으로 재구현. ABD 고유값(`team`, `round_index`, `stage`, `plan_or_actual`)은 삭제하지 않고 Snag 이식판 위에 얹는 형태로 유지.

## 현재 상태(실측 확인)
- `abd_header_mappings` 테이블 컬럼: `team`, `source_header`, `target_field`, `round_index`, `stage`, `plan_or_actual`, `active`, `created_at`, `updated_at` — Snag 표준의 `is_custom`, `is_active`, `note`, `updated_by` 없음, unique 제약 없음.
- 현재 `AbdHeaderMappingTable.tsx`는 자체 `useState`+`useEffect` 로컬 로드, 인라인 편집 없음(추가/삭제/토글만), Mapping Test 없음, System/Custom 배지 없음, 권한 게이팅 없음.
- `abd_field_config`에는 `origin` 컬럼이 **없음** → Snag의 "파생 필드 임포트 불가" 로직은 이번 이식에서 제외.
- Snag 이식 대상: `DefectHeaderMappingTable.tsx` — Card 헤더, Add 버튼, Mapping Test 박스, 검색, `EditableSourceHeaderCell`/`EditableTargetFieldCell`, Type 배지, Active Switch, 삭제 버튼, Add Dialog(field_config 기반 Target Select), React Query 기반 무효화, `useCurrentUser().isAdmin` 권한 게이팅.

## 작업 순서

### 1) DB 마이그레이션 (`supabase--migration`)
`abd_header_mappings` 를 Snag 표준과 정합하게 확장:
- `ADD COLUMN is_custom boolean NOT NULL DEFAULT false`
- `ADD COLUMN is_active boolean NOT NULL DEFAULT true` — 기존 `active` 값을 복사 후 `active` 컬럼은 남겨두되 앱은 `is_active`만 사용(호환성 유지). 또는 완전 대체가 원하시면 rename.
- `ADD COLUMN note text`, `ADD COLUMN updated_by uuid`
- `ADD CONSTRAINT abd_header_mappings_team_source_header_key UNIQUE (team, source_header)` — ABD는 team별 매핑이므로 스코프에 team 포함
- 기존 시드 매핑 12건은 `is_custom = false`(System)로 표시되도록 값 유지.

### 2) 훅 신설 `src/hooks/useAbdHeaderMappings.ts`
Snag의 `useDefectHeaderMappings` 패턴 그대로:
- `AbdHeaderMappingRow` 인터페이스에 `team`, `round_index`, `stage`, `plan_or_actual` 포함.
- `ABD_HEADER_MAPPING_QK` 상수 export.
- `useQuery` — `team`, `source_header` 순 정렬.

### 3) `AbdHeaderMappingTable.tsx` 전면 재작성
Snag 컴포넌트를 베이스로 이식하되 다음만 ABD 특화 유지:
- **컬럼**: `Team` | `Source Header` | `Target Field` | `Round` | `Stage` | `Plan/Actual` | `Type` | `Active` | `Actions` — Team/Round/Stage/Plan-Actual은 표시용, 나머지 Source/Target은 `EditableSourceHeaderCell`/`EditableTargetFieldCell` 사용.
- **툴바**: Team 필터 Select(All/MECH/ELEC/ARCH) + 검색 Input + Add Mapping 버튼(admin 전용).
- **Mapping Test 박스**: Snag와 동일 — 정규화된 norm 값과 매칭된 target 배지 표시.
- **Add Dialog**: Team Select + Source Header Input + Target Field **Select(useAbdFieldConfig 기반)** + Round/Stage/Plan-Actual Input(선택 입력). Insert 시 `module` 대신 `team` 사용, `is_custom: true`, `is_active: true`.
- **삭제/토글/편집**: Snag와 동일하게 React Query 무효화(`ABD_HEADER_MAPPING_QK`) + `refetch`.
- **권한**: `useCurrentUser().isAdmin` 으로 Edit/Add/Delete/Switch 게이팅. Snag의 System/Custom 배지 표시.
- **파생 필드 로직 제외**: `abd_field_config`에 `origin` 컬럼이 없어 이번 이식에서는 생략(추후 필드 도입 시 재이식).

### 4) 검증
- 12건 시드 매핑이 `System` 배지 + 잠금 아이콘으로 표시.
- Team 필터 + 검색 + Mapping Test 동작.
- 인라인 수정 → 정규화/충돌 검증(`validateSourceHeaderEdit`) 재사용.
- Admin이 아닐 때 Add/Delete/Switch 비활성.
- 빌드/타입 통과.

## 기술 세부
- 정규화·충돌 검증 로직: `src/lib/admin/header-mapping-validation.ts`를 그대로 재사용(모듈 무관). `source_issue_no` 특수 룰은 ABD에는 해당 필드가 없어 자연 스킵.
- 기존 `active` 컬럼은 코드에서 참조하지 않아 남겨두어도 무해. 향후 정리 마이그레이션은 별도.
- `abd_header_mappings`의 RLS/정책·트리거는 변경 없음(관리자 write, 인증 사용자 read).

## 확인 필요 (선택)
- Round/Stage/Plan-Actual 3개 컬럼은 현재 12건 시드에서 실제로 사용 중일 가능성이 있어 **표시 + 편집 유지**로 계획했습니다. 이 3개 필드를 Add Dialog에서 편집 대상에서 빼고 표시 전용으로 두거나, 아예 UI에서 제거하길 원하시면 알려주세요.
