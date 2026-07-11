
## 목표
현재 Spare Part만 지원되는 Admin → Mapping (Field Config / Header Mapping) 기능을 Task Management Raw Data에도 동일하게 제공한다.

## 1. DB 마이그레이션 (신규 테이블 2개)

`task_management_field_config`
- `field_name` (unique), `display_name`, `is_visible`, `sort_order`, `group_key`, `note`, `updated_at`, `updated_by`
- `TM_COLUMNS` 26개 필드로 seed (label/group/sort_order = index*10)

`task_management_header_mappings`
- `module` = 'task_management_raw', `source_header`, `target_field`, `is_custom`, `is_active`, `note`, `updated_at`, `updated_by`
- unique(module, source_header) — SHAW/Spare Part와 동일 스키마
- `TM_COLUMNS`의 label을 기본 alias로 seed (source_header=label → target_field=key)

RLS: admin/superuser는 전체 CRUD, authenticated는 SELECT (Spare Part와 동일 정책). GRANT 포함.

## 2. Frontend — 훅

- `src/hooks/useTaskManagementFieldConfig.ts` — Spare Part 훅과 동일 구조, `buildTmLabelOverrides` 포함
- `src/hooks/useTaskManagementHeaderMappings.ts` — 동일 구조

## 3. Admin UI 확장

`src/routes/_authenticated/admin/mapping.tsx`를 상단에 모듈 선택(Segmented) — "Spare Part" / "Task Management" — 로 감싼다.
- 각 모듈별 `<FieldConfigTable module="…"/>`, `<HeaderMappingTable module="…"/>`

기존 컴포넌트를 `module` prop 기반으로 리팩터:
- `FieldConfigTable`: prop에 따라 훅/테이블/기본 컬럼 정의(`SPARE_PART_COLUMNS` vs `TM_COLUMNS`) / group 옵션(`GROUP_HEADER_BG`)을 스위칭
- `HeaderMappingTable`: prop으로 module 문자열(`spare_part_raw` / `task_management_raw`)과 소스 필드 목록 전환

Admin overview 카드에 문구만 소폭 수정.

## 4. Raw Data 반영

`src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`:
- `useTaskManagementFieldConfig` + `buildTmLabelOverrides`로 컬럼 헤더 라벨 override
- config의 `sort_order`/`is_visible`을 초기 컬럼 순서·기본 노출에 반영 (Spare Part 패턴 그대로)
- Export 시 라벨도 override

## 5. Import 반영

`src/contexts/TaskManagementImportContext.tsx` / `src/lib/task-management/parser.ts`:
- import 시 `task_management_header_mappings`에서 `source_header → target_field` 조회하여 파서의 헤더 별칭 테이블에 병합 (Spare Part와 동일 패턴)

## 6. 기술 노트

- 테이블/훅/컴포넌트 모두 Spare Part 코드 패턴을 그대로 미러링 (구조 재사용).
- `types.ts`는 마이그레이션 승인 후 자동 재생성됨. 컴포넌트 코드는 `(supabase as any)` 캐스팅으로 안전.
- 어드민 라우트 가드는 기존 `admin/route.tsx` 그대로 사용.

## 파일 변경 예상
- 신규: 마이그레이션 SQL, `useTaskManagementFieldConfig.ts`, `useTaskManagementHeaderMappings.ts`
- 수정: `admin/mapping.tsx`, `FieldConfigTable.tsx`, `HeaderMappingTable.tsx`, `TaskManagementRawDataPage.tsx`, `TaskManagementImportContext.tsx`, `task-management/parser.ts`, `admin/index.tsx` 문구
