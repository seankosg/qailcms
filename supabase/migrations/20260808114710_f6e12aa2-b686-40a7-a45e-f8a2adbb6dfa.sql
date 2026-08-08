-- Required Document 밴드의 na_flag 정리 (멱등)
-- 근거: REQUIRED_DOC 밴드에서 필요/불필요의 정본은 flag_value 이며,
--       na_flag 는 날짜 단계의 '해당 없음'을 뜻하는 별개 축이다.
UPDATE public.spl_stage_progress p
   SET na_flag = false
  FROM public.spl_stage_catalog c
 WHERE c.stage_code = p.stage_code
   AND c.band = 'REQUIRED_DOC'
   AND coalesce(p.na_flag, false) IS TRUE;