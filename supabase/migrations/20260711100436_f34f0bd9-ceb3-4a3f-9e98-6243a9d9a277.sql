
-- 1) Rollback 메타컬럼 (Spare Part)
ALTER TABLE public.spare_parts_import_logs
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rollback_force boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS note text;

-- Rollback 메타컬럼 (Task Management)
ALTER TABLE public.task_management_import_logs
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rollback_force boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS note text;

-- 2) 원본 행 ↔ 배치 연결
ALTER TABLE public.spare_parts_raw
  ADD COLUMN IF NOT EXISTS source_import_log_id uuid REFERENCES public.spare_parts_import_logs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_spare_parts_raw_source_import_log
  ON public.spare_parts_raw(source_import_log_id);

ALTER TABLE public.task_management_raw
  ADD COLUMN IF NOT EXISTS source_import_log_id uuid REFERENCES public.task_management_import_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_tm_raw_source_import_log
  ON public.task_management_raw(source_import_log_id);
CREATE INDEX IF NOT EXISTS idx_tm_raw_active
  ON public.task_management_raw(is_active);

-- 3) 행 단위 임포트 결과 로그 (Spare Part)
CREATE TABLE IF NOT EXISTS public.spare_part_import_row_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.spare_parts_import_logs(id) ON DELETE CASCADE,
  raw_row_no integer,
  doc_ref text,
  action_taken text NOT NULL CHECK (action_taken IN ('inserted','updated','skipped','rejected')),
  reason_code text,
  reason_detail text,
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.spare_part_import_row_logs TO authenticated;
GRANT ALL ON public.spare_part_import_row_logs TO service_role;
ALTER TABLE public.spare_part_import_row_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp_row_logs read authenticated" ON public.spare_part_import_row_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sp_row_logs admin write" ON public.spare_part_import_row_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_super(auth.uid()));
CREATE POLICY "sp_row_logs admin delete" ON public.spare_part_import_row_logs
  FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_sp_row_logs_upload_id ON public.spare_part_import_row_logs(upload_id);

-- 행 단위 임포트 결과 로그 (Task Management)
CREATE TABLE IF NOT EXISTS public.task_management_import_row_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.task_management_import_logs(id) ON DELETE CASCADE,
  raw_row_no integer,
  discipline text,
  task_no text,
  action_taken text NOT NULL CHECK (action_taken IN ('inserted','updated','skipped','rejected')),
  reason_code text,
  reason_detail text,
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.task_management_import_row_logs TO authenticated;
GRANT ALL ON public.task_management_import_row_logs TO service_role;
ALTER TABLE public.task_management_import_row_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tm_row_logs read authenticated" ON public.task_management_import_row_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "tm_row_logs admin write" ON public.task_management_import_row_logs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tm_row_logs admin delete" ON public.task_management_import_row_logs
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS idx_tm_row_logs_upload_id ON public.task_management_import_row_logs(upload_id);

-- 4) Spare Part 필드 변경 로그
CREATE TABLE IF NOT EXISTS public.spare_part_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_ref text NOT NULL,
  changed_field text NOT NULL,
  old_value text,
  new_value text,
  change_source text NOT NULL DEFAULT 'excel_import',
  upload_id uuid REFERENCES public.spare_parts_import_logs(id) ON DELETE SET NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.spare_part_change_log TO authenticated;
