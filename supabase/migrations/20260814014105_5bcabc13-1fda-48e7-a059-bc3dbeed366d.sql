DO $$
BEGIN
  PERFORM set_config('spl.change_source','reqdoc_test_revert_20260814', true);

  UPDATE public.spl_stage_progress
     SET flag_value = 'N/A', actual_start = NULL
   WHERE item_id = '1f0a6381-235d-4dd0-a4df-dcc8030cf50c'
     AND stage_code = 'REC_LETTER_2Y';

  UPDATE public.spl_stage_progress
     SET flag_value = 'REQUIRED', actual_start = NULL
   WHERE item_id = '1f0a6381-235d-4dd0-a4df-dcc8030cf50c'
     AND stage_code = 'PHYSICAL_LIST';
END $$;