CREATE UNLOGGED TABLE IF NOT EXISTS public._defect_reimport_staging (
  source_issue_no text PRIMARY KEY,
  data jsonb NOT NULL
);
GRANT ALL ON public._defect_reimport_staging TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public._defect_reimport_staging TO authenticated;
ALTER TABLE public._defect_reimport_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staging service only"
  ON public._defect_reimport_staging FOR ALL
  USING (false) WITH CHECK (false);