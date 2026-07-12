
-- 1. 신규 컬럼 추가
ALTER TABLE public.task_management_raw
  ADD COLUMN IF NOT EXISTS actual_finish date,
  ADD COLUMN IF NOT EXISTS actual_duration integer;

-- 2. 이력 트리거 갱신 (actual_finish, actual_duration 포함)
CREATE OR REPLACE FUNCTION public.trg_task_history_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  src text;
  uid uuid;
begin
  begin
    src := coalesce(current_setting('app.change_source', true), 'manual');
  exception when others then src := 'manual';
  end;
  begin
    uid := nullif(current_setting('app.change_user', true), '')::uuid;
  exception when others then uid := null;
  end;

  if new.actual_progress is distinct from old.actual_progress then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'actual_progress',
      old.actual_progress::text, new.actual_progress::text, src, uid);
  end if;
  if new.plan_progress is distinct from old.plan_progress then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'plan_progress',
      old.plan_progress::text, new.plan_progress::text, src, uid);
  end if;
  if new.plan_start is distinct from old.plan_start then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'plan_start',
      old.plan_start::text, new.plan_start::text, src, uid);
  end if;
  if new.plan_end is distinct from old.plan_end then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'plan_end',
      old.plan_end::text, new.plan_end::text, src, uid);
  end if;
  if new.actual_start is distinct from old.actual_start then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'actual_start',
      old.actual_start::text, new.actual_start::text, src, uid);
  end if;
  if new.actual_finish is distinct from old.actual_finish then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'actual_finish',
      old.actual_finish::text, new.actual_finish::text, src, uid);
  end if;
  if new.actual_duration is distinct from old.actual_duration then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'actual_duration',
      old.actual_duration::text, new.actual_duration::text, src, uid);
  end if;
  if new.forecast_end is distinct from old.forecast_end then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'forecast_end',
      old.forecast_end::text, new.forecast_end::text, src, uid);
  end if;
  if new.slip_days is distinct from old.slip_days then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'slip_days',
      old.slip_days::text, new.slip_days::text, src, uid);
  end if;
  if new.auto_judgment is distinct from old.auto_judgment then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'auto_judgment',
      old.auto_judgment, new.auto_judgment, src, uid);
  end if;
  if new.status_manual is distinct from old.status_manual then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'status_manual',
      old.status_manual, new.status_manual, src, uid);
  end if;
  return new;
end;
$function$;

-- 3. actual_duration 자동 계산 트리거
CREATE OR REPLACE FUNCTION public.trg_task_actual_duration_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.actual_start is null then
    new.actual_duration := null;
  elsif new.actual_finish is not null then
    new.actual_duration := (new.actual_finish - new.actual_start) + 1;
  else
    new.actual_duration := (current_date - new.actual_start) + 1;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_task_actual_duration ON public.task_management_raw;
CREATE TRIGGER trg_task_actual_duration
BEFORE INSERT OR UPDATE OF actual_start, actual_finish ON public.task_management_raw
FOR EACH ROW EXECUTE FUNCTION public.trg_task_actual_duration_fn();

-- 4. 부모 롤업 함수 갱신 (actual_finish 집계, actual_duration 재계산)
CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _parent_task_no text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  agg record;
  worst text;
  rank_order text[] := array['위험','지연','주의','정상','완료'];
  _ad integer;
begin
  if _parent_task_no is null then return; end if;

  select
    sum(coalesce(actual_progress,0) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as ap,
    sum(coalesce(plan_progress,0) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as pp,
    min(plan_start) as ps,
    max(plan_end) as pe,
    sum(coalesce(plan_days, greatest(coalesce(plan_end - plan_start, 0) + 1, 1))) as pd,
    min(actual_start) as as_,
    max(actual_finish) as af_,
    bool_and(actual_finish is not null) as all_finished,
    max(forecast_end) as fe,
    max(slip_days) as sd,
    count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline
    and parent_task_no = _parent_task_no
    and level = 'child';

  if agg.cnt = 0 then return; end if;

  -- actual_duration 계산 (부모용)
  if agg.as_ is null then
    _ad := null;
  elsif agg.all_finished and agg.af_ is not null then
    _ad := (agg.af_ - agg.as_) + 1;
  else
    _ad := (current_date - agg.as_) + 1;
  end if;

  -- worst auto_judgment
  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and parent_task_no=_parent_task_no
      and level='child' and auto_judgment = x.r
  )
  order by idx
  limit 1;

  update public.task_management_raw
     set actual_progress = round(coalesce(agg.ap,0)::numeric, 4),
         plan_progress = round(coalesce(agg.pp,0)::numeric, 4),
         progress_variance = round(coalesce(agg.ap,0)::numeric - coalesce(agg.pp,0)::numeric, 4),
         plan_start = agg.ps,
         plan_end = agg.pe,
         plan_days = agg.pd,
         actual_start = agg.as_,
         actual_finish = case when agg.all_finished then agg.af_ else null end,
         actual_duration = _ad,
         forecast_end = agg.fe,
         slip_days = agg.sd,
         auto_judgment = coalesce(worst, auto_judgment),
         is_rollup = true
   where discipline = _discipline
     and task_no = _parent_task_no
     and level = 'parent';
end;
$function$;

-- 5. Rollback 함수에 actual_finish/actual_duration 처리 추가
CREATE OR REPLACE FUNCTION public.rollback_task_management_import(_batch_id uuid, _force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      IF _rec.field IN ('plan_start','plan_end','actual_start','actual_finish','forecast_end') THEN
        EXECUTE format('UPDATE public.task_management_raw SET %I = NULLIF($1, '''')::date WHERE discipline=$2 AND task_no=$3', _rec.field)
          USING _rec.old_value, _rec.discipline, _rec.task_no;
      ELSIF _rec.field IN ('actual_progress','plan_progress') THEN
        EXECUTE format('UPDATE public.task_management_raw SET %I = NULLIF($1, '''')::numeric WHERE discipline=$2 AND task_no=$3', _rec.field)
          USING _rec.old_value, _rec.discipline, _rec.task_no;
      ELSIF _rec.field IN ('slip_days','plan_days','actual_duration') THEN
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
$function$;
