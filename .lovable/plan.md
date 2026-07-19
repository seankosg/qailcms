# TM Parent/Child → Main Task / Sub Task 전면 개편

Task Management 도메인 전반에서 사용되는 `parent`/`child`, `부모`/`자식` 표현을 UI·코드·DB 모두에서 **Main Task / Sub Task**로 통일합니다. 한글 UI도 영문 그대로 노출합니다.

---

## 1. DB 마이그레이션 (supabase--migration)

한 트랜잭션으로 처리하여 앱 다운타임을 최소화합니다.

### 1-1. 컬럼/값 rename
- `task_management_raw.parent_task_no` → `main_task_no` (컬럼 rename)
- `task_management_raw.level`의 값 마이그레이션:
  - `'parent'` → `'main'`
  - `'child'` → `'sub'`
- 관련 인덱스가 있으면 새 이름으로 재생성

### 1-2. RPC 재작성
- `allocate_task_no(_discipline, _parent_task_no)` → `allocate_task_no(_discipline, _main_task_no)` (내부 로직에서 참조하는 컬럼명/level 값 갱신)
- `rollup_task_all_parents(_discipline)` → `rollup_task_all_mains(_discipline)`
- 개별 롤업 함수(`rollup_task_parent` 존재 여부 확인 후) → `rollup_task_main`
- 함수 내부의 `level='parent'`/`'child'` 리터럴 및 `parent_task_no` 참조 모두 신규 명칭으로 교체
- 이전 함수는 DROP (호출부는 이번 릴리스에서 모두 교체됨)

### 1-3. 타 도메인 영향 없음
`abd_*`, `defect_*`, `spare_*` 는 이 개편과 무관.

---

## 2. TypeScript 코드 개편

### 2-1. 타입/인터페이스
- `src/lib/task-management/parser.ts`
  - `ParsedRow.parent_task_no` → `main_task_no`
  - `ParsedRow.level: "parent" | "child"` → `"main" | "sub"`
  - `parentCount` / `childCount` → `mainTaskCount` / `subTaskCount`
  - 관련 함수(`parentCandidate*`) 이름/주석 정리
- `src/lib/task-management/columns.ts` — level enum 관련 상수/헬퍼 갱신
- `src/lib/task-management/derived.ts` — level 분기 재검토

### 2-2. Server functions
- `src/lib/task-management/rollup.functions.ts`
  - `runRollupAllParents` → `runRollupAllMains` (RPC 이름 함께 변경)
  - `runRollupParent` → `runRollupMain`
  - 입력 스키마의 `parent_task_no` → `main_task_no`
- `src/lib/task-management/hierarchy.functions.ts`
  - `addChildTask` → `addSubTask` (파일명 및 export 명칭)
  - Zod 스키마: `parent_task_no` → `main_task_no`
  - `allocate_task_no` RPC 인자 `_parent_task_no` → `_main_task_no`
  - `level: "parent"` / `"child"` 리터럴 → `"main"` / `"sub"`
  - 에러 메시지 한글 문구: "부모/자식/하위" → "Main Task/Sub Task"
- `src/lib/task-management/import-preflight.functions.ts`
  - 스키마·응답 필드의 `parent_task_no` → `main_task_no`
  - `parent_mismatch` conflict reason은 **DB에 저장되지 않으므로** `main_task_mismatch`로 변경

### 2-3. Import context
- `src/contexts/TaskManagementImportContext.tsx`
  - `parentCount`/`childCount` → `mainTaskCount`/`subTaskCount`
  - level 비교 리터럴 전면 교체
  - 페이로드의 `parent_task_no` → `main_task_no`
  - 주석의 "parent/child" 표현 정리

### 2-4. Hooks
- `src/hooks/useTaskDashboardData.ts` — level 리터럴, 컬럼명 교체

### 2-5. UI 컴포넌트 (영문 라벨 사용)
- `src/components/task-management/raw-data/AddChildTaskDialog.tsx`
  - 파일명: `AddSubTaskDialog.tsx`로 rename
  - 컴포넌트/타입/props: `AddChildTaskDialog`→`AddSubTaskDialog`, `ParentSeed`→`MainTaskSeed`
  - 다이얼로그 제목/라벨/토스트: "하위 Task 추가"→"Add Sub Task", "→ {parent_task_no}"→"→ Main Task: {…}" 등 영문화
  - import 사이트 갱신
- `src/components/task-management/raw-data/TaskManagementRawDataPage.tsx`
  - 트리 표시 배지·툴팁 "P/C" → "Main/Sub"
  - 열 헤더의 "Parent" 표기 → "Main Task No"
- `src/components/task-management/tree/TaskTreePage.tsx`
  - `parents`/`childrenByParent` → `mainTasks`/`subTasksByMain`
  - "자식 N", "표시할 parent가 없습니다" → "Sub Task N", "No Main Task to display"
- `src/components/task-management/detail/TaskDetailPage.tsx`
  - `isParent` → `isMain`; 표시 라벨 영문화
- `src/components/task-management/dashboard/TaskDashboardPage.tsx`
  - `level: "child"` 리터럴 → `"sub"`
- `src/components/task-management/import/TaskManagementImportPage.tsx`
  - "Parent 행 진도율 처리", "Parent(요약) 행 …", "P/C" 표기 → **Main Task 행 진도율 처리 / Sub Task 요약 …** 등 UI 문구 전면 교체 (rollup 모드 선택 카피 포함)
  - `Parent ${count} / Child ${count}` → `Main ${mainTaskCount} / Sub ${subTaskCount}`
- `src/components/task-management/import/ConflictDecisionDialog.tsx`, `ConflictReviewDialog.tsx`
  - "상위 태스크 불일치"·"DB parent"·"파일 parent" → "Main Task 불일치"·"DB Main Task"·"파일 Main Task"
  - `parent_mismatch` 매핑 키를 `main_task_mismatch`로 교체
- `src/routes/_authenticated/admin/task-thresholds.tsx` — 문구 정리

### 2-6. 라우트
- Add Sub Task 다이얼로그 rename에 맞춰 lazy import 경로만 조정 (라우트 URL 변경 없음)

---

## 3. Rollup 옵션 문구 (Import Page)

기존 3가지 옵션 카피를 영문 용어로 재작성:
- "Auto: Sub Task duration 가중평균으로 Main Task 진도율/기간 자동 재계산"
- "Manual: 엑셀의 Main Task 값 유지, 이후 롤업 함수로 재계산"
- "Ignore: 엑셀 Main Task 값 그대로 저장, 롤업 미실행"

---

## 4. 검증

1. `bun tsgo` — 타입 에러 0
2. `TaskManagementImportPage`에서 임포트 → Preflight 요약 표기 확인
3. Raw Data에서 Add Sub Task 다이얼로그 → `allocate_task_no` 호출 성공, 신규 행 `level='sub'`, `main_task_no` 채워짐 확인
4. `runRollupAllMains` 호출 → RPC 성공
5. Tree 페이지에서 Main/Sub 그룹핑 정상 확인
6. 화면상 "Parent"/"Child"/"부모"/"자식" 텍스트가 TM 전 페이지에서 0건

---

## 기술 세부 (참고)

- DB 마이그레이션 순서: (a) 신규 RPC 생성 → (b) 앱 배포 (없음, 하나의 릴리스에서 처리) → 이번엔 앱과 DB를 같은 릴리스에서 교체하므로, migration 후 즉시 코드 반영 필요. `types.ts`는 마이그레이션 승인 후 자동 재생성됨.
- `parent_mismatch` reason은 DB 저장 값이 아니라 서버 응답 문자열이므로 자유롭게 rename 가능.
- 다른 도메인(SM, ABD, Spare Part)의 `parent`/`child` 용어(예: `React.ReactNode` children props, 함수 파라미터 `children`)는 **React 표준 용어**이므로 손대지 않음.
