CREATE TABLE public.abd_latest_status_restore_snapshot_20260727 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abd_item_id uuid NOT NULL,
  abd_number text,
  prev_latest_status text,
  restored_to text,
  restored boolean NOT NULL DEFAULT false,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  note text
);
GRANT SELECT, INSERT, UPDATE ON public.abd_latest_status_restore_snapshot_20260727 TO authenticated;
GRANT ALL ON public.abd_latest_status_restore_snapshot_20260727 TO service_role;
ALTER TABLE public.abd_latest_status_restore_snapshot_20260727 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "restore_snap_admin_only" ON public.abd_latest_status_restore_snapshot_20260727
  FOR ALL TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE INDEX abd_restore_snap_item_idx ON public.abd_latest_status_restore_snapshot_20260727(abd_item_id);