UPDATE public.task_management_raw
SET milestone = v.m, updated_at = now()
FROM (VALUES
  ('EL-C-29','HO'),('EL-C-29-01','HO'),('EL-C-29-02','HO'),('EL-C-29-03','HO'),('EL-C-29-04','HO'),
  ('EL-C-30','HO'),('EL-C-30-01','HO'),('EL-C-30-02','HO'),('EL-C-30-03','HO'),('EL-C-30-04','HO'),
  ('EL-D-32','HO'),('EL-D-32-01','HO'),('EL-D-32-02','HO'),('EL-D-32-03','HO'),('EL-D-32-04','HO'),
  ('EL-D-33','HO'),('EL-D-33-01','HO'),('EL-D-33-02','HO'),('EL-D-33-03','HO'),('EL-D-33-04','HO'),
  ('EL-D-19-04','HO'),
  ('ME-D-08-03','HO'),('ME-D-08-04','HO'),('ME-D-08-05','HO'),('ME-D-08-06','HO'),('ME-D-08-07','HO'),
  ('ME-D-08-08','HO'),('ME-D-08-09','HO'),('ME-D-08-10','HO'),('ME-D-08-11','HO'),
  ('AR-C-P-19-04','COC'),
  ('AR-C-T-20','COC'),('AR-C-T-20-01','COC'),('AR-C-T-20-02','COC'),('AR-C-T-20-03','COC')
) AS v(task_no, m)
WHERE public.task_management_raw.task_no = v.task_no
  AND public.task_management_raw.is_active = true
  AND public.task_management_raw.milestone IS DISTINCT FROM v.m;