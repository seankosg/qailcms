DROP POLICY IF EXISTS "staging service only" ON public._defect_reimport_staging;
ALTER TABLE public._defect_reimport_staging DISABLE ROW LEVEL SECURITY;