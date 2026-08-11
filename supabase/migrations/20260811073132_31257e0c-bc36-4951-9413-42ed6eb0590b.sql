CREATE TABLE IF NOT EXISTS public.spl_ocs_v1_stage (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL
);
GRANT ALL ON public.spl_ocs_v1_stage TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.spl_ocs_v1_stage_id_seq TO service_role;
ALTER TABLE public.spl_ocs_v1_stage ENABLE ROW LEVEL SECURITY;