GRANT ALL ON public.spare_part_change_log TO service_role;
ALTER TABLE public.spare_part_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp_change_log read authenticated" ON public.spare_part_change_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sp_change_log auth write" ON public.spare_part_change_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "sp_change_log admin delete" ON public.spare_part_change_log
  FOR DELETE TO authenticated USING (public.is_admin_or_super(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_sp_change_log_upload_id ON public.spare_part_change_log(upload_id);
CREATE INDEX IF NOT EXISTS idx_sp_change_log_docref_field ON public.spare_part_change_log(doc_ref, changed_field, changed_at DESC);

-- Task Management 상태이력에 배치 연결
ALTER TABLE public.task_management_status_history
  ADD COLUMN IF NOT EXISTS upload_id uuid REFERENCES public.task_management_import_logs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tmsh_upload_id ON public.task_management_status_history(upload_id);

-- 5) RPC: Spare Part Rollback Preview
CREATE OR REPLACE FUNCTION public.preview_rollback_spare_part_import(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _insert_count int := 0;
  _update_count int := 0;
  _conflict_count int := 0;
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT count(*) INTO _insert_count
    FROM public.spare_parts_raw
   WHERE source_import_log_id = _batch_id AND is_active = true;

  SELECT count(*) INTO _update_count
    FROM public.spare_part_change_log cl
    JOIN public.spare_parts_raw d ON d.doc_ref = cl.doc_ref
   WHERE cl.upload_id = _batch_id
     AND cl.change_source = 'excel_import'
     AND d.source_import_log_id IS DISTINCT FROM _batch_id;

  WITH batch_changes AS (
    SELECT cl.doc_ref, cl.changed_field, cl.changed_at
      FROM public.spare_part_change_log cl
      JOIN public.spare_parts_raw d ON d.doc_ref = cl.doc_ref
     WHERE cl.upload_id = _batch_id
       AND cl.change_source = 'excel_import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
  )
  SELECT count(*) INTO _conflict_count
    FROM batch_changes bc
   WHERE EXISTS (
     SELECT 1 FROM public.spare_part_change_log later
      WHERE later.doc_ref = bc.doc_ref
        AND later.changed_field = bc.changed_field
        AND later.changed_at > bc.changed_at
        AND later.upload_id IS DISTINCT FROM _batch_id
   );

  RETURN jsonb_build_object(
    'insert_count', _insert_count,
    'update_count', _update_count,
    'conflict_count', _conflict_count
  );
END;
$$;

-- RPC: Spare Part Rollback
CREATE OR REPLACE FUNCTION public.rollback_spare_part_import(_batch_id uuid, _force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid := auth.uid();
  _restored int := 0;
  _deleted int := 0;
  _skipped int := 0;
  _rec record;
  _has_later boolean;
BEGIN
  IF NOT public.is_admin_or_super(_user) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.spare_parts_import_logs WHERE id = _batch_id) THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  FOR _rec IN
    SELECT cl.doc_ref, cl.changed_field, cl.old_value, cl.changed_at
      FROM public.spare_part_change_log cl
      JOIN public.spare_parts_raw d ON d.doc_ref = cl.doc_ref
     WHERE cl.upload_id = _batch_id
       AND cl.change_source = 'excel_import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
     ORDER BY cl.changed_at ASC
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.spare_part_change_log later
       WHERE later.doc_ref = _rec.doc_ref
         AND later.changed_field = _rec.changed_field
         AND later.changed_at > _rec.changed_at
         AND later.upload_id IS DISTINCT FROM _batch_id
    ) INTO _has_later;

    IF _has_later AND NOT _force THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format(
        'UPDATE public.spare_parts_raw SET %I = $1, updated_by = $2, updated_at = now() WHERE doc_ref = $3',
        _rec.changed_field
      ) USING _rec.old_value, _user, _rec.doc_ref;

      INSERT INTO public.spare_part_change_log(doc_ref, changed_field, old_value, new_value, change_source, upload_id, changed_by)
      VALUES (_rec.doc_ref, _rec.changed_field, NULL, _rec.old_value, 'rollback', _batch_id, _user);

      _restored := _restored + 1;
    EXCEPTION WHEN others THEN
      _skipped := _skipped + 1;
    END;
  END LOOP;

  WITH del AS (
    UPDATE public.spare_parts_raw
       SET is_active = false, updated_by = _user, updated_at = now()
     WHERE source_import_log_id = _batch_id AND is_active = true
    RETURNING doc_ref
  )
  SELECT count(*) INTO _deleted FROM del;

  UPDATE public.spare_parts_import_logs
     SET status = 'rolled_back',
         rolled_back_at = now(),
         rolled_back_by = _user,
         rollback_force = _force,
         note = COALESCE(note || E'\n', '') || format('Rolled back at %s by %s (force=%s)', now(), _user, _force)
   WHERE id = _batch_id;

  RETURN jsonb_build_object('restored_count', _restored, 'deleted_count', _deleted, 'skipped_count', _skipped);
END;
$$;

-- RPC: Spare Part Delete Batch
CREATE OR REPLACE FUNCTION public.delete_spare_part_import_batch(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid := auth.uid();
  _deleted int := 0;
BEGIN
  IF NOT public.is_admin_or_super(_user) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  WITH del AS (
    DELETE FROM public.spare_parts_raw WHERE source_import_log_id = _batch_id RETURNING doc_ref
  )
  SELECT count(*) INTO _deleted FROM del;

  DELETE FROM public.spare_part_change_log WHERE upload_id = _batch_id;
  DELETE FROM public.spare_part_import_row_logs WHERE upload_id = _batch_id;
  DELETE FROM public.spare_parts_import_logs WHERE id = _batch_id;

  RETURN jsonb_build_object('deleted_rows', _deleted);
END;
$$;

-- RPC: Task Management Rollback Preview
CREATE OR REPLACE FUNCTION public.preview_rollback_task_management_import(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _insert_count int := 0;
  _update_count int := 0;
  _conflict_count int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT count(*) INTO _insert_count
    FROM public.task_management_raw
   WHERE source_import_log_id = _batch_id AND is_active = true;

  SELECT count(*) INTO _update_count
    FROM public.task_management_status_history h
    JOIN public.task_management_raw d
      ON d.discipline = h.discipline AND d.task_no = h.task_no
   WHERE h.upload_id = _batch_id
     AND h.source = 'import'
     AND d.source_import_log_id IS DISTINCT FROM _batch_id;

  WITH batch_changes AS (
    SELECT h.discipline, h.task_no, h.field, h.changed_at
      FROM public.task_management_status_history h
      JOIN public.task_management_raw d
        ON d.discipline = h.discipline AND d.task_no = h.task_no
     WHERE h.upload_id = _batch_id
       AND h.source = 'import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
  )
  SELECT count(*) INTO _conflict_count
    FROM batch_changes bc
   WHERE EXISTS (
     SELECT 1 FROM public.task_management_status_history later
      WHERE later.discipline = bc.discipline
        AND later.task_no = bc.task_no
        AND later.field = bc.field
        AND later.changed_at > bc.changed_at
        AND later.upload_id IS DISTINCT FROM _batch_id
   );

  RETURN jsonb_build_object(
    'insert_count', _insert_count,
    'update_count', _update_count,
    'conflict_count', _conflict_count
  );
END;
$$;

-- RPC: Task Management Rollback
CREATE OR REPLACE FUNCTION public.rollback_task_management_import(_batch_id uuid, _force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid := auth.uid();
  _restored int := 0;
  _deleted int := 0;
  _skipped int := 0;
  _rec record;
  _has_later boolean;
  _parent record;
BEGIN
  IF NOT public.has_role(_user,'admin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.task_management_import_logs WHERE id = _batch_id) THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  FOR _rec IN
    SELECT h.discipline, h.task_no, h.field, h.old_value, h.changed_at
      FROM public.task_management_status_history h
      JOIN public.task_management_raw d
        ON d.discipline = h.discipline AND d.task_no = h.task_no
     WHERE h.upload_id = _batch_id
       AND h.source = 'import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
     ORDER BY h.changed_at ASC
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.task_management_status_history later
       WHERE later.discipline = _rec.discipline
         AND later.task_no = _rec.task_no
         AND later.field = _rec.field
         AND later.changed_at > _rec.changed_at
         AND later.upload_id IS DISTINCT FROM _batch_id
    ) INTO _has_later;

    IF _has_later AND NOT _force THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      -- 필드 타입에 따라 캐스팅: 텍스트 컬럼과 숫자/날짜 컬럼 혼재
      IF _rec.field IN ('plan_start','plan_end','actual_start','forecast_end') THEN
        EXECUTE format('UPDATE public.task_management_raw SET %I = NULLIF($1, '''')::date WHERE discipline=$2 AND task_no=$3', _rec.field)
          USING _rec.old_value, _rec.discipline, _rec.task_no;
      ELSIF _rec.field IN ('actual_progress','plan_progress') THEN
        EXECUTE format('UPDATE public.task_management_raw SET %I = NULLIF($1, '''')::numeric WHERE discipline=$2 AND task_no=$3', _rec.field)
          USING _rec.old_value, _rec.discipline, _rec.task_no;
      ELSIF _rec.field IN ('slip_days','plan_days') THEN
        EXECUTE format('UPDATE public.task_management_raw SET %I = NULLIF($1, '''')::int WHERE discipline=$2 AND task_no=$3', _rec.field)
          USING _rec.old_value, _rec.discipline, _rec.task_no;
      ELSE
        EXECUTE format('UPDATE public.task_management_raw SET %I = $1 WHERE discipline=$2 AND task_no=$3', _rec.field)
          USING _rec.old_value, _rec.discipline, _rec.task_no;
      END IF;

      INSERT INTO public.task_management_status_history(discipline, task_no, field, old_value, new_value, source, changed_by, upload_id)
      VALUES (_rec.discipline, _rec.task_no, _rec.field, NULL, _rec.old_value, 'system', _user, _batch_id);

      _restored := _restored + 1;
    EXCEPTION WHEN others THEN
      _skipped := _skipped + 1;
    END;
  END LOOP;

  WITH del AS (
    UPDATE public.task_management_raw
       SET is_active = false
     WHERE source_import_log_id = _batch_id AND is_active = true
    RETURNING discipline, parent_task_no
  )
  SELECT count(*) INTO _deleted FROM del;

  -- 영향 받은 parent 재롤업
  FOR _parent IN
    SELECT DISTINCT discipline, parent_task_no
      FROM public.task_management_raw
     WHERE source_import_log_id = _batch_id
       AND parent_task_no IS NOT NULL
  LOOP
    PERFORM public.update_task_summary(_parent.discipline, _parent.parent_task_no);
  END LOOP;

  UPDATE public.task_management_import_logs
     SET status = 'rolled_back',
         rolled_back_at = now(),
         rolled_back_by = _user,
         rollback_force = _force,
         note = COALESCE(note || E'\n', '') || format('Rolled back at %s by %s (force=%s)', now(), _user, _force)
   WHERE id = _batch_id;

  RETURN jsonb_build_object('restored_count', _restored, 'deleted_count', _deleted, 'skipped_count', _skipped);
END;
$$;

-- RPC: Task Management Delete Batch
CREATE OR REPLACE FUNCTION public.delete_task_management_import_batch(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid := auth.uid();
  _deleted int := 0;
BEGIN
  IF NOT public.has_role(_user,'admin') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  WITH del AS (
    DELETE FROM public.task_management_raw WHERE source_import_log_id = _batch_id RETURNING id
  )
  SELECT count(*) INTO _deleted FROM del;

  DELETE FROM public.task_management_status_history WHERE upload_id = _batch_id;
  DELETE FROM public.task_management_import_row_logs WHERE upload_id = _batch_id;
  DELETE FROM public.task_management_import_logs WHERE id = _batch_id;

  RETURN jsonb_build_object('deleted_rows', _deleted);
END;
$$;
