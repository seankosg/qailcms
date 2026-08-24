-- 1) 보정 직전 스냅샷 (멱등: 이미 있으면 재생성하지 않음)
CREATE TABLE IF NOT EXISTS public.abd_termination_fix_snapshot_20260824 (
  id uuid PRIMARY KEY,
  abd_number text,
  aconex_status_raw text,
  aconex_review_status_raw text,
  aconex_date_modified date,
  is_terminated boolean,
  is_active boolean,
  captured_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.abd_termination_fix_snapshot_20260824 TO authenticated;
GRANT ALL ON public.abd_termination_fix_snapshot_20260824 TO service_role;
ALTER TABLE public.abd_termination_fix_snapshot_20260824 ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'abd_termination_fix_snapshot_20260824'
      AND policyname = 'admins read termination fix snapshot'
  ) THEN
    CREATE POLICY "admins read termination fix snapshot"
      ON public.abd_termination_fix_snapshot_20260824
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

INSERT INTO public.abd_termination_fix_snapshot_20260824
  (id, abd_number, aconex_status_raw, aconex_review_status_raw, aconex_date_modified, is_terminated, is_active)
SELECT r.id, r.abd_number, r.aconex_status_raw, r.aconex_review_status_raw,
       r.aconex_date_modified, r.is_terminated, r.is_active
FROM public.abd_items_raw r
WHERE r.is_terminated IS TRUE
  AND r.is_active IS NOT FALSE
  AND (r.aconex_status_raw, r.aconex_review_status_raw) IN (
    ('For Review', 'Under Workflow Review'),
    ('A - Approved', 'Approved'),
    ('C - Revise and Resubmit', 'Revise & Re-Submit')
  )
ON CONFLICT (id) DO NOTHING;

-- 2) 멱등 보정: 화이트리스트 조합만 is_terminated=false
UPDATE public.abd_items_raw r
SET is_terminated = false,
    updated_at = now()
WHERE r.is_terminated IS TRUE
  AND r.is_active IS NOT FALSE
  AND (r.aconex_status_raw, r.aconex_review_status_raw) IN (
    ('For Review', 'Under Workflow Review'),
    ('A - Approved', 'Approved'),
    ('C - Revise and Resubmit', 'Revise & Re-Submit')
  );