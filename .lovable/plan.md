
## 배경 요약

### 현재 앱 상태
- `task_management_raw` 테이블은 `UNIQUE(discipline, task_no)` 제약을 가지며, 임포트 시 `upsert({ onConflict: "discipline,task_no" })`로 동작 → **같은 discipline + task_no = 무조건 UPDATE, 아니면 INSERT**.
- 수동 자식 추가(`addChildTask`)는 이미 앱 레벨 번호 생성 로직 보유: `<parent_task_no>-NN` (2자리 패딩, 형제 중 max+1).
- 즉 "중복 점검"은 사실상 **동일 키인지만** 판단하며, 사용자가 원한 "실제 다른 태스크인데 우연히 같은 task_no" 케이스는 감지하지 못한 채 기존 행을 덮어씀.

### 참조: SHAW PROJECT CMS `T&C` (실제로는 Punch 모듈)
- `punch_items` 유니크 키: `(project_id, item_no)`.
- 서브태스크 번호 생성 RPC `add_punch_subtask(p_parent_id, p_stage, p_payload)`:
  - `SELECT ... FOR UPDATE`로 부모 락.
  - 부모가 leaf이면 먼저 `is_summary=true`로 승격 + 원행을 `parent.item_no || '.1'` 첫 자식으로 복제.
  - `SELECT COUNT(*) INTO v_child_count FROM punch_items WHERE parent_id = p_parent_id;`
  - 신규 자식 `item_no = parent.item_no || '.' || (child_count+1)` 형식(`1.2.1`, `1.2.2` …).
  - 최대 2레벨만 허용(자식 밑에 자식 금지).
  - `SECURITY DEFINER` + 권한 체크(팀 매칭 / 작성자 / 상위 role).
- 임포트 자체 dedupe는 SHAW도 별도 정교화된 것 없음: Defect 쪽은 파일 내 `issue_no` 중복 사전 감지 후 toast로 알림(`findDuplicateSubcontractorIssueNos`).

### 적용 가능성 판단
- **채번 로직(부모.자식n)**: 우리 앱은 이미 `parent-NN` 방식으로 유사 로직을 갖고 있으므로 SHAW 방식(dot notation)을 그대로 도입할 필요는 없음. 단, **RPC + FOR UPDATE + SECURITY DEFINER** 패턴은 동시성/권한 안정성 관점에서 채택 가치 있음(현재 `addChildTask`는 클라이언트 트랜잭션 없이 여러 UPDATE를 순차 실행 → 경합 시 sort_order 충돌 가능).
- **임포트 dedupe**: SHAW의 파일 내 중복 사전 점검 UX는 그대로 도입 가치 있음. DB 대비 중복은 현재 정책(“덮어쓰기”)이 명시적 확인 없이 수행되므로 **preflight 프리뷰**가 필요.

---

## Step 1 · DB 중복 점검 정책 정의 (계약)

임포트 대상 행을 4가지 케이스로 분류:

| 케이스 | 조건 | 기본 처리 |
|---|---|---|
| **A. 신규** | `(discipline, task_no)`가 DB에 없음 | INSERT |
| **B. 완전 동일 재임포트** | DB 존재 + 관리 필드(진척/일정/판정) 동일 | SKIP (변경 없음) |
| **C. 갱신** | DB 존재 + 변경된 필드 있음 | UPDATE (기존 정책 유지, history 기록) |
| **D. 충돌(의심)** | DB 존재하지만 **task_name/parent_task_no/plot이 실질적으로 다름** → 우연히 같은 번호일 가능성 | **차단 or 재번호 부여** (사용자 선택) |

D 판정 시그니처(제안, 조정 가능):
- `task_name` 정규화(공백/특수문자 제거) 문자열 일치도 < 0.6, **또는**
- `parent_task_no` 불일치, **또는**
- `plot` 불일치.

## Step 2 · 파일 내 중복 점검 (기존 동작 강화)

`parser.ts`/`Context.tsx`에서 이미 마지막 값 우선 dedupe. 개선:
- 파일 내 중복은 dialog에 표시 → 사용자가 "auto-suffix(-b, -c …)" 재번호 or "마지막 값 유지" 선택.
- 여러 파일을 함께 임포트할 때도 파일 간 동일 `(discipline, task_no)` 감지 후 알림.

## Step 3 · Preflight Diff 다이얼로그

Import 실행 전에 서버 함수 `previewTaskImport({ files })` 호출 → 각 파일별 결과:
```
{ newCount, updateCount, unchangedCount, conflictCount, conflicts: [{task_no, dbName, fileName, reason}] }
```
UI: `ExportDialog` 근처 카드 하단에 요약 배지 + "충돌 상세 보기" 다이얼로그(테이블).

## Step 4 · 충돌 처리 옵션 (사용자 선택)

