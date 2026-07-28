-- 사전 검증: 기존 raw 데이터의 milestone 값이 모두 tm_milestone_kinds.kind_code에 존재해야 함
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM public.task_management_raw r
  WHERE r.milestone IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.tm_milestone_kinds k WHERE k.kind_code = r.milestone
    );
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Cannot add FK: % raw rows have milestone values not present in tm_milestone_kinds', bad_count;
  END IF;
END $$;

ALTER TABLE public.task_management_raw
  DROP CONSTRAINT IF EXISTS task_management_raw_milestone_chk;

ALTER TABLE public.task_management_raw
  DROP CONSTRAINT IF EXISTS task_management_raw_milestone_fk;

ALTER TABLE public.task_management_raw
  ADD CONSTRAINT task_management_raw_milestone_fk
  FOREIGN KEY (milestone)
  REFERENCES public.tm_milestone_kinds(kind_code)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;