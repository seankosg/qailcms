-- ============ Gate 1: Master Reference (MF) ============
ALTER TABLE public.abd_items_raw
  ADD COLUMN IF NOT EXISTS mf_check boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mf_types text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS mf_reference text,
  ADD COLUMN IF NOT EXISTS mf_revision text,
  ADD COLUMN IF NOT EXISTS mf_checked_by uuid,
  ADD COLUMN IF NOT EXISTS mf_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS mf_changed_after_ds boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audit_status text NOT NULL DEFAULT 'not_audited',
  ADD COLUMN IF NOT EXISTS audit_selected_at timestamptz,
  ADD COLUMN IF NOT EXISTS audit_by uuid,
  ADD COLUMN IF NOT EXISTS audit_at timestamptz,
  ADD COLUMN IF NOT EXISTS audit_note text,
  ADD COLUMN IF NOT EXISTS audit_reason text,
  ADD COLUMN IF NOT EXISTS is_reopened boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'abd_items_raw_audit_status_chk') THEN
    ALTER TABLE public.abd_items_raw
      ADD CONSTRAINT abd_items_raw_audit_status_chk
      CHECK (audit_status IN ('not_audited','audit_selected','audit_passed','audit_failed','correction_required'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS abd_items_raw_audit_status_idx ON public.abd_items_raw (audit_status);
CREATE INDEX IF NOT EXISTS abd_items_raw_mf_check_idx ON public.abd_items_raw (mf_check);

ALTER TABLE public.abd_settings
  ADD COLUMN IF NOT EXISTS audit_sample_ratio numeric NOT NULL DEFAULT 10;

-- ============ MF 변경 이력 ============
CREATE TABLE IF NOT EXISTS public.abd_mf_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.abd_items_raw(id) ON DELETE CASCADE,
  before_value jsonb,
  after_value jsonb,
  reason text,
  impact_note text,
  after_ds boolean NOT NULL DEFAULT false,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.abd_mf_change_log TO authenticated;
GRANT ALL ON public.abd_mf_change_log TO service_role;
ALTER TABLE public.abd_mf_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS abd_mf_change_log_select ON public.abd_mf_change_log;
CREATE POLICY abd_mf_change_log_select ON public.abd_mf_change_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS abd_mf_change_log_insert ON public.abd_mf_change_log;
CREATE POLICY abd_mf_change_log_insert ON public.abd_mf_change_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS abd_mf_change_log_item_idx ON public.abd_mf_change_log (item_id, created_at DESC);

-- ============ 감사 이력 ============
CREATE TABLE IF NOT EXISTS public.abd_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.abd_items_raw(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.abd_audit_log TO authenticated;
GRANT ALL ON public.abd_audit_log TO service_role;
ALTER TABLE public.abd_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS abd_audit_log_select ON public.abd_audit_log;
CREATE POLICY abd_audit_log_select ON public.abd_audit_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS abd_audit_log_insert ON public.abd_audit_log;
CREATE POLICY abd_audit_log_insert ON public.abd_audit_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS abd_audit_log_item_idx ON public.abd_audit_log (item_id, created_at DESC);

-- ============ MF 완료 판정 ============
CREATE OR REPLACE FUNCTION public.abd_mf_ready(r public.abd_items_raw)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(r.mf_check, false)
     AND coalesce(array_length(r.mf_types, 1), 0) > 0
     AND coalesce(btrim(r.mf_reference), '') <> ''
$$;

-- ============ Gate 1 트리거: MF 미완료 시 DS 실적일 입력 차단 ============
CREATE OR REPLACE FUNCTION public.abd_guard_ds_actual_requires_mf()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  n int;
  newv date;
  oldv date;
  changed boolean := false;
BEGIN
  FOR n IN 1..3 LOOP
    EXECUTE format('SELECT ($1).r%s_draft_start_actual, ($2).r%s_draft_start_actual', n, n)
      INTO newv, oldv USING NEW, COALESCE(OLD, NEW);
    IF newv IS NOT NULL AND (TG_OP = 'INSERT' OR oldv IS DISTINCT FROM newv) THEN
      changed := true;
    END IF;
  END LOOP;

  IF changed AND NOT public.abd_mf_ready(NEW) THEN
    RAISE EXCEPTION 'MF_NOT_READY: Master Reference 확인이 완료되지 않았습니다. MF 종류와 Reference를 입력한 후 MF Check를 완료하십시오.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_abd_guard_ds_actual_requires_mf ON public.abd_items_raw;
CREATE TRIGGER trg_abd_guard_ds_actual_requires_mf
  BEFORE INSERT OR UPDATE ON public.abd_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.abd_guard_ds_actual_requires_mf();

-- ============ MF 변경 이력 자동 기록 ============
CREATE OR REPLACE FUNCTION public.abd_log_mf_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE has_ds boolean;
BEGIN
  IF OLD.mf_check IS NOT DISTINCT FROM NEW.mf_check
     AND OLD.mf_types IS NOT DISTINCT FROM NEW.mf_types
     AND OLD.mf_reference IS NOT DISTINCT FROM NEW.mf_reference
     AND OLD.mf_revision IS NOT DISTINCT FROM NEW.mf_revision THEN
    RETURN NEW;
  END IF;

  has_ds := (NEW.r1_draft_start_actual IS NOT NULL
          OR NEW.r2_draft_start_actual IS NOT NULL
          OR NEW.r3_draft_start_actual IS NOT NULL);

  INSERT INTO public.abd_mf_change_log (item_id, before_value, after_value, after_ds, changed_by)
  VALUES (
    NEW.id,
    jsonb_build_object('mf_check', OLD.mf_check, 'mf_types', OLD.mf_types, 'mf_reference', OLD.mf_reference, 'mf_revision', OLD.mf_revision),
    jsonb_build_object('mf_check', NEW.mf_check, 'mf_types', NEW.mf_types, 'mf_reference', NEW.mf_reference, 'mf_revision', NEW.mf_revision),
    has_ds,
    auth.uid()
  );

  IF has_ds THEN
    NEW.mf_changed_after_ds := true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_abd_log_mf_change ON public.abd_items_raw;
CREATE TRIGGER trg_abd_log_mf_change
  BEFORE UPDATE ON public.abd_items_raw
  FOR EACH ROW EXECUTE FUNCTION public.abd_log_mf_change();

-- ============ 감사 위험도 (위험기반 표본선정용) ============
CREATE OR REPLACE FUNCTION public.abd_audit_risk_reasons(r public.abd_items_raw)
RETURNS text[] LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN coalesce(r.ocs_total, 0) >= 10 THEN 'OCS 코멘트 다수' END,
    CASE WHEN upper(coalesce(r.r1_response_result,'')) = 'C'
           OR upper(coalesce(r.r2_response_result,'')) = 'C'
           OR upper(coalesce(r.r3_response_result,'')) = 'C' THEN 'Code C 이력' END,
    CASE WHEN r.mf_changed_after_ds THEN 'DS 이후 MF 변경' END,
    CASE WHEN 'Site Verification' = ANY(coalesce(r.mf_types, '{}'::text[])) THEN 'Site Verification 기준' END,
    CASE WHEN r.is_reopened THEN '재오픈 이력' END
  ], NULL)
$$;
