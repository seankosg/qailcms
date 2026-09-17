UPDATE public.toc_stage_catalog
   SET value_type = 'code',
       done_codes = ARRAY['Done','Completed'],
       note = 'Source records installation as a status word, not a date',
       updated_at = now()
 WHERE stage_code = 'AT_INSTALL';

UPDATE public.toc_stage_catalog
   SET value_type = 'code',
       done_codes = ARRAY['Issued','Done','Completed','Monthly Issued'],
       note = 'N/A items are marked na_flag; source records a status phrase',
       updated_at = now()
 WHERE stage_code = 'SR_ISSUED';