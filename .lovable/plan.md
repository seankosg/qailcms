## 목표
사이드바에 **Admin** 그룹을 신설하고, 그 안의 **Mapping** 서브메뉴에서 SHAW CMS의 *Field Mapping* + *Field Config* 두 기능을 통합 제공합니다. 결과적으로 관리자는 다음 두 가지를 DB에서 직접 편집할 수 있습니다.

1. **Field Config** — Raw Data 표의 컬럼 헤더 라벨(display_name), 표시 여부, 정렬 순서
2. **Header Mapping** — Excel Import 시 원본 헤더 문자열 → 시스템 필드 매핑(별칭 관리)

Raw Data 페이지는 하드코딩된 `SPARE_PART_COLUMNS.label` 대신 DB의 `spare_part_field_config.display_name`을 우선 사용합니다.

---

## 데이터 모델 변경 (migration)

### 신규: `public.spare_part_field_config`
Raw Data의 46개 필드에 대해 admin이 라벨/표시/순서를 편집.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | |
| `field_name` | text UNIQUE NOT NULL | `SPARE_PART_COLUMNS.key`와 1:1 |
| `display_name` | text NOT NULL | 헤더에 표시되는 라벨 |
| `is_visible` | boolean NOT NULL default true | Column Menu에서의 기본 노출 |
| `sort_order` | int NOT NULL default 0 | 기본 컬럼 순서 |
| `group_key` | text | id/vendor/qty…(현행 그룹) |
| `note` | text | admin 메모 |
| `updated_by` | uuid | |
| `updated_at` | timestamptz default now() | trigger `set_updated_at` |

- GRANT: `SELECT` → `anon`, `authenticated`; `INSERT/UPDATE/DELETE` → `authenticated`(admin RLS로 제한); `ALL` → `service_role`.
- RLS: 모두 SELECT 가능 / admin만 write (`has_role(auth.uid(),'admin')`).
- 마이그레이션 끝에 46개 기본 필드를 `ON CONFLICT DO NOTHING` 시드 삽입.
- `updated_at` 트리거는 기존 `public.set_updated_at()` 재사용.

### 기존 `spare_part_header_mappings` 보강
- `is_active boolean not null default true` 추가 — SHAW의 enable/disable 토글 지원
- `note text` 추가
- `updated_at` 트리거 부여
- Import 파서(`src/lib/spare-part-import-parser.ts`)에서 이미 이 테이블을 참조 중이면 스키마 확장 후에도 기존 로직 유지 (아래 "파서 영향" 확인 예정)

---

## 파일 구성

### 라우트
```
src/routes/_authenticated/admin/
  route.tsx                 // admin 게이트: has_role('admin')이 아니면 raw-data로 redirect, 하위 <Outlet />
  index.tsx                 // /admin — 간단한 대시보드(카드로 각 서브메뉴 진입)
  mapping.tsx               // /admin/mapping — 좌측 탭: [Field Config | Header Mapping]
```
- `admin/mapping.tsx`는 `Tabs`로 두 패널을 스위치.

### 컴포넌트
```
src/components/admin/
  FieldConfigTable.tsx      // spare_part_field_config CRUD (display_name, is_visible, sort_order, note)
  HeaderMappingTable.tsx    // spare_part_header_mappings CRUD (source_header, target_field, is_active, is_custom)
  MappingTestBar.tsx        // 원본 헤더 문자열 넣으면 정규화·매칭 결과 미리보기 (SHAW의 Mapping Test 이식)
```

### 훅/데이터
```
src/hooks/useSparePartFieldConfig.ts   // useQuery(['spare-part-field-config']) — 캐시 & realtime invalidate
src/hooks/useSparePartHeaderMappings.ts
```

### Raw Data 통합
- `src/lib/spare-part/columns.ts`: 기존 `SPARE_PART_COLUMNS`는 그대로 두되 label/width/type의 fallback 소스로 유지.
- `SparePartRawDataPage.tsx`에서 `useSparePartFieldConfig()`로 오버라이드 맵을 만들고, 컬럼 정의 생성 시 `label = override.display_name ?? c.label`, 그리고 초기 `DEFAULT_ORDER`는 `sort_order` 기준으로 재계산.
- `is_visible=false` 필드는 기본 hidden(`visibility[key] = false`)으로 마운트 — 저장된 사용자 상태가 있으면 사용자 상태 우선.
- `ColumnOrderMenu`, Export 헤더도 동일 오버라이드 라벨을 사용.

### 사이드바 (`AppLayout.tsx`)
- `NAV`에 두 번째 그룹 추가:
```
{
  label: "Admin",
  icon: ShieldCheck,
  items: [
    { to: "/admin", label: "Overview", icon: LayoutDashboard, adminOnly: true },
    { to: "/admin/mapping", label: "Mapping", icon: Wrench, adminOnly: true },
  ],
}
```
- 기존 `adminOnly` 필터를 재사용하므로 비관리자에게는 보이지 않음.

---

## Field Config UI (요약)
- 필드 46개를 `sort_order` 오름차순 테이블로 표시.
- 열: **Field Name (읽기전용)**, **Display Name (인라인 편집)**, **Visible (Switch)**, **Sort Order (숫자, 위/아래 화살표)**, **Group (뱃지)**, **Note**, **Save/Reset**.
- 상단 검색 인풋 + "Reset to defaults" 버튼(기본 46개 필드 라벨을 codebase 상수값으로 되돌림).
- 저장 시 낙관적 업데이트 → `invalidateQueries(['spare-part-field-config'])` → Raw Data 화면 즉시 반영.

## Header Mapping UI (요약)
- SHAW의 `HeaderMappingsTab`을 spare_part 단일 모듈로 축소 이식.
- 상단: 검색, "Show empty targets" 토글, "Add Mapping" 버튼.
- 본문: `target_field` 별 Accordion — 각 그룹 안에 alias 목록(활성 Switch, 편집, 삭제).
- **Mapping Test**: 원본 헤더 문자열 입력 → 정규화(소문자/공백 축약)된 값 + 매칭된 target_field 미리보기.
- 시스템 소유 매핑(`is_custom=false`)은 삭제 잠금(자물쇠 아이콘) — SHAW와 동일 정책.

---

## 구현 순서 (chunk)
1. **migration** — `spare_part_field_config` 신설 + `spare_part_header_mappings` 확장 + 46개 시드 (승인 필요).
2. **훅 + 타입** — `useSparePartFieldConfig`, `useSparePartHeaderMappings`.
3. **라우트/사이드바** — `/admin`, `/admin/mapping`, NAV 확장, admin 가드.
4. **Field Config UI** — 인라인 편집 테이블 완성.
5. **Raw Data 통합** — 오버라이드 라벨/순서/가시성 적용 및 Export까지 반영.
6. **Header Mapping UI** — CRUD + Accordion + Mapping Test.
7. **회귀 확인** — Import 파서가 `spare_part_header_mappings`를 계속 정상 사용하는지, Raw Data 컬럼 표시가 편집한 라벨로 갱신되는지 확인.

## 열려있는 확인 사항 (구현 전 확답 요망 아님 — 기본값 명시)
- Field Config는 `spare_part` 단일 모듈만 다루며, 추후 다른 모듈 추가는 스키마의 `field_name` 유일성 정책상 필요 시 `module` 컬럼을 추가하는 후속 마이그레이션으로 처리합니다. (지금은 단일 모듈로 단순화)
- 편집 권한은 admin(`user_roles.role = 'admin'` 또는 `superuser`) 전용. 일반 사용자에게는 사이드바 Admin 그룹 자체가 숨겨집니다.
