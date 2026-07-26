## 문제 원인 (실측 확인)

DB 조회 결과, Main Task `EL-C-09` 하위에 총 6개의 Sub가 존재하나 그 중 **-03, -04, -05, -06 은 `main_task_no = NULL`** 로 저장되어 있습니다 (모두 `task-management_reimport_20260725_1321.xlsx` 재임포트로 삽입).

트리거 `trg_task_rollup` 는 `NEW.main_task_no IS NOT NULL AND NEW.level='sub'` 조건에서만 `update_task_summary(discipline, main_task_no)` 를 호출합니다. 그래서:

1. 신규 Sub 4건이 부모와 연결되지 않아 롤업이 아예 실행되지 않음.
2. 부모 `EL-C-09` 는 과거 롤업 결과인 `actual_progress = 1.0000 / auto_judgment = 완료 / actual_finish = 2026-07-14` 상태로 남음.
3. 파서(`src/lib/task-management/parser.ts`)는 부모 판정을 임포트 파일 내 `parentSet` 로만 수행 → 재임포트 파일에 부모 행(EL-C-09)이 포함되지 않으면 새 Sub 행의 `main_task_no` 가 채워지지 않음.

즉 결함은 두 층에 있습니다.
- (A) 임포트/삽입 경로: `main_task_no` 유실.
- (B) 롤업 트리거: `main_task_no` 가 유실되면 완전히 침묵. 방어 로직 없음.

## 해결 방침 (재발 방지 + 즉시 정합화)

### 1. DB — `main_task_no` 자동 파생 트리거 (BEFORE INSERT/UPDATE)
`task_management_raw` 에 `main_task_no` 가 NULL 이고 `task_no` 가 `<PREFIX>-NN` 패턴이면 접두어로 부모(`level='main'`) 존재 여부를 확인해 자동 채움. `level` 이 지정되지 않았거나 `sub` 로 판별된 행에 한정.

### 2. DB — 롤업 트리거 방어 강화
`trg_task_rollup_fn` 에서 sub 행의 `main_task_no` 가 NULL 이면 `task_no` 접두어로 부모를 조회해 롤업 대상 결정. 이미 (1) 로 대부분 해결되지만 이중 안전망.

### 3. DB — 일회성 백필 마이그레이션
```sql
-- (a) main_task_no NULL 이면서 task_no 패턴이 <main>-NN 인 sub 후보 백필
UPDATE task_management_raw s
   SET main_task_no = m.task_no, level = 'sub'
  FROM task_management_raw m
 WHERE s.main_task_no IS NULL
   AND m.level = 'main'
   AND m.discipline = s.discipline
   AND s.task_no LIKE m.task_no || '-%'
   AND split_part(regexp_replace(s.task_no, '^' || m.task_no || '-', ''), '-', 1) ~ '^[0-9]+$';

-- (b) 영향받은 main 재롤업
SELECT update_task_summary(discipline, main_task_no)
  FROM (SELECT DISTINCT discipline, main_task_no
          FROM task_management_raw
         WHERE main_task_no IS NOT NULL AND level='sub') s;
```

### 4. 파서 보강 — `src/lib/task-management/parser.ts`
- 부모 감지 로직에서 `parentSet.has(cand)` 뿐만 아니라 **`task_no` 가 `<prefix>-NN` 형태이면 접두어를 무조건 `main_task_no` 로 세팅** 하도록 수정 (DB의 main 존재는 트리거가 최종 검증).
- 재임포트/부분 파일에서 부모가 파일에 없는 경우에도 Sub 연결이 유지됨.

### 5. 검증
- 백필 후 `EL-C-09` 재조회: sub 6건 중 완료 2건 → `actual_progress` 는 plan-days 가중 평균으로 재계산되고 `actual_finish=NULL`, `auto_judgment` 재판정됨.
- Task Summary UI 에서 EL-C-09 가 완료 그룹에서 진행 그룹으로 이동하는지 확인.
- `bunx tsgo --noEmit` 및 `supabase migration linter` 통과 확인.

## 사용자 확인 사항
없음 — 위 4단계 모두 명시된 요구사항(“빈번 발생 방지 로직 보완”) 범위 내이며 파괴적 삭제 없음. 승인 시 즉시 구현합니다.