각 충돌 행마다 3택:
1. **덮어쓰기(force update)** — 기존 정책. history에 `source='import_forced'` 기록.
2. **건너뛰기(skip)** — 해당 행 미처리, 로그에 남김.
3. **자동 재번호(auto-renumber)** — 앱이 신규 task_no 발급 후 INSERT.
   - 규칙: `parent_task_no`가 있으면 `<parent>-NN` (기존 `addChildTask`와 동일 채번; 형제 max+1, 2자리 패딩).
   - 없으면(최상위) 같은 discipline의 root max+1 → 3자리 유지 규칙(원 포맷 유지). 파싱 실패 시 `<원값>-N` 접미.
   - 신규 번호는 파일 원본 번호와 매핑을 `import_row_logs`에 남겨 추적.

기본 정책 스위치(파일 카드 UI):
- "덮어쓰기(기본) / 건너뛰기 / 자동 재번호"를 파일 단위로 지정 가능.

## Step 5 · 서버 채번 RPC (SHAW 패턴 채용)

동시성 확보를 위해 SHAW의 `add_punch_subtask` 스타일 RPC 신설:

```sql
-- Step 4의 자동 재번호에서 호출
CREATE OR REPLACE FUNCTION public.allocate_task_no(
  _discipline text, _parent_task_no text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_parent record; v_max int := 0; v_next text; v_lock_key bigint;
BEGIN
  -- discipline+parent 조합으로 advisory lock
  v_lock_key := hashtextextended(_discipline || ':' || coalesce(_parent_task_no,'~ROOT~'), 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF _parent_task_no IS NOT NULL THEN
    SELECT * INTO v_parent FROM task_management_raw
      WHERE discipline=_discipline AND task_no=_parent_task_no FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent not found: %', _parent_task_no; END IF;
    -- 첫 세그먼트 max
    SELECT COALESCE(MAX((split_part(substring(task_no from length(_parent_task_no)+2), '-', 1))::int),0)
      INTO v_max FROM task_management_raw
      WHERE discipline=_discipline AND task_no LIKE _parent_task_no || '-%';
    v_next := _parent_task_no || '-' || lpad((v_max+1)::text, 2, '0');
  ELSE
    -- 최상위: 숫자 root max+1 (형식 자유; 실패 시 예외)
    SELECT COALESCE(MAX((task_no)::int),0) INTO v_max
      FROM task_management_raw
      WHERE discipline=_discipline AND parent_task_no IS NULL AND task_no ~ '^[0-9]+$';
    v_next := lpad((v_max+1)::text, 3, '0');
  END IF;
  RETURN v_next;
END $$;
GRANT EXECUTE ON FUNCTION public.allocate_task_no(text,text) TO authenticated;
```

`addChildTask`도 이 RPC를 재사용하도록 리팩터 → 클라이언트에서 loop 돌며 shift/insert 하던 부분이 트랜잭션 단위로 압축 & 락 안전.

## Step 6 · UI/Context 변경

- `TaskManagementImportContext`
  - `preflight()` 신설(임포트 실행 전 자동 호출) → `file.preview` 결과 저장.
  - `startImport`는 파일별 `conflictPolicy: 'overwrite'|'skip'|'renumber'` 사용.
  - `renumber` 시 각 충돌 행에 대해 `allocate_task_no` 호출 후 payload 교체.
  - 결과 리포트에 `renumbered` 카운트 추가.
- `TaskManagementImportPage`
  - 파일 카드에 정책 셀렉트 + Preflight 배지(신규/업데이트/충돌 N건).
  - 충돌 상세 다이얼로그(파일 vs DB 필드 비교).

## Step 7 · 검증

- 유닛: `allocate_task_no` 병렬 호출 시 유일성.
- 시나리오: 
  1. 동일 파일 재임포트 → unchanged 대다수.
  2. 이름만 바꾼 행 → conflict, 정책별 결과 확인.
  3. 신규 자식만 있는 파일 → 정상 INSERT + parent 승격/롤업.
  4. 파일 내 중복 → 사전 경고 및 dedupe 통계.

---

## 참조 채택 결론

| SHAW 요소 | 우리 앱 채택 여부 |
|---|---|
| dot notation `1.2.3` | ✗ (기존 `-NN` 유지) |
| leaf→summary 자동 승격 후 원행 복제 | 부분 채택 — 이미 `addChildTask`에서 level만 승격, 복제는 우리 데이터 모델상 불필요 |
| `SECURITY DEFINER` + `FOR UPDATE` RPC 채번 | **채택**(`allocate_task_no`) |
| 파일 내 duplicate preflight toast (Defect) | **채택** (Step 2) |
| DB 대비 diff preflight | **신규 도입** (Step 3) — SHAW에도 없는 개선 |

## 기술 세부 (구현 파일)

- 신규: `supabase/migrations/*_allocate_task_no.sql`
- 신규: `src/lib/task-management/import-preflight.functions.ts` (createServerFn, requireSupabaseAuth)
- 수정: `src/contexts/TaskManagementImportContext.tsx` (preflight/policy/renumber)
- 수정: `src/components/task-management/import/TaskManagementImportPage.tsx` (정책 UI, 충돌 뱃지)
- 신규: `src/components/task-management/import/ConflictReviewDialog.tsx`
- 수정: `src/lib/task-management/hierarchy.functions.ts` (`addChildTask`가 `allocate_task_no` RPC 사용)
