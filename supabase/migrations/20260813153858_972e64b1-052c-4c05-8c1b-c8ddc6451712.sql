CREATE TABLE IF NOT EXISTS public.abd_dar_reattr_snapshot_20260813 (
  id uuid NOT NULL,
  team text,
  abd_number text,
  r1_submission_actual date,
  r1_dar_actual date,
  r2_submission_actual date,
  r2_dar_actual date,
  r3_submission_actual date,
  r3_dar_actual date,
  decision text NOT NULL,
  moved_to_round int,
  taken_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.abd_dar_reattr_snapshot_20260813 TO authenticated;
GRANT ALL ON public.abd_dar_reattr_snapshot_20260813 TO service_role;
ALTER TABLE public.abd_dar_reattr_snapshot_20260813 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read abd dar reattr snapshot"
ON public.abd_dar_reattr_snapshot_20260813
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superuser'));