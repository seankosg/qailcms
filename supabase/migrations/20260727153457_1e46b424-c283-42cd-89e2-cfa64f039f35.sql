ALTER TABLE public.abd_items_raw DROP CONSTRAINT IF EXISTS abd_items_raw_latest_status_norm_chk;
ALTER TABLE public.abd_items_raw ADD CONSTRAINT abd_items_raw_latest_status_norm_chk
  CHECK (latest_status_norm IS NULL OR latest_status_norm = ANY (ARRAY['A','B','C','NS','TERM','RESUBMIT']));