-- 죽은 판정 갈래 제거 (호출 코드 0건 확인, 화면 정본은 spl_eval_as_of)
DROP VIEW IF EXISTS public.spl_items_judged;
DROP FUNCTION IF EXISTS public.spl_judge_v1(date);
DROP FUNCTION IF EXISTS public.spl_judge_one(uuid, date);