
-- 1) 팀 × field_config 기반 기본 매핑 시드 (라벨을 source_header 기본값으로)
INSERT INTO public.abd_header_mappings (team, source_header, target_field, round_index, stage, plan_or_actual, is_custom, is_active, active, note)
SELECT t.team, f.label, f.field_key,
  CASE WHEN f.field_key ~ '^r([1-3])_' THEN (regexp_match(f.field_key, '^r([1-3])_'))[1]::int ELSE NULL END,
  CASE
    WHEN f.field_key ~ '_drafting_'   THEN 'draft'
    WHEN f.field_key ~ '_submission_' THEN 'submission'
    WHEN f.field_key ~ '_dar_'        THEN 'response'
    ELSE NULL END,
  CASE
    WHEN f.field_key ~ '_plan$'   THEN 'plan'
    WHEN f.field_key ~ '_actual$' THEN 'actual'
    ELSE NULL END,
  false, true, true,
  'auto-seeded from field_config'
FROM public.abd_field_config f
CROSS JOIN (VALUES ('MECH'),('ELEC'),('ARCH')) AS t(team)
ON CONFLICT (team, source_header) DO NOTHING;

-- 2) field_config INSERT 시 팀별 매핑 행 자동 생성
CREATE OR REPLACE FUNCTION public.sync_abd_field_config_to_mappings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.abd_header_mappings (team, source_header, target_field, round_index, stage, plan_or_actual, is_custom, is_active, active, note)
  SELECT t.team, NEW.label, NEW.field_key,
    CASE WHEN NEW.field_key ~ '^r([1-3])_' THEN (regexp_match(NEW.field_key, '^r([1-3])_'))[1]::int ELSE NULL END,
    CASE
      WHEN NEW.field_key ~ '_drafting_'   THEN 'draft'
      WHEN NEW.field_key ~ '_submission_' THEN 'submission'
      WHEN NEW.field_key ~ '_dar_'        THEN 'response'
      ELSE NULL END,
    CASE
      WHEN NEW.field_key ~ '_plan$'   THEN 'plan'
      WHEN NEW.field_key ~ '_actual$' THEN 'actual'
      ELSE NULL END,
    false, true, true,
    'auto-seeded from field_config'
  FROM (VALUES ('MECH'),('ELEC'),('ARCH')) AS t(team)
  ON CONFLICT (team, source_header) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_abd_field_config_insert_sync ON public.abd_field_config;
CREATE TRIGGER trg_abd_field_config_insert_sync
AFTER INSERT ON public.abd_field_config
FOR EACH ROW EXECUTE FUNCTION public.sync_abd_field_config_to_mappings();

-- 3) field_config DELETE 시 시스템(비-Custom) 매핑 행만 삭제
CREATE OR REPLACE FUNCTION public.cleanup_abd_mappings_on_field_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.abd_header_mappings
  WHERE target_field = OLD.field_key AND is_custom = false;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_abd_field_config_delete_cleanup ON public.abd_field_config;
CREATE TRIGGER trg_abd_field_config_delete_cleanup
AFTER DELETE ON public.abd_field_config
FOR EACH ROW EXECUTE FUNCTION public.cleanup_abd_mappings_on_field_delete();

-- 4) field_config UPDATE(label 변경) 시 자동 시드된 매핑의 source_header도 동기화
CREATE OR REPLACE FUNCTION public.sync_abd_field_config_label_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.label IS DISTINCT FROM OLD.label THEN
    UPDATE public.abd_header_mappings
    SET source_header = NEW.label
    WHERE target_field = NEW.field_key
      AND is_custom = false
      AND source_header = OLD.label;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_abd_field_config_update_sync ON public.abd_field_config;
CREATE TRIGGER trg_abd_field_config_update_sync
AFTER UPDATE ON public.abd_field_config
FOR EACH ROW EXECUTE FUNCTION public.sync_abd_field_config_label_update();
