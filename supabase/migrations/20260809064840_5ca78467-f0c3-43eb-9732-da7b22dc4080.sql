CREATE TABLE IF NOT EXISTS public.abd_ocs_inc_verify_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  package_id text NOT NULL,
  bucket text NOT NULL,
  path text NOT NULL,
  expected_sha256 text NOT NULL,
  expected_byte_size bigint,
  actual_sha256 text,
  actual_byte_size bigint,
  ok boolean NOT NULL DEFAULT false,
  error text,
  verified_by uuid,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abd_ocs_inc_verify_receipts_uniq UNIQUE (run_id, bucket, path)
);

CREATE INDEX IF NOT EXISTS abd_ocs_inc_verify_receipts_run_idx
  ON public.abd_ocs_inc_verify_receipts (run_id, package_id, ok);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_ocs_inc_verify_receipts TO authenticated;
GRANT ALL ON public.abd_ocs_inc_verify_receipts TO service_role;

ALTER TABLE public.abd_ocs_inc_verify_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin manages ocs inc verify receipts" ON public.abd_ocs_inc_verify_receipts;
CREATE POLICY "admin manages ocs inc verify receipts"
  ON public.abd_ocs_inc_verify_receipts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));