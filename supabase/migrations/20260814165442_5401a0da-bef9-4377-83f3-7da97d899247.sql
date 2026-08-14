-- ── 1. 주시가 권한을 만들지 못하게 한다 ──────────────────────
-- watcher 갈래를 뺀 자격 술어. thread_can_see 는 건드리지 않는다.
CREATE OR REPLACE FUNCTION public.thread_can_watch(
  _module text, _item_id uuid, _stage_code text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_thread uuid; z uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  IF public.thread_is_admin(uid) THEN RETURN true; END IF;
  IF uid IN (
      coalesce(public.thread_assignee_of(_module,_item_id,_stage_code,'pic'), z),
      coalesce(public.thread_assignee_of(_module,_item_id,_stage_code,'eng'), z)
  ) THEN RETURN true; END IF;
  SELECT id INTO v_thread FROM public.module_threads
   WHERE module=_module AND item_id=_item_id AND stage_code=_stage_code;
  IF v_thread IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.module_threads t WHERE t.id=v_thread AND t.created_by=uid) THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.module_thread_messages m
     WHERE m.thread_id=v_thread AND (m.author_user_id=uid OR m.to_user_id=uid)
  );
END $$;

CREATE OR REPLACE FUNCTION public.thread_set_watch(
  _module text, _item_id uuid, _stage_code text, _on boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_thread uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF _on THEN
    IF NOT public.thread_can_watch(_module,_item_id,_stage_code) THEN
      RAISE EXCEPTION '이 단계의 담당자·참여자·관리자만 주시할 수 있습니다';
    END IF;
    v_thread := public.thread_ensure(_module,_item_id,_stage_code);
    INSERT INTO public.module_thread_watchers(thread_id,user_id)
    VALUES (v_thread,uid) ON CONFLICT DO NOTHING;
  ELSE
    SELECT id INTO v_thread FROM public.module_threads
      WHERE module=_module AND item_id=_item_id AND stage_code=_stage_code;
    IF v_thread IS NOT NULL THEN
      DELETE FROM public.module_thread_watchers WHERE thread_id=v_thread AND user_id=uid;
    END IF;
  END IF;
  RETURN jsonb_build_object('watched', coalesce(_on,false), 'thread_id', v_thread);
END $$;

GRANT EXECUTE ON FUNCTION public.thread_can_watch(text,uuid,text) TO authenticated;

-- ── 2. 롤백: DELETE 경로에도 나중 변경 검사 ──────────────────
CREATE OR REPLACE FUNCTION public.preview_rollback_spl_import(_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _ins int := 0; _upd int := 0; _conflict int := 0; _ins_conflict int := 0;
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

  -- 이 배치가 만든 행 중, 그 뒤에 사람이 손댄 행 (지우면 작업이 사라진다)
  SELECT count(*) INTO _ins_conflict
    FROM public.spl_change_log cl
   WHERE cl.batch_id = _batch_id AND cl.action = 'insert' AND cl.source LIKE '%import%'
     AND cl.table_name IN ('spl_items','spl_stage_progress')
     AND EXISTS (
       SELECT 1 FROM public.spl_change_log later
        WHERE later.row_id = cl.row_id
          AND later.changed_at > cl.changed_at
          AND later.batch_id IS DISTINCT FROM _batch_id
     );

  RETURN jsonb_build_object(
    'insert_count', _ins,
    'update_count', _upd,
    'conflict_count', _conflict + _ins_conflict
  );
END $function$;

CREATE OR REPLACE FUNCTION public.rollback_spl_import(_batch_id uuid, _force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid(); _restored int := 0; _deleted int := 0; _skipped int := 0;
  _rec record; _has_later boolean; _type text; _st text; _rb_at timestamptz; _rb_by uuid;
BEGIN
  IF NOT public.can_rollback_import_batch(_batch_id, 'spl') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT status, rolled_back_at, rolled_back_by INTO _st, _rb_at, _rb_by
    FROM public.spl_import_logs WHERE id = _batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF _st = 'rolled_back' THEN
    RAISE EXCEPTION '이미 롤백된 배치입니다 (rolled_back_at=%, rolled_back_by=%)', _rb_at, _rb_by;
  END IF;

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

  -- 이 배치가 새로 만든 것: 아이템은 비활성화, 단계 행은 제거.
  -- 그 뒤에 사람이 손댄 행은 _force 없이는 건드리지 않는다.
  FOR _rec IN
    SELECT cl.table_name, cl.row_id, cl.changed_at
      FROM public.spl_change_log cl
     WHERE cl.batch_id = _batch_id AND cl.action = 'insert' AND cl.source LIKE '%import%'
       AND cl.table_name IN ('spl_items','spl_stage_progress')
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.spl_change_log later
       WHERE later.row_id = _rec.row_id
         AND later.changed_at > _rec.changed_at
         AND later.batch_id IS DISTINCT FROM _batch_id
    ) INTO _has_later;
    IF _has_later AND NOT _force THEN _skipped := _skipped + 1; CONTINUE; END IF;

    IF _rec.table_name = 'spl_items' THEN
      UPDATE public.spl_items
         SET is_active = false, updated_by = _user, updated_at = now()
       WHERE id = _rec.row_id AND is_active = true;
      IF FOUND THEN _deleted := _deleted + 1; END IF;
    ELSE
      DELETE FROM public.spl_stage_progress WHERE id = _rec.row_id;
      IF FOUND THEN _deleted := _deleted + 1; END IF;
    END IF;
  END LOOP;

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