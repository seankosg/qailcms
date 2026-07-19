# Import Preset 관리 기능 (SM 우선)

Admin → Mapping 화면의 Snag List Management 도메인에 **Preset** 탭을 추가하고, DB로 관리되는 프리셋이 SM Import의 Column Select 다이얼로그의 프리셋 버튼 목록에 실시간 연동되도록 구현합니다. 이번 단계는 SM만 대상이며, 이후 Task Management → ABD 순서로 동일 패턴으로 확장합니다.

## 범위 (확정된 요구사항)

- 전체 공유(글로벌) 프리셋 — 모든 사용자가 동일한 버튼 목록을 봅니다.
- 기존 3개(`Update from Aconex`, `HDEC's Update`, `Cat Check`)는 초기 시드로 DB에 삽입되고 편집 가능. `New Upload`는 항상 첫 번째로 표시되는 고정 프리셋(DB 미저장)으로 유지.
- 프리셋 관리 속성: 라벨(버튼 이름), 포함할 canonical field 목록, 표시 순서.
- **프리셋 추가 / 편집(라벨·필드·순서) / 삭제 전부 지원**.
- 색상, 소유자, 개인 프리셋은 이번 범위 제외.

## 1. DB 스키마

새 테이블 `public.defect_import_presets`:

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid PK | |
| `label` | text NOT NULL | 버튼에 표시되는 이름 (편집 가능) |
| `fields` | text[] NOT NULL DEFAULT '{}' | canonical field 슬러그 배열 |
| `sort_order` | int NOT NULL DEFAULT 0 | 오름차순 표시 |
| `created_at`, `updated_at` | timestamptz | 표준 |

- `GRANT SELECT` → `anon, authenticated` (프리셋 목록은 Import 화면에서 항상 읽기 가능).
- `GRANT INSERT/UPDATE/DELETE` → `authenticated`, `GRANT ALL` → `service_role`.
- RLS: `SELECT` 는 모두 허용. `INSERT/UPDATE/DELETE` 는 `has_role(auth.uid(),'admin') OR has_role(auth.uid(),'d_superuser')`.
- `updated_at` 자동 갱신 트리거.
- 같은 마이그레이션에서 기존 3개 프리셋 시드 INSERT.

## 2. Admin UI — 신규 Preset 탭

`src/routes/_authenticated/admin/mapping.tsx` 의 Snag List Management 도메인 `Tabs` 에 `<TabsTrigger value="preset">Preset</TabsTrigger>` 추가. 콘텐츠는 신규 컴포넌트 `src/components/admin/DefectImportPresetTable.tsx`.

기능:
- **목록**: sort_order 오름차순 표시. 각 행에 라벨, 필드 chip 리스트, 순서 이동(↑/↓), 편집·삭제 버튼.
- **추가**: 상단 우측 "+ Preset 추가" 버튼 → 빈 라벨/빈 필드 로우 즉시 생성 후 편집 모드 진입. 라벨은 UNIQUE 제약 없이 자유롭게(중복 허용).
- **라벨 편집**: 인라인 입력, Enter/blur 저장.
- **필드 편집**: 팝오버 내 체크박스 리스트. 옵션 소스는 `useDefectFieldHelpers()` 의 canonical field 목록(라벨은 Field Config 라벨 표시, 검색 입력 포함).
- **순서 변경**: ↑/↓ 버튼으로 인접 행과 sort_order swap.
- **삭제**: 확인 다이얼로그.
- 데이터 계층: `supabase` 클라이언트 + React Query (`queryKey: ['defect-import-presets']`). 각 mutation 후 `invalidateQueries`.
- 비-admin 은 읽기 전용(버튼 disable).

## 3. Import 다이얼로그 연동

`src/components/defect-management/import/DefectColumnSelect.tsx`:
- 하드코딩된 `ACONEX_FIELDS`, `HDEC_FIELDS`, `CAT_CHECK_FIELDS` 상수 및 3개 프리셋 정의 제거.
- `useQuery(['defect-import-presets'])` 로 DB 프리셋 로드.
- 최종 presets 배열:
  ```
  [
    { id: 'new-upload', label: 'New Upload' },
    ...dbPresets.map(p => ({
      id: p.id,
      label: p.label,
      matchedHeaders: headers.filter(h => p.fields.includes(headerToFieldMap[h])),
    })),
  ]
  ```
- 색상 `className` 은 이번 범위에서 제거.
- 로딩 중에는 `New Upload` 만 노출.

## 4. 사이드 이펙트 / 후속

- Admin 이 프리셋을 저장·수정·추가·삭제·재정렬 하면 다음 SM Import 세션의 프리셋 버튼에 즉시 반영.
- 파서/헤더 매핑/필수 필드 로직은 변경 없음.
- Task / ABD 는 이번 범위 밖. 이후 요청 시 `task_management_import_presets`, `abd_import_presets` 를 동일 패턴으로 순차 추가.

## 산출물

1. Supabase 마이그레이션 — 테이블 + GRANT + RLS + 트리거 + 3개 시드 INSERT.
2. `src/components/admin/DefectImportPresetTable.tsx` 신규 (추가/편집/순서/삭제 지원).
3. `src/routes/_authenticated/admin/mapping.tsx` — SM 섹션에 Preset 탭 추가.
4. `src/components/defect-management/import/DefectColumnSelect.tsx` — DB 프리셋 소비로 교체.

승인해주시면 위 순서로 진행하겠습니다.
