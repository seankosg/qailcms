
CREATE OR REPLACE FUNCTION public.trg_abd_change_log_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _watch text[] := ARRAY[
    'plot','sl_no','dis','service','doc_ax','doc_axx','doc_nn1','doc_n','doc_nn2',
    'document_title','abd_number','abd_ocs_no','batch_no','hdec_pic_name','hdec_eng_name',
    'latest_rev','latest_status','approval_date',
    'r1_draft_start_plan','r1_draft_start_actual','r1_draft_finish_plan','r1_draft_finish_actual','r1_response_result',
    'r2_draft_start_plan','r2_draft_start_actual','r2_draft_finish_plan','r2_draft_finish_actual','r2_response_result',
    'r3_draft_start_plan','r3_draft_start_actual','r3_draft_finish_plan','r3_draft_finish_actual','r3_response_result',
    'r1_submission_plan','r1_submission_actual','r1_dar_plan','r1_dar_actual',
    'r2_submission_plan','r2_submission_actual','r2_dar_plan','r2_dar_actual',
    'r3_submission_plan','r3_submission_actual','r3_dar_plan','r3_dar_actual',
    'is_active','field_mismatch'
  ];
  _f text; _old jsonb; _new jsonb; _source text; _upload uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  _old := to_jsonb(OLD); _new := to_jsonb(NEW);
  _source := coalesce(current_setting('app.change_source', true), 'manual');
  BEGIN
    _upload := NULLIF(current_setting('app.upload_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    _upload := NULL;
  END;
  FOREACH _f IN ARRAY _watch LOOP
    IF (_old->>_f) IS DISTINCT FROM (_new->>_f) THEN
      INSERT INTO public.abd_change_log(
        abd_item_id, team, abd_number, field, old_value, new_value,
        source, upload_id, changed_by
      ) VALUES (
        NEW.id, NEW.team, NEW.abd_number, _f,
        _old->>_f, _new->>_f,
        _source, _upload, auth.uid()
      );
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;
