## 현황 조사 결과

`Field Config`의 Display Name은 `task_management_field_config` 테이블에 저장되고, `useTaskManagementFieldConfig()` 훅 + `buildTmLabelOverrides()`로 Raw Data 페이지에서 사용됩니다. 저장 시 `TASK_MANAGEMENT_FIELD_CONFIG_QK` 캐시를 invalidate 하므로 이론상 반영됩니다.

그러나 **테이블 헤더 텍스트만 override가 적용**되어 있고, 나머지 UI들은 여전히 코드 상수(`TM_COLUMNS[i].label`)를 직접 사용해서 Field Config 변경이 반영되지 않습니다.

### 반영되는 곳 (OK)
- 테이블 헤더 (`TaskManagementRawDataPage.tsx` 367, 394)
- ColumnOrderMenu 트리거 라벨 계산 (516–517)

### 반영 안 되는 곳 (버그)
| 위치 | 문제 |
|---|---|
| `ColumnOrderMenu.tsx:18` | 컬럼 표시/숨김 토글 목록이 `c.label` 하드코딩 |
| `BulkEditBar.tsx:199, 224` | 벌크 편집 필드 선택 드롭다운이 `getBulkEditableFields()` 결과의 `c.label` 사용 |
| `ExportDialog.tsx:43` | Excel/CSV 내보내기 컬럼 헤더가 `def?.label` 사용 |
| `TaskManagementRawDataPage.tsx:714` | 필터 chip에 표시되는 필드명이 `c.label` |
| `EditCellPopover.tsx:55, 88` | 셀 편집 팝오버 제목/토스트가 `column.label` |
| `BulkConfirmDialog.tsx:49` | 벌크 편집 확인 다이얼로그의 필드명 |

## 수정 계획

전역 헬퍼로 `labelOverrides`를 훅에서 가져와 라벨을 조회하는 함수를 만들고, 위 6개 위치를 하나씩 override를 사용하도록 교체합니다.

### 1) 훅에 유틸 추가 — `src/hooks/useTaskManagementFieldConfig.ts`
`useTmColumnLabel()` 훅을 추가하여 `(key) => overriddenLabel ?? TM_COLUMNS의 label ?? key`를 반환하는 resolver 함수를 노출.

### 2) 각 컴포넌트 수정
- **`ColumnOrderMenu.tsx`**: props로 `labelOverrides`(또는 resolver)를 받도록 시그니처 확장. 부모(`TaskManagementRawDataPage`)에서 이미 계산된 `labelOverrides` 전달. 내부 `LABELS` Map 대신 resolver 사용.
- **`BulkEditBar.tsx`**: 훅으로 resolver 획득 → 필드 옵션 렌더링 시 override 우선.
- **`ExportDialog.tsx`**: 훅으로 resolver 획득 → export 헤더 라벨에 override 우선 (단, `format === "reimport"`는 기존대로 key 유지).
- **`TaskManagementRawDataPage.tsx` L714**: 이미 부모에 `labelOverrides` 존재하므로 `labelOverrides[f.id] ?? TM_COLUMNS…` 로 교체.
- **`EditCellPopover.tsx`**: 훅으로 resolver 획득 후 `column.key`로 조회.
- **`BulkConfirmDialog.tsx`**: 부모에서 이미 override 반영된 라벨을 계산해 전달하거나 훅 사용.

### 3) 캐시 stale 개선 (선택)
`useTaskManagementFieldConfig`의 `staleTime: 30_000`은 유지 — 저장 시 invalidate가 즉시 refetch를 발동하므로 문제 없음. 별도 조치 불필요.

### 4) 검증
- Field Config에서 예: `계획 시작` → `Plan Start(테스트)` 변경 후 저장
- Raw Data 헤더, 필터 chip, ColumnOrderMenu, 벌크 편집 드롭다운, Export 미리보기, 셀 편집 팝오버 제목이 모두 새 라벨 표시하는지 브라우저로 확인 (Playwright 스크린샷)

### 범위 밖
- Spare Part 쪽 Field Config는 이미 유사 패턴이므로 변경 없음.
- DB, RLS, 마이그레이션 변경 없음. 순수 프론트 프리젠테이션 계층 수정.