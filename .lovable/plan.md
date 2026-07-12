## 배경 — ALSMK My Workspace 스터디 요약 (수정)

ALSMK는 `is_summary` 플래그로 Summary/Task를 구분하지만, **QAIL에서는 Summary를 Task와 동일하게 취급**한다. 즉 별도 타입 없이 "자식이 있으면 Parent, 없으면 Leaf"만 존재하는 2-tier 모델로 단순화한다.

| Type | 판별 (QAIL) | 취급 |
|---|---|---|
| **Parent Task** | `level = 'parent'` 또는 자식 존재 | 일반 Task와 동일하게 편집 가능. 진척률은 수동 편집 or 자식 롤업으로 갱신 |
| **Child Task (Subtask)** | `parent_task_no != null` | 부모에 종속된 실제 작업 단위 |

핵심 시사점:
- ALSMK의 `is_summary` 자동 생성/갱신 로직(`handleGenerateSummaries`)은 **채택하지 않음** — QAIL은 `parent_task_no`가 명시적으로 지정되므로 자동 그룹핑 불필요.
- Parent도 그냥 Task이므로 필드 편집, 코멘트, 상태 이력 모두 동일하게 허용. UI 차이는 오직 "계층 표시 + 롤업 계산" 뿐.

## 현재 QAIL Task Raw Data 상태

- 스키마: `task_management_raw`에 `parent_task_no`, `level`, `sort_order`, `sub_task_desc` 존재 — 계층 지원 이미 완비.
- `TaskTreePage.tsx`는 별도 트리 뷰. `TaskManagementRawDataPage.tsx`는 평탄 그리드.
- Raw Data에는 계층 UX 없음: 접기/펼치기, 자식 추가, 롤업 재계산 UI 부재.
- 서버 rollup 함수는 `src/lib/task-management/rollup.functions.ts`에 이미 존재(`parent_task_no` 기준).

## 제안 — Raw Data에 접목할 UI/기능 (우선순위 순)

### P0. 계층 인식 그리드

```text
[▸] TSK-001  parent   설계 검토           45%   ...
    └ TSK-001-01  child  구조 계산서 리뷰   60%
    └ TSK-001-02  child  도면 리뷰         30%
[▸] TSK-002  parent   ...
```

- `parent_task_no`로 그룹핑, `sort_order` 정렬.
- Parent 행: `bg-muted/40` + semi-bold, 앞에 chevron 버튼. Child 행: `task_name` 컬럼 들여쓰기 + `└` 접두.
- Collapse 상태는 `localStorage["task-raw-collapsed"]`로 유지 (ALSMK `TaskTable.tsx` 방식 그대로).
- 툴바에 **Collapse All / Expand All** 토글 추가.
- Parent와 Child 모두 동일하게 편집 가능 — 별도 잠금 없음(현재 `actual_progress` parent 잠금 로직도 롤업 기능이 없다면 제거 검토).

### P1. Add Child Task 액션

- Parent 행 hover 시 `+` 버튼, 우클릭 메뉴에도 노출.
- `AddChildTaskDialog`(신규): 부모의 `discipline`, `pic`, `plan_start`, `plan_end`, `floor_level` 등을 pre-fill.
- 서버 함수 `addChildTask` (`hierarchy.functions.ts` 신규):
  - 부모가 leaf(`level='child'` or null)면 `level='parent'`로 승격.
  - 새 child `task_no` 자동 생성(부모 코드 + `-NN`), `sort_order` 부여.
  - `has_role('admin'|'superuser')` 가드.
- 원자성이 필요하면 PL/pgSQL RPC `add_child_task_management(_parent_task_no, ...)` 마이그레이션 추가.

### P2. Rollup 재계산 버튼

- 서버 로직은 이미 있음(`rollup.functions.ts`).
- 툴바 **"부모 진척률 재계산"** 버튼: 전체 parent에 대해 duration-weighted `actual_progress` + `slip_days` + `auto_judgment` 갱신.
- 선택 행이 있으면 그 parent들만 대상. 완료 후 갱신 건수 toast.

### P3. 계층 필터 & 뷰 토글

- Column Filter 프리셋: "Parents only / Children only / Leaves only".
- 툴바 **"계층 뷰 / 평면 뷰"** 토글 — 평면 뷰는 현재 동작 유지, 계층 뷰에서만 그룹핑·들여쓰기·collapse 활성.

### P4. Export 확장

- `ExportDialog`: Parent → Children 순 재정렬, Parent 행 굵은 스타일.
- Type 컬럼은 생략(Summary=Task 원칙에 따라). 대신 계층은 `task_name` 들여쓰기(`  └ ...`)로 표현.
- 상단 메타에 `Totals: Parents N / Children N / Total N` 라인 추가.

### P5. Cascade Soft-Delete (선택)

- Parent 삭제 시 자식 함께 처리 확인 다이얼로그("N개 하위 태스크가 함께 삭제됩니다"). QAIL이 soft-delete를 채택했는지 확인 후 조건부.

## 스코프에서 제외

- **자동 Summary 생성** (ALSMK `handleGenerateSummaries`) — Summary를 Task와 동일 취급하므로 불필요.
- **`is_summary` 별도 컬럼/타입 배지** — 도입하지 않음.
- **Realtime 롤업** — 수동 버튼만.
- **3-tier 이상 계층** — 현재 2-tier 유지.

## 기술 노트

**신규/수정 파일**
- `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx` — 그룹핑, collapse state, 들여쓰기 렌더.
- `src/components/task-management/raw-data/AddChildTaskDialog.tsx` (신규).
- `src/components/task-management/raw-data/ExportDialog.tsx` — Parent→Children 정렬, 스타일, 메타.
- `src/lib/task-management/hierarchy.functions.ts` (신규) — `addChildTask`, `recalcParentRollup` + admin 가드.
- (선택) Supabase 마이그레이션: `add_child_task_management` RPC.

## 확인 필요

권장 최소 세트는 **P0(계층 그리드) + P1(Add Child) + P2(롤업 재계산)** 입니다. 이대로 진행할지, 또는 포함/제외할 항목을 지정해 주세요.
