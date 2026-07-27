-- [1] Milestone column
ALTER TABLE public.task_management_raw
  ADD COLUMN IF NOT EXISTS milestone text;
DO $$ BEGIN
  ALTER TABLE public.task_management_raw
    ADD CONSTRAINT task_management_raw_milestone_chk
    CHECK (milestone IS NULL OR milestone IN ('HO','COC','DLP'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_tm_raw_plot_milestone
  ON public.task_management_raw (plot, milestone) WHERE is_active = true;

-- [2] Milestone config (Plot × Kind) + audit + alarm settings
CREATE TABLE IF NOT EXISTS public.tm_milestone_config (
  plot         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('HO','COC','DLP')),
  target_date  date,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plot, kind)
);
GRANT SELECT ON public.tm_milestone_config TO authenticated;
GRANT ALL    ON public.tm_milestone_config TO service_role;
ALTER TABLE public.tm_milestone_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tm_milestone_config_read ON public.tm_milestone_config;
CREATE POLICY tm_milestone_config_read ON public.tm_milestone_config
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS tm_milestone_config_write ON public.tm_milestone_config;
CREATE POLICY tm_milestone_config_write ON public.tm_milestone_config
  FOR ALL TO authenticated
  USING (is_admin_or_super(auth.uid()))
  WITH CHECK (is_admin_or_super(auth.uid()));

CREATE TABLE IF NOT EXISTS public.tm_milestone_config_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot         text NOT NULL,
  kind         text NOT NULL,
  old_date     date,
  new_date     date,
  changed_by   uuid,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tm_milestone_config_audit TO authenticated;
GRANT ALL    ON public.tm_milestone_config_audit TO service_role;
ALTER TABLE public.tm_milestone_config_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tm_milestone_audit_read ON public.tm_milestone_config_audit;
CREATE POLICY tm_milestone_audit_read ON public.tm_milestone_config_audit
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.tm_milestone_config_audit_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.target_date IS DISTINCT FROM NEW.target_date) THEN
    INSERT INTO public.tm_milestone_config_audit(plot, kind, old_date, new_date, changed_by)
      VALUES (NEW.plot, NEW.kind, OLD.target_date, NEW.target_date, NEW.updated_by);
  ELSIF TG_OP = 'INSERT' AND NEW.target_date IS NOT NULL THEN
    INSERT INTO public.tm_milestone_config_audit(plot, kind, old_date, new_date, changed_by)
      VALUES (NEW.plot, NEW.kind, NULL, NEW.target_date, NEW.updated_by);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tm_milestone_config_audit ON public.tm_milestone_config;
CREATE TRIGGER trg_tm_milestone_config_audit
  AFTER INSERT OR UPDATE ON public.tm_milestone_config
  FOR EACH ROW EXECUTE FUNCTION public.tm_milestone_config_audit_trg();

INSERT INTO public.tm_milestone_config(plot, kind) VALUES
  ('C','HO'),('C','COC'),('C','DLP'),
  ('D','HO'),('D','COC'),('D','DLP')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tm_alarm_settings (
  key          text PRIMARY KEY,
  value_int    integer,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tm_alarm_settings TO authenticated;
GRANT ALL    ON public.tm_alarm_settings TO service_role;
ALTER TABLE public.tm_alarm_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tm_alarm_settings_read ON public.tm_alarm_settings;
CREATE POLICY tm_alarm_settings_read ON public.tm_alarm_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS tm_alarm_settings_write ON public.tm_alarm_settings;
CREATE POLICY tm_alarm_settings_write ON public.tm_alarm_settings
  FOR ALL TO authenticated
  USING (is_admin_or_super(auth.uid()))
  WITH CHECK (is_admin_or_super(auth.uid()));
INSERT INTO public.tm_alarm_settings(key, value_int) VALUES ('warning_buffer_days', 7)
  ON CONFLICT (key) DO NOTHING;

-- [3] Alarm computation
CREATE OR REPLACE FUNCTION public.tm_classify_overdue(
  target date, mstone date, buffer_days integer
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN target IS NULL OR mstone IS NULL THEN NULL
    WHEN target <= mstone - buffer_days THEN 'SAFE'
    WHEN target <= mstone THEN 'WARNING'
    ELSE 'RISK'
  END
$$;

CREATE OR REPLACE FUNCTION public.tm_expected_finish(
  actual_start date, actual_finish date, actual_progress numeric, data_date date
) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  ap numeric := COALESCE(actual_progress, 0);
  elapsed integer; daily numeric; remain numeric;
BEGIN
  IF actual_finish IS NOT NULL THEN RETURN actual_finish; END IF;
  IF ap >= 1 THEN RETURN COALESCE(actual_finish, data_date); END IF;
  IF actual_start IS NULL OR data_date IS NULL OR ap <= 0 THEN RETURN NULL; END IF;
  elapsed := (data_date - actual_start) + 1;
  IF elapsed <= 0 THEN RETURN NULL; END IF;
  daily := ap / elapsed;
  IF daily <= 0 THEN RETURN NULL; END IF;
  remain := (1 - ap) / daily;
  RETURN data_date + CEIL(remain)::integer;
END $$;

DROP VIEW IF EXISTS public.v_task_management_raw_derived CASCADE;
CREATE VIEW public.v_task_management_raw_derived AS
WITH cfg AS (
  SELECT plot, kind, target_date FROM public.tm_milestone_config
), bd AS (
  SELECT COALESCE((SELECT value_int FROM public.tm_alarm_settings WHERE key='warning_buffer_days'), 7) AS buffer_days
)
SELECT
  t.*,
  c.target_date AS milestone_date,
  public.tm_classify_overdue(t.plan_end, c.target_date, bd.buffer_days) AS plan_overdue,
  public.tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date) AS expected_finish,
  public.tm_classify_overdue(
    public.tm_expected_finish(t.actual_start, t.actual_finish, t.actual_progress, t.data_date),
    c.target_date, bd.buffer_days
  ) AS actual_overdue
FROM public.task_management_raw t
CROSS JOIN bd
LEFT JOIN cfg c ON c.plot = t.plot AND c.kind = t.milestone;

GRANT SELECT ON public.v_task_management_raw_derived TO authenticated;

-- [4] Register milestone + derived cols in field_config + header_mappings
INSERT INTO public.task_management_field_config(field_name, display_name, group_key, sort_order, is_visible)
VALUES ('milestone','Milestone','task', 105, true)
ON CONFLICT (field_name) DO NOTHING;

INSERT INTO public.task_management_field_config(field_name, display_name, group_key, sort_order, is_visible)
VALUES
  ('plan_overdue','Plan Overdue','status', 135, true),
  ('expected_finish','Expected Finish','forecast', 285, true),
  ('actual_overdue','Actual Overdue','status', 137, true)
ON CONFLICT (field_name) DO NOTHING;

INSERT INTO public.task_management_header_mappings(module, source_header, target_field, is_active)
VALUES
  ('task_management','Milestone','milestone', true),
  ('task_management','milestone','milestone', true),
  ('task_management','마일스톤','milestone', true)
ON CONFLICT (module, source_header) DO NOTHING;