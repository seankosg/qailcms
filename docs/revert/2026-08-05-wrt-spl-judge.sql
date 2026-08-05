-- 되돌리기 (미실행). 2026-08-05 WRT·SPL 판정 함수 + SPL 카탈로그 round_no
DROP VIEW IF EXISTS public.wrt_items_judged;
DROP VIEW IF EXISTS public.spl_items_judged;
DROP FUNCTION IF EXISTS public.wrt_judge_one(uuid, date);
DROP FUNCTION IF EXISTS public.spl_judge_one(uuid, date);
DROP FUNCTION IF EXISTS public.wrt_judge_v1(date);
DROP FUNCTION IF EXISTS public.spl_judge_v1(date);
-- 마이그레이션 A 되돌리기
UPDATE public.spl_stage_catalog SET round_no = NULL WHERE stage_code = 'CODE_B_TO_A';
ALTER TABLE public.spl_stage_catalog DROP COLUMN IF EXISTS round_no;
