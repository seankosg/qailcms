-- ABD: field_mismatch / mismatch_fields 값 초기화 (로직 폐기에 따른 정리)
UPDATE public.abd_items_raw
   SET field_mismatch = false,
       mismatch_fields = '{}'::jsonb
 WHERE field_mismatch = true
    OR (mismatch_fields IS NOT NULL AND mismatch_fields <> '{}'::jsonb);