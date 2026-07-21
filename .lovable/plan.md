## 근본 원인

- 2026-07-19 마이그레이션(`20260719063009_...sql`)에서 `task_management_raw.parent_task_no` 컬럼이 `main_task_no` 로 rename 되었음.
- 하지만 `public.update_task_summary(_discipline, _parent_task_no)` 함수의 본문은 아직 옛 컬럼명 `parent_task_no` 를 사용 중 (`where parent_task_no = _parent_task_no` 두 곳).
- 임포트 시 서브태스크가 삽입/업데이트되면 트리거 또는 rollup RPC가 이 함수를 호출 → `42703: column "parent_task_no" does not exist` 로 각 행이 Rejected 처리됨.
- DB 함수 정의를 pg_proc 로 직접 확인해 `parent_task_no` 를 body 에서 참조하는 함수는 `update_task_summary` 단 하나뿐이며, 트리거 함수(`update_task_summary_trg`) 및 다른 곳은 이미 `main_task_no` 로 정리되어 있음.
- "일부 사용자만" 발생하는 이유: 서브태스크(child) 를 새로 삽입/변경하는 시트를 임포트한 사용자에서만 rollup 이 호출되어 실패가 노출됨. 순수 Main Task 만 다루면 이 경로가 타지 않아 성공하는 것처럼 보임.

## 수정 계획

1. 마이그레이션 1건 추가 — `CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _parent_task_no text)` 로 함수 재정의.
   - 본문의 `parent_task_no` → `main_task_no` 로 치환(총 2곳: 집계 select, worst auto_judgment select).
   - 파라미터 이름(`_parent_task_no`)은 호출부(`rollup.functions.ts`가 `_parent_task_no => data.main_task_no` 로 넘김)와의 호환을 위해 그대로 유지.
   - 나머지 로직(집계식, worst 판정, 부모 update)은 현행 그대로 보존.
2. 다른 마이그레이션/코드 변경 없음. RLS/GRANT 변경 없음.

## 검증

- 마이그레이션 적용 후 `SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND pg_get_functiondef(oid) LIKE '%parent_task_no%';` 결과가 비어야 함(파라미터 이름은 함수 정의 문자열에 남지만, 컬럼 참조는 사라짐 — 필요 시 `LIKE '% parent_task_no %'` 대신 정규식으로 컬럼 참조만 필터).
- 사용자에게 재임포트 요청하여 Rejected 0 인지 확인.
