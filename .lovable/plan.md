## Raw Data Columns 메뉴 ↔ Admin Mapping(field_config) 양방향 연동

3개 모듈(Spare Part / Task Management / Snag List)에서 Raw Data Columns 메뉴와 Admin → Mapping → Field Config가 **동일한 저장소(`*_field_config` 테이블)를 실시간으로 공유**하도록 만듭니다.

### 양방향 정의

| 방향 | 트리거 | 결과 |
|---|---|---|
| Admin → Raw Data | Admin Field Config에서 display_name/sort_order/is_visible/group_key 저장 | 해당 모듈 `*_FIELD_CONFIG_QK` invalidate → Raw Data 헤더·순서·노출 즉시 갱신 |
| Raw Data → Admin | Columns 메뉴에서 드래그 순서 변경 / 체크박스 노출토글 / 라벨(선택) 변경 | 동일 테이블에 upsert → Admin 화면도 자동 갱신 |

**핵심 규약**: field_config는 "전체 사용자 공용 설정"이며 양쪽 UI 모두 동일 레코드를 편집. 개인 preference(pin, 컬럼 폭 sizing, 필터, 정렬 등)는 종전대로 `user_view_preferences`에 유지 — 이건 사용자별이라 field_config와 분리.

### 권한 정책

`*_field_config`는 이미 admin/superuser 전용 UPDATE RLS. 따라서:

- **관리자(admin/superuser)**: Columns 메뉴에서 순서·노출 조작이 즉시 field_config에 반영(전체 사용자에 영향).
- **일반 사용자**: Columns 메뉴에서 조작 시 개인 `user_view_preferences`(또는 localStorage)에만 저장. field_config는 읽기 전용. UI에는 "관리자만 전체 기본값을 수정할 수 있습니다" 힌트 표시.

관리자 여부는 이미 각 페이지에서 `useCurrentUser().isAdmin`으로 판정 중이므로 재사용.

### 항목별 매핑

Raw Data Columns 메뉴 조작 → field_config 컬럼:

| 메뉴 조작 | 저장 필드 | 비고 |
|---|---|---|
| 드래그 순서 변경 | `sort_order` (10 단위 재할당) | 관리자만 |
| 체크박스 표시/숨김 | `is_visible` | 관리자만 |
| pin/unpin | (X) `user_view_preferences.frozenExtras` | 개인 설정 유지 |
| 라벨 편집 | (Columns 메뉴에 없음) | Admin 화면에서만 |

Admin → Raw Data 방향은 이미 라벨은 반영. 이번 변경으로 `sort_order`·`is_visible`·`group_key`도 반영.

### 변경 사항

#### 1. field_config → defaults 파생 hook 추가

- `useSparePartFieldConfig` → `useSparePartDefaults()` 추가
- `useTaskManagementFieldConfig` → `useTmDefaults()` 추가
- `useDefectFieldConfig` → `useDefectDefaults()` 추가

반환:
```ts
{
  defaultOrder: string[];        // sort_order asc
  defaultVisibility: Record<string, boolean>;
  defaultGroup: Record<string, string>;
  labelOf: (key: string) => string;
}
```

코드 `*_COLUMNS`는 컬럼 메타(type/renderer/width)의 소스로만 유지. field_config 로딩 전에는 코드 순서 fallback.

#### 2. Columns 메뉴에 서버 반영 뮤테이션 추가

`ColumnOrderMenu`(Spare/Task), `DefectColumnOrderMenu` 3종을 확장:

- Props에 `isAdmin: boolean`, `mutateFieldConfig: (patches) => Promise<void>` 추가.
- `onOrderChange` / `onVisibilityChange` 시:
  - 관리자: 로컬 상태 즉시 반영 + `field_config` upsert(변경된 행만 `sort_order`/`is_visible` update) + `queryClient.invalidateQueries(*_FIELD_CONFIG_QK)`.
  - 비관리자: 종전대로 `user_view_preferences`에만 저장.
- 저장 실패 시 toast + 로컬 상태 rollback.
- 드래그 시에는 debounce(300ms)로 서버 호출 묶어 트래픽 완화.

#### 3. Raw Data 3종 페이지 정합 수정

`SparePartRawDataPage.tsx`, `TaskManagementRawDataPage.tsx`, `DefectRawDataPage.tsx`:

- `DEFAULT_ORDER` 상수 → hook `defaultOrder` 사용.
- 초기 상태 로드에서 개인 preference `order`가 비어있으면 `defaultOrder`, `visibility`가 비어있으면 `defaultVisibility` 사용.
- `field_config`가 변경되어 refetch되면(무효화 후) 아직 개인 커스터마이즈가 없는 필드는 새 default를 반영, 이미 개인 값을 가진 필드는 유지.
- Reset 버튼 동작: 개인 preference 삭제 → `defaultOrder`/`defaultVisibility`로 복귀.
- 관리자면 Columns 메뉴에서 서버 mutation 활성화. 일반 사용자는 종전 동작 유지 + "관리자 전용" 힌트.

#### 4. 서버 mutation 유틸

각 모듈에 `updateFieldConfig(patches)` 서버 함수 추가:

```ts
// createServerFn + requireSupabaseAuth + admin 검증
// patches: Array<{ field_name, sort_order?, is_visible? }>
// UPDATE *_field_config SET ... WHERE field_name = ...
```

- `src/lib/spare-part/field-config.functions.ts`
- `src/lib/task-management/field-config.functions.ts`
- `src/lib/defect-management/field-config.functions.ts`

관리자 판정은 `has_role(user, 'admin' or 'superuser')` DB 함수 사용.

#### 5. Admin Field Config 테이블 자동 갱신

Admin 화면은 이미 `useQuery`로 field_config를 구독 중이므로, Columns 메뉴에서 발생한 invalidate 이벤트가 자동 반영됨. 별도 코드 변경 불필요.

#### 6. UI 힌트

Columns 메뉴 상단 안내 문구:
- 관리자: "드래그·체크는 전체 사용자 기본값을 변경합니다. 개인 pin은 저장됩니다."
- 일반 사용자: "드래그·체크는 내 화면에만 적용됩니다. 전체 기본값은 관리자만 변경 가능합니다."

### 변경 파일

- `src/hooks/useSparePartFieldConfig.ts` — `useSparePartDefaults()` 추가
- `src/hooks/useTaskManagementFieldConfig.ts` — `useTmDefaults()` 추가
- `src/hooks/useDefectFieldConfig.ts` — `useDefectDefaults()` 추가
- `src/lib/spare-part/field-config.functions.ts` — 신규
- `src/lib/task-management/field-config.functions.ts` — 신규
- `src/lib/defect-management/field-config.functions.ts` — 신규
- `src/components/spare-part/raw-data/ColumnOrderMenu.tsx` — mutation 연결, admin 분기
- `src/components/task-management/raw-data/ColumnOrderMenu.tsx` — 동일
- `src/components/defect-management/raw-data/DefectColumnOrderMenu.tsx` — 동일
- `src/components/spare-part/raw-data/SparePartRawDataPage.tsx` — defaults 소스 교체, admin prop 전달
- `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` — 동일
- `src/components/defect-management/raw-data/DefectRawDataPage.tsx` — 동일

### 변경 없음

- DB 스키마·마이그레이션·RLS(`*_field_config` 테이블·정책은 이미 존재)
- Header Mapping / 임포트 파서 / 필터 / 드릴다운 URL_MAP
- `user_view_preferences` 스키마 및 개인 pin/sizing 저장 로직
- `Admin → Mapping → Field Config` UI (자동 반영으로 충분)

### 검증

1. `bunx tsgo --noEmit` 통과.
2. 관리자 로그인 상태로 Snag Raw Data → Columns 메뉴에서 컬럼 순서 드래그 → Admin → Mapping → Snag List → Field Config로 이동 시 sort_order가 반영되어 있음.
3. Admin에서 특정 필드 is_visible 토글 저장 → Raw Data 헤더에서 해당 컬럼 노출/숨김이 즉시 반영.
4. 일반 사용자 로그인 → Columns 메뉴 드래그 → field_config는 변경 없음, 본인 화면만 변경. 새로고침 후에도 개인 preference 복원.
5. 관리자가 드래그 중 서버 오류 발생 시 로컬 상태 rollback + toast.
6. 3개 모듈(Spare/Task/Defect) 모두 동일 동작.
