CREATE OR REPLACE FUNCTION public.delete_defect_import_batch(_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _deleted int := 0;
  _ids uuid[];
BEGIN
  IF public.rcl_max_scope(auth.uid(),'SM','delete') IS DISTINCT FROM 'other_team' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  WITH del AS (
    DELETE FROM public.defect_items_raw WHERE source_import_log_id = _batch_id RETURNING id
  )
  SELECT count(*), coalesce(array_agg(id), '{}'::uuid[]) INTO _deleted, _ids FROM del;

  DELETE FROM public.defect_status_history
   WHERE upload_id = _batch_id
      OR defect_raw_id = ANY(_ids);
  DELETE FROM public.defect_import_row_logs WHERE upload_id = _batch_id;
  DELETE FROM public.defect_import_logs WHERE id = _batch_id;

  RETURN jsonb_build_object('deleted_rows', _deleted);
END;
$function$;