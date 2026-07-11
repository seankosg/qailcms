## 원인

현재 파서(`src/lib/task-management/parser.ts`)의 parent/child 판정이 **세그먼트 개수 3 이하 = parent** 로 되어 있음 (L210-217):

```ts
function segmentCount(taskNo: string): number { ... }
const isParent = segs <= 3;
function parentIdOf(taskNo: string): string | null {
  const parts = taskNo.split("-");
  if (parts.length < 4) return null;
  return parts.slice(0, 3).join("-");
}
```

그러나 이 프로젝트의 task_no 규칙은:
- Parent: `AR-C-T-01` (4 세그먼트)
- Child : `AR-C-T-01-01` (5 세그먼트)

따라서 **모든 row가 child 로 분류**되고, `curParent` 가 절대 셋업되지 않아 propagation(부모 → 자식 빈 필드 채움)도 동작하지 않음. 결과적으로 DB의 모든 134행이 `level='child'`, 자식 행의 `category`/`plot`/`task_name`/`risk` 는 비어 있음.

## 계획

### A. 파서: parent 판정을 "prefix 관계" 기반으로 교체
`src/lib/task-management/parser.ts`

1. task_no 세그먼트를 하드코딩 3/4로 판단하지 않고, **파일 안의 다른 task_no 가 `${myTaskNo}-` 로 시작하면 parent** 로 판정. 세그먼트 개수와 무관하게 동작하고, 3-세그먼트/4-세그먼트 스킴 모두 커버.
2. `parentIdOf(taskNo)` 를 "마지막 세그먼트 제거 → 그 결과가 실제 parent 집합에 존재하면 그 값, 없으면 null" 로 변경. 즉, `AR-C-T-01-01` → `AR-C-T-01`.
3. 접두어 mismatch 교정 로직(L429~437)은 새 `parentIdOf` 결과 기준으로 자연스럽게 재사용.
4. propagation 대상 필드는 현행 유지: `category`, `plot`, `task_name`(항목), `risk`. `pic`/`sub_task_desc`/`row_type`/`status_manual` 등은 부모와 자식이 다르므로 propagate 하지 않음.

구현 스케치:
```ts
// 1차 스캔: 파일 내 모든 task_no 수집
const allTaskNos = new Set<string>(); // rows 7~ 스캔
// parent 판정: 다른 task_no 가 `${a}-` 로 시작하면 parent
const isParent = [...allTaskNos].some((t) => t !== a && t.startsWith(`${a}-`));
// parentIdOf: 마지막 세그먼트 제거, allTaskNos 에 존재해야 함
const parts = a.split("-");
const candidate = parts.slice(0, -1).join("-");
const parentNo = allTaskNos.has(candidate) ? candidate : null;
```

`isParent` 캐싱을 위해 2-pass 로 변경(1-pass 로 task_no만 먼저 훑어서 Set 채우고, 2-pass 에서 현행 필드 파싱). `curParent`/propagation 로직은 그대로 유지되며 이제 정상 동작.

### B. 통계/미리보기
`ParseTaskManagementResult.parentCount` 는 새 로직에 따라 자동으로 정상 값이 산출됨. UI 문구·컬럼 변경 없음.

### C. 기존 DB 데이터 반영
- 파서 수정 후 사용자가 동일 파일을 **다시 Import** 하면 upsert 로 134행의 `level`, `category`, `plot`, `task_name`, `risk` 가 갱신됨.
- 별도 SQL 백필은 하지 않음 (파서/재임포트가 단일 source of truth).

### D. 검증
- typecheck 통과 확인
- 재임포트 후 DB에서:
  - `SELECT COUNT(*) FROM task_management_raw WHERE discipline='건축' AND level='parent'` 가 0이 아님을 확인
  - `AR-C-T-01-01` 등 자식 행에 `category='OUTSTANDING'`, `plot='C'`, `task_name='TOWER CORRIDOR CEILING FINAL'`, `risk='High'` 가 채워졌는지 확인

## 참고
- parent_task_no 인덱스 (`task_management_raw_parent_idx`) 는 이미 있으므로 스키마 변경 없음.
- rollup 로직(별도 `is_rollup` row 생성)은 이 변경과 독립적으로 계속 동작.
