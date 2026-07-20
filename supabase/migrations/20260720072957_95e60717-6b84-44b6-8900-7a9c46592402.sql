
CREATE OR REPLACE FUNCTION public.can_rollback_import_batch(_batch_id uuid, _kind text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  IF public.is_admin_or_super(_uid) THEN RETURN true; END IF;
  IF _kind = 'spare_part' THEN
    SELECT executed_by INTO _owner FROM public.spare_parts_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'task_management' THEN
    SELECT imported_by INTO _owner FROM public.task_management_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'defect' THEN
    SELECT imported_by INTO _owner FROM public.defect_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'abd' THEN
    SELECT imported_by INTO _owner FROM public.abd_import_logs WHERE id = _batch_id;
  ELSE
    RETURN false;
  END IF;
  RETURN _owner IS NOT NULL AND _owner = _uid;
END $$;

GRANT EXECUTE ON FUNCTION public.can_rollback_import_batch(uuid, text) TO authenticated;

DO $mig$
DECLARE
  _rec record;
  _def text;
  _kind text;
  _pairs text[][] := ARRAY[
    ['preview_rollback_spare_part_import','spare_part'],
    ['rollback_spare_part_import','spare_part'],
    ['preview_rollback_task_management_import','task_management'],
    ['rollback_task_management_import','task_management'],
    ['preview_rollback_defect_import','defect'],
    ['rollback_defect_import','defect'],
    ['preview_rollback_abd_import','abd'],
    ['rollback_abd_import','abd']
  ];
  i int;
BEGIN
  FOR i IN 1..array_length(_pairs,1) LOOP
    FOR _rec IN
      SELECT oid FROM pg_proc
       WHERE proname = _pairs[i][1] AND pronamespace = 'public'::regnamespace
    LOOP
      _def := pg_get_functiondef(_rec.oid);
      _kind := _pairs[i][2];
      -- Replace the admin-only guard with a broader owner+admin guard.
      _def := replace(
        _def,
        'IF NOT public.is_admin_or_super(auth.uid()) THEN',
        'IF NOT public.can_rollback_import_batch(_batch_id, ' || quote_literal(_kind) || ') THEN'
      );
      _def := replace(
        _def,
        'IF NOT public.is_admin_or_super(_user) THEN',
        'IF NOT public.can_rollback_import_batch(_batch_id, ' || quote_literal(_kind) || ') THEN'
      );
      EXECUTE _def;
    END LOOP;
  END LOOP;
END $mig$;
