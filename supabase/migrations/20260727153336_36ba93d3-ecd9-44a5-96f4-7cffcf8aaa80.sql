ALTER TABLE public.abd_items_raw DROP CONSTRAINT IF EXISTS abd_items_raw_bucket_top_chk;
ALTER TABLE public.abd_items_raw ADD CONSTRAINT abd_items_raw_bucket_top_chk
  CHECK (bucket_top IS NULL OR bucket_top = ANY (ARRAY['Approved','UR','DS','NS','RESUBMIT']));