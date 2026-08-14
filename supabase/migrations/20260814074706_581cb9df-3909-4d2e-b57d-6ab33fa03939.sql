ALTER TABLE public.spl_import_logs
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS rolled_back_by uuid,
  ADD COLUMN IF NOT EXISTS rollback_force boolean NOT NULL DEFAULT false;

-- 권한 함수에 SPL 소유자 갈래 추가 (ABD 와 같은 기준)
CREATE OR REPLACE FUNCTION public.can_rollback_import_batch(_batch_id uuid, _kind text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _owner uuid; _module text;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  _module := CASE _kind
    WHEN 'task_management' THEN 'TM'
    WHEN 'defect' THEN 'SM'
    WHEN 'abd' THEN 'ABD'
    WHEN 'spl' THEN 'SPL'
    WHEN 'wrt' THEN 'WRT'
    ELSE NULL END;
  IF _kind = 'spare_part' THEN
    IF public.is_admin_or_super(_uid) THEN RETURN true; END IF;
  ELSIF _module IS NOT NULL AND public.rcl_max_scope(_uid, _module, 'delete') = 'other_team' THEN
    RETURN true;
  END IF;
  IF _kind = 'spare_part' THEN
    SELECT executed_by INTO _owner FROM public.spare_parts_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'task_management' THEN
    SELECT imported_by INTO _owner FROM public.task_management_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'defect' THEN
    SELECT imported_by INTO _owner FROM public.defect_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'abd' THEN
    SELECT imported_by INTO _owner FROM public.abd_import_logs WHERE id = _batch_id;
  ELSIF _kind = 'spl' THEN
    SELECT imported_by INTO _owner FROM public.spl_import_logs WHERE id = _batch_id;
  ELSE
    RETURN false;
  END IF;
  RETURN _owner IS NOT NULL AND _owner = _uid;
END $function$;

CREATE OR REPLACE FUNCTION public.preview_rollback_spl_import(_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _ins int := 0; _upd int := 0; _conflict int := 0;
BEGIN
  IF NOT public.can_rollback_import_batch(_batch_id, 'spl') THEN RAISE EXCEPTION 'Permission denied'; END IF;

  SELECT count(*) INTO _ins
    FROM public.spl_change_log cl
   WHERE cl.batch_id = _batch_id AND cl.action = 'insert' AND cl.source LIKE '%import%';

  SELECT count(*) INTO _upd
    FROM public.spl_change_log cl
   WHERE cl.batch_id = _batch_id AND cl.action = 'update' AND cl.source LIKE '%import%'
     AND cl.column_name IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.spl_change_log ins
        WHERE ins.batch_id = _batch_id AND ins.action = 'insert'
          AND ins.row_id = cl.row_id
     );

  SELECT count(*) INTO _conflict
    FROM public.spl_change_log cl
   WHERE cl.batch_id = _batch_id AND cl.action = 'update' AND cl.source LIKE '%import%'
     AND cl.column_name IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.spl_change_log ins
        WHERE ins.batch_id = _batch_id AND ins.action = 'insert' AND ins.row_id = cl.row_id
     )
     AND EXISTS (
       SELECT 1 FROM public.spl_change_log later
        WHERE later.row_id = cl.row_id
          AND later.column_name = cl.column_name
          AND later.changed_at > cl.changed_at
          AND later.batch_id IS DISTINCT FROM _batch_id
     );

  RETURN jsonb_build_object('insert_count', _ins, 'update_count', _upd, 'conflict_count', _conflict);
END $function$;

