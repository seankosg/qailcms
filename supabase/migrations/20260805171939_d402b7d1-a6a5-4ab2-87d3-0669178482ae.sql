ALTER TABLE public.spl_stage_catalog ADD COLUMN IF NOT EXISTS round_no smallint;
UPDATE public.spl_stage_catalog SET round_no = 2 WHERE stage_code = 'CODE_B_TO_A';