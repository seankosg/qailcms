## 1. Main Task 진도율이 롤업되지 않는 이유 (근본 원인)

DB에서 `public.update_task_summary(_discipline, _parent_task_no)` 함수 본문을 실측한 결과, 집계·업데이트 시 `level` 필터가 **옛 명칭**을 그대로 사용하고 있음을 확인했습니다.

- 하위 집계: `where ... and level = 'child'`
- 부모 업데이트: `where ... and task_no = _parent_task_no and level = 'parent'`

그러나 현재 `task_management_raw` 데이터의 `level` 값은 `main` / `sub` 로만 존재합니다 (`main=167`, `sub=1161`, `child`/`parent` = 0건).

결과적으로,
- 서브 집계가 항상 0행 → 함수가 `agg.cnt = 0`에서 조기 return
- 설령 통과하더라도 `level='parent'` 조건에 매칭되는 Main Task 행이 0건 → UPDATE 0 rows
- 따라서 `rollup_task_all_mains`가 실행돼도 Main Task의 `actual_progress`, `plan_progress`, `plan_start/end`, `slip_days`, `auto_judgment` 등이 전혀 갱신되지 않음

이전에 `main_task_no` 컬럼명 마이그레이션은 반영됐지만, `level` 라벨 변경(`parent/child` → `main/sub`)이 이 함수에 반영되지 않은 상태로 남아있었기 때문입니다. (Sub Task 파생 필드는 별도 트리거 `calc_sub_task_derived_fn`로 계산되므로 정상 동작해 왔음.)

### 수정

`update_task_summary` 함수 본문의 두 `level` 리터럴을 교체하는 마이그레이션을 실행:

```sql
-- child -> sub
where discipline = _discipline
  and main_task_no = _parent_task_no
  and level = 'sub'

-- parent -> main
update public.task_management_raw
   set ...
 where discipline = _discipline
   and task_no = _parent_task_no
   and level = 'main';
```

이후 `rollup_task_all_mains`를 5개 공종(ARCH/ELEC/MECH/DESN/PRJC)에 대해 1회 실행하여 기존 Main Task 진도율을 즉시 재계산합니다. 이후부터는 임포트 완료 후 자동 롤업이 정상 동작합니다.

## 2. 항목 클릭 → 상세 페이지 드릴다운

파일: `src/components/task-management/tree/TaskTreePage.tsx`

- Main Task `CardHeader`: 현재 클릭 시 펴기/접기만 동작. 셰브론 아이콘 영역만 토글로 유지하고, `task_no` / `task_name` 텍스트 영역을 클릭하면 `/closure/task-management/detail/$id` (Route: `detail.$id.tsx`, `p.id` 전달)로 이동. 우측 컨트롤(Progress/Gap/History 버튼)은 `stopPropagation` 유지.
- Sub Task `<tr>`: `task_no` 셀 또는 행 전체 클릭 시 동일 라우트로 `k.id` 전달하며 이동. History 버튼은 기존대로 `stopPropagation` 유지.
- 이동은 `useNavigate({ to: "/closure/task-management/detail/$id", params: { id } })` 사용.

## 3. 지연 필터 → 위험도(정상/주의/지연/위험) 필터로 교체

파일: `src/components/task-management/tree/TaskTreePage.tsx`

현재 `delayFilter: "off" | "all" | "main" | "sub"` (Main/Sub 지연 구분)을 **위험도 다중선택 필터**로 대체합니다. 위험도 라벨은 `AUTO_JUDGMENTS`(`완료 / 정상 / 주의 / 지연 / 위험`) 중 사용자가 요청한 4종 `정상 / 주의 / 지연 / 위험`을 노출.

- 상태: `const [judgmentFilter, setJudgmentFilter] = useState<Set<string>>(new Set())`  (빈 세트 = 필터 없음)
- UI: 기존 Select 자리에 4개 Toggle 형태의 pill 버튼 그룹 (`정상 · 주의 · 지연 · 위험`). 각 pill은 `AUTO_JUDGMENT_COLORS`로 착색, 선택 시 반전 강조. 우측 끝에 "모두 해제" 텍스트 버튼.
- 판정 소스: 각 행의 `auto_judgment`가 있으면 그대로 사용, 없으면 `computeJudgment(row, undefined, asOfDate)`로 계산. Main Task는 자체 `auto_judgment` + 서브의 `worstJudgment(kids.map(k => k.auto_judgment))` 중 worst.
- 매칭 규칙: `judgmentFilter`가 비어있지 않을 때, Main Task 또는 그 하위 Sub 중 하나라도 선택된 위험도에 포함되면 표시. (기존 지연 필터가 Main/Sub 어느쪽 지연도 매칭했던 UX와 동등.)
- 엑셀 내보내기 필터 라벨 및 URL/상태만 사용하므로 라우트 스키마 변경 없음. `filtersLabel`은 `위험도=정상,지연` 형태로 요약.

## 기술 상세

- 마이그레이션은 `supabase--migration` 툴로 실행하며 함수 정의만 CREATE OR REPLACE. 이후 5개 discipline 각각 `rollup_task_all_mains` 호출.
- 드릴다운은 이미 존재하는 `/closure/task-management/detail/$id` 라우트를 재사용하므로 신규 라우트 없음.
- 위험도 필터 로직은 컴포넌트 로컬 상태로 처리(URL 파라미터 추가 없음). 향후 필요 시 search param화 가능.