CREATE OR REPLACE FUNCTION public.rollback_spl_import(_batch_id uuid, _force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid(); _restored int := 0; _deleted int := 0; _skipped int := 0;
  _rec record; _has_later boolean; _type text;
BEGIN
  IF NOT public.can_rollback_import_batch(_batch_id, 'spl') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.spl_import_logs WHERE id = _batch_id) THEN RAISE EXCEPTION 'Batch not found'; END IF;

  FOR _rec IN
    SELECT cl.table_name, cl.row_id, cl.item_id, cl.stage_code, cl.column_name, cl.old_value, cl.changed_at
      FROM public.spl_change_log cl
     WHERE cl.batch_id = _batch_id AND cl.action = 'update' AND cl.source LIKE '%import%'
       AND cl.column_name IS NOT NULL
       AND cl.table_name IN ('spl_items','spl_stage_progress')
       AND NOT EXISTS (
         SELECT 1 FROM public.spl_change_log ins
          WHERE ins.batch_id = _batch_id AND ins.action = 'insert' AND ins.row_id = cl.row_id
       )
     ORDER BY cl.changed_at ASC
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.spl_change_log later
       WHERE later.row_id = _rec.row_id
         AND later.column_name = _rec.column_name
         AND later.changed_at > _rec.changed_at
         AND later.batch_id IS DISTINCT FROM _batch_id
    ) INTO _has_later;
    IF _has_later AND NOT _force THEN _skipped := _skipped + 1; CONTINUE; END IF;

    SELECT data_type INTO _type
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = _rec.table_name AND column_name = _rec.column_name;
    IF _type IS NULL THEN _skipped := _skipped + 1; CONTINUE; END IF;

    BEGIN
      IF _type = 'date' THEN
        EXECUTE format('UPDATE public.%I SET %I = NULLIF($1, '''')::date WHERE id = $2', _rec.table_name, _rec.column_name)
          USING _rec.old_value, _rec.row_id;
      ELSIF _type = 'boolean' THEN
        EXECUTE format('UPDATE public.%I SET %I = NULLIF($1, '''')::boolean WHERE id = $2', _rec.table_name, _rec.column_name)
          USING _rec.old_value, _rec.row_id;
      ELSIF _type = 'integer' THEN
        EXECUTE format('UPDATE public.%I SET %I = NULLIF($1, '''')::integer WHERE id = $2', _rec.table_name, _rec.column_name)
          USING _rec.old_value, _rec.row_id;
      ELSE
        EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2', _rec.table_name, _rec.column_name)
          USING _rec.old_value, _rec.row_id;
      END IF;

      INSERT INTO public.spl_change_log(table_name, row_id, item_id, stage_code, action, column_name, old_value, new_value, source, batch_id, changed_by)
      VALUES (_rec.table_name, _rec.row_id, _rec.item_id, _rec.stage_code, 'update', _rec.column_name, NULL, _rec.old_value, 'rollback', _batch_id, _user);
      _restored := _restored + 1;
    EXCEPTION WHEN others THEN _skipped := _skipped + 1;
    END;
  END LOOP;

  -- 이 배치가 새로 만든 것: 아이템은 비활성화, 단계 행은 제거
  WITH del AS (
    UPDATE public.spl_items i
       SET is_active = false, updated_by = _user, updated_at = now()
     WHERE i.is_active = true
       AND i.id IN (
         SELECT cl.row_id FROM public.spl_change_log cl
          WHERE cl.batch_id = _batch_id AND cl.action = 'insert'
            AND cl.source LIKE '%import%' AND cl.table_name = 'spl_items'
       )
    RETURNING i.id
  ) SELECT count(*) INTO _deleted FROM del;

  WITH dels AS (
    DELETE FROM public.spl_stage_progress sp
     WHERE sp.id IN (
       SELECT cl.row_id FROM public.spl_change_log cl
        WHERE cl.batch_id = _batch_id AND cl.action = 'insert'
          AND cl.source LIKE '%import%' AND cl.table_name = 'spl_stage_progress'
     )
    RETURNING sp.id
  ) SELECT _deleted + count(*) INTO _deleted FROM dels;

  UPDATE public.spl_import_logs
     SET status = 'rolled_back', rolled_back_at = now(), rolled_back_by = _user, rollback_force = _force,
         note = coalesce(note || E'\n','') || format('Rolled back at %s by %s (force=%s)', now(), _user, _force)
   WHERE id = _batch_id;

  RETURN jsonb_build_object('restored_count', _restored, 'deleted_count', _deleted, 'skipped_count', _skipped);
END $function$;

REVOKE ALL ON FUNCTION public.preview_rollback_spl_import(uuid) FROM public;
REVOKE ALL ON FUNCTION public.rollback_spl_import(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.preview_rollback_spl_import(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_spl_import(uuid, boolean) TO authenticated;