CREATE OR REPLACE FUNCTION public.abd_auto_owner_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_name text;
  old_name text;
BEGIN
  new_name := COALESCE(NULLIF(NEW.hdec_pic_name, ''), NEW.hdec_eng_name);
  IF TG_OP = 'UPDATE' THEN
    old_name := COALESCE(NULLIF(OLD.hdec_pic_name, ''), OLD.hdec_eng_name);
    IF NEW.owner_user_id IS NOT NULL AND COALESCE(new_name,'') = COALESCE(old_name,'') THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.owner_user_id := public.resolve_owner_by_name(new_name);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_abd_change_log_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src text; uid uuid;
  f text;
  old_v text; new_v text;
  fields text[] := ARRAY[
    'hdec_pic_name','hdec_eng_name','document_title','latest_rev','latest_status','approval_date',
    'r1_drafting_plan','r1_drafting_actual','r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_drafting_plan','r2_drafting_actual','r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_drafting_plan','r3_drafting_actual','r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
    'is_active'
  ];
BEGIN
  BEGIN src := coalesce(current_setting('app.change_source', true), 'manual'); EXCEPTION WHEN others THEN src := 'manual'; END;
  BEGIN uid := nullif(current_setting('app.change_user', true), '')::uuid; EXCEPTION WHEN others THEN uid := null; END;

  FOREACH f IN ARRAY fields LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', f, f) INTO old_v, new_v USING OLD, NEW;
    IF old_v IS DISTINCT FROM new_v THEN
      INSERT INTO public.abd_change_log(abd_item_id, team, abd_number, field, old_value, new_value, source, changed_by, upload_id)
      VALUES (NEW.id, NEW.team, NEW.abd_number, f, old_v, new_v, src, uid,
              CASE WHEN src = 'import' THEN NEW.source_import_log_id ELSE null END);
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;