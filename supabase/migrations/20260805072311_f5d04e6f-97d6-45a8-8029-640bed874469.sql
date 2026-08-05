CREATE TABLE public.abd_ocs_number_correction_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_name text NOT NULL,
  snapshot_id uuid,
  abd_number text NOT NULL,
  ocs_before text,
  ocs_after text,
  change_category text,
  updated boolean NOT NULL DEFAULT false,
  executed_by uuid,
  executed_at timestamp with time zone NOT NULL DEFAULT now(),
  verification jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.abd_ocs_number_correction_log TO authenticated;
GRANT ALL ON public.abd_ocs_number_correction_log TO service_role;

ALTER TABLE public.abd_ocs_number_correction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read ocs number correction log"
ON public.abd_ocs_number_correction_log
FOR SELECT TO authenticated
USING (true);