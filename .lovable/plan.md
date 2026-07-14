## Defect Raw Data — 매핑 컬럼 전부 노출 + Task 스타일 컬럼 UI로 완전 교체

### 1. 누락 컬럼을 `DEFECT_COLUMNS`에 추가

parser 및 `defect_field_config`에는 존재하지만 `src/lib/defect-management/columns.ts`의 `DEFECT_COLUMNS`에 없어 헤더 렌더 대상에서 빠진 필드를 추가합니다.

| key | label | type | group |
|---|---|---|---|
| `updated_status` | Updated Status | badge | status |
| `updated_description` | Updated Description | longtext | content |
| `updated_by_name` | Updated By | text | audit |
| `updated_date_raw` | Updated Date | datetime | audit |
| `ir` | IR | text | refs |
| `forms` | Forms | text | refs |
| `subcontractor_issue_no` | Subcon Issue No | text | refs |
| `captured_by_name` | Captured By | text | people |
| `trade_detail` | Trade Detail | text | trade |
| `classification_source` | Classification Source | text | classification |
| `podium_area` | Podium Area | text | location |
| `building` | Building | text | location |
| `room` | Room | text | location |
| `room_group` | Room Group | text | location |
| `level_name` | Level | text | location |
| `review_flag` | Review Flag | text | flags |
| `remarks` (이미 존재 확인만) | — | — | — |

- 위치는 각 group 내 논리 순서 유지 (Updated 계열은 audit/content, Location 서브필드는 location, refs 그룹은 IR/Forms/Subcon Issue No).
- 기본 노출 여부는 `defect_field_config.is_visible` 값을 그대로 따름 (기존 로직 `L520-521` 재사용 → 노이즈 방지, IR/Forms/Podium 등은 초기 hidden 유지).
- `defect_field_config`에 아직 행이 없는 신규 키(예: `updated_status`/`updated_description`/`updated_by_name`/`updated_date_raw`/`building`/`room`/`room_group`/`level_name`/`review_flag`)는 마이그레이션으로 `INSERT ... ON CONFLICT DO NOTHING` 시딩. `is_visible=false` 기본, `display_name`은 위 label과 동일.

### 2. 컬럼 순서/선택 UI를 Task와 완전 동일하게 교체

`src/components/defect-management/raw-data/DefectColumnOrderMenu.tsx` 를 삭제하고, Task의 `src/components/task-management/raw-data/ColumnOrderMenu.tsx` 와 동일 구조인 `DefectColumnOrderMenu` 로 재작성:

- 상단 안내 텍스트: "드래그로 순서 변경 · 핀으로 좌측 고정({n}/3)".
- Reset: `visibility={}` / `frozenExtras=[]` / `order = DEFECT_COLUMNS.map(c=>c.key).filter(k => k!=='is_critical' && k!=='stage_progress')`.
- Frozen 상단 헤더는 "Frozen · Select (고정)" 하나만 (Task와 대칭). 시스템 고정(Select) 표기만 유지, `is_critical`/`stage_progress` 를 시스템 고정 목록에서 제거.
- 사용자 pin 목록 → Columns 목록 (드래그, checkbox 표시/숨김, pin/unpin) 순서. Task 파일 구조를 1:1 이식.
- 라벨 해석은 `useDefectFieldHelpers().getLabel(k)` 로 유지 (Task는 `useTmColumnLabel` 사용, Defect는 `useDefectFieldHelpers` 사용 — 프레임워크 차이만 1대1 매핑).

### 3. `DefectRawDataPage.tsx` 정합 수정

- `SYSTEM_FROZEN_IDS = ["__select"]` 로 축소. `is_critical`/`stage_progress` 는 일반 데이터 컬럼으로 강등.
- `DEFAULT_ORDER` 에 `is_critical`, `stage_progress` 포함(맨 앞쪽 지점에 삽입) → 사용자 드래그/숨김/pin 대상.
- `columns` 조합 로직(L494-508)에서 `is_critical`/`stage_progress` 를 특수 case로 두되, 이제 `orderedKeys` 상 위치가 유동 → `for-loop` 안에서 id 매칭으로 특수 컬럼 삽입, 나머지는 `byKey.get(id)` 로 데이터 컬럼 생성. 기존과 동일 패턴 유지.
- `columnVisibility` 계산에서 `__select` 만 강제 true. `is_critical` / `stage_progress` 는 `visibility[id]` 값을 따르되 default true.
- `orderedKeys` 는 `[...SYSTEM_FROZEN_IDS, ...frozenExtras, ...order.filter(k => !frozenExtras.includes(k))]` 로 단순화. `is_critical`/`stage_progress` 는 `order` 내부에 존재.
- `frozenColIds`(sticky) 는 `[...SYSTEM_FROZEN_IDS, ...frozenExtras]` 그대로.
- 저장/복원 로직(`viewPref.save`)의 `validKeys` 를 `DEFAULT_ORDER` 로 재계산 — `is_critical`/`stage_progress` 포함되어 있어 사용자 pin 대상이 됨.
- 기존 뷰 프리퍼런스 마이그레이션: 저장된 `order` 에 `is_critical`/`stage_progress` 없으면 자동으로 앞부분에 삽입(현행 코드의 defect 순서 보존 로직 재활용).

### 4. 필드 라벨 소스 일관성

- 라벨 소스는 `useDefectFieldHelpers().getLabel(k)` 유지. `DEFECT_COLUMNS[i].label` 은 fallback.
- 새로 추가된 컬럼도 `defect_field_config` 행이 시딩되므로 관리자 페이지(Mapping → Snag List Management → Field Config)에서 라벨/노출/정렬 변경 가능.

### 5. 마이그레이션

`supabase/migrations/<timestamp>_defect_field_config_missing_fields.sql`:

```sql
INSERT INTO public.defect_field_config (field_name, display_name, is_visible, sort_order, group_key)
VALUES
  ('updated_status',        'Updated Status',        false, 480, 'status'),
  ('updated_description',   'Updated Description',   false, 490, 'content'),
  ('updated_by_name',       'Updated By',            false, 500, 'audit'),
  ('updated_date_raw',      'Updated Date',          false, 510, 'audit'),
  ('building',              'Building',              false, 175, 'location'),
  ('room',                  'Room',                  false, 176, 'location'),
  ('room_group',            'Room Group',            false, 177, 'location'),
  ('level_name',            'Level',                 false, 178, 'location'),
  ('review_flag',           'Review Flag',           false, 520, 'flags')
ON CONFLICT (field_name) DO NOTHING;
```

- 이미 존재(`ir`/`forms`/`podium_area`/`subcontractor_issue_no`/`captured_by_name`/`trade_detail`/`classification_source`)는 건드리지 않음.

### 6. 변경 파일

- `src/lib/defect-management/columns.ts` — `DEFECT_COLUMNS` 확장.
- `src/components/defect-management/raw-data/DefectColumnOrderMenu.tsx` — Task 스타일로 재작성.
- `src/components/defect-management/raw-data/DefectRawDataPage.tsx` — SYSTEM_FROZEN 축소, order/visibility 반영.
- `supabase/migrations/<timestamp>_defect_field_config_missing_fields.sql` — 신규.

### 변경 없음

- parser / 임포트 로직 / 필터 규약 / 드릴다운 URL_MAP / RLS / 데이터 스키마.

### 검증

1. `bunx tsgo --noEmit` 타입 체크 통과.
2. `/closure/snag-management/raw-data` 진입 → Columns 메뉴에 Task와 동일한 구조(Frozen · Select 만 시스템 고정, 나머지 전부 드래그/pin/hide 가능)로 표시.
3. 신규 컬럼(Building/Room/Room Group/Level/Updated* 등)이 Columns 메뉴에 리스트업되고 체크박스로 노출 가능.
4. 노출 시 헤더/셀이 정상 렌더되고 값이 채워짐(샘플 파일 임포트 후 확인).
