CREATE TABLE IF NOT EXISTS public.spl_owner_backfill_snapshot_20260804 AS
SELECT id, spl_number, pic, eng, pic_po, eng_po, owner_user_id, now() AS snapshot_at
FROM public.spl_items;

GRANT SELECT ON public.spl_owner_backfill_snapshot_20260804 TO authenticated;
GRANT ALL ON public.spl_owner_backfill_snapshot_20260804 TO service_role;
ALTER TABLE public.spl_owner_backfill_snapshot_20260804 ENABLE ROW LEVEL SECURITY;
CREATE POLICY spl_owner_snap_admin ON public.spl_owner_backfill_snapshot_20260804
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));