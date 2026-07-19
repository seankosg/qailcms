-- Expand check
ALTER TABLE public.task_management_raw DROP CONSTRAINT IF EXISTS task_management_raw_level_check;
ALTER TABLE public.task_management_raw ADD CONSTRAINT task_management_raw_level_check
  CHECK (level = ANY (ARRAY['main'::text, 'sub'::text, 'parent'::text, 'child'::text]));

-- Rename column
ALTER TABLE public.task_management_raw RENAME COLUMN parent_task_no TO main_task_no;
ALTER INDEX IF EXISTS task_management_raw_parent_idx RENAME TO task_management_raw_main_idx;

-- Drop old signatures (arg names differ)
DROP FUNCTION IF EXISTS public.update_task_summary(text, text);
DROP FUNCTION IF EXISTS public.allocate_task_no(text, text);
DROP FUNCTION IF EXISTS public.rollup_task_all_parents(text);

-- Transitional trigger function accepting both level values, referencing main_task_no
CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _main_task_no text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  agg record;
  worst text;
  rank_order text[] := array['위험','지연','주의','정상','완료'];
  _ad integer;
begin
  if _main_task_no is null then return; end if;
  select
    sum(coalesce(actual_progress,0) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as ap,
    sum(coalesce(plan_progress,0) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as pp,
    min(plan_start) as ps, max(plan_end) as pe,
    sum(coalesce(plan_days, greatest(coalesce(plan_end - plan_start, 0) + 1, 1))) as pd,
    min(actual_start) as as_, max(actual_finish) as af_,
    bool_and(actual_finish is not null) as all_finished,
    max(forecast_end) as fe, max(slip_days) as sd, count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline and main_task_no = _main_task_no and level in ('sub','child');
  if agg.cnt = 0 then return; end if;
  if agg.as_ is null then _ad := null;
  elsif agg.all_finished and agg.af_ is not null then _ad := (agg.af_ - agg.as_) + 1;
  else _ad := (current_date - agg.as_) + 1;
  end if;
  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and main_task_no=_main_task_no
      and level in ('sub','child') and auto_judgment = x.r
  ) order by idx limit 1;
  update public.task_management_raw
     set actual_progress = round(coalesce(agg.ap,0)::numeric, 4),
         plan_progress = round(coalesce(agg.pp,0)::numeric, 4),
         progress_variance = round(coalesce(agg.ap,0)::numeric - coalesce(agg.pp,0)::numeric, 4),
         plan_start = agg.ps, plan_end = agg.pe, plan_days = agg.pd,
         actual_start = agg.as_,
         actual_finish = case when agg.all_finished then agg.af_ else null end,
         actual_duration = _ad, forecast_end = agg.fe, slip_days = agg.sd,
         auto_judgment = coalesce(worst, auto_judgment), is_rollup = true
   where discipline = _discipline and task_no = _main_task_no and level in ('main','parent');
end;
$function$;

CREATE OR REPLACE FUNCTION public.trg_task_rollup_fn()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.main_task_no is not null and old.level in ('sub','child') then
      perform public.update_task_summary(old.discipline, old.main_task_no);
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.main_task_no is distinct from new.main_task_no
       and old.main_task_no is not null and old.level in ('sub','child') then
      perform public.update_task_summary(old.discipline, old.main_task_no);
    end if;
  end if;
  if new.main_task_no is not null and new.level in ('sub','child') then
    perform public.update_task_summary(new.discipline, new.main_task_no);
  end if;
  return new;
end;
$function$;

-- Migrate values
UPDATE public.task_management_raw SET level = 'main' WHERE level = 'parent';
UPDATE public.task_management_raw SET level = 'sub' WHERE level = 'child';

-- Tighten constraint
ALTER TABLE public.task_management_raw DROP CONSTRAINT task_management_raw_level_check;
ALTER TABLE public.task_management_raw ADD CONSTRAINT task_management_raw_level_check
  CHECK (level = ANY (ARRAY['main'::text, 'sub'::text]));

-- allocate_task_no
CREATE FUNCTION public.allocate_task_no(_discipline text, _main_task_no text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_parent public.task_management_raw%ROWTYPE;
  v_max int := 0; v_next text; v_lock_key bigint;
  v_suffix text; v_seg text; v_n int; v_rec record;
BEGIN
  IF _discipline IS NULL OR _discipline = '' THEN
    RAISE EXCEPTION 'discipline required';
  END IF;
  v_lock_key := hashtextextended(_discipline || ':' || COALESCE(_main_task_no, '~ROOT~'), 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);
  IF _main_task_no IS NOT NULL AND _main_task_no <> '' THEN
    SELECT * INTO v_parent FROM public.task_management_raw
     WHERE discipline = _discipline AND task_no = _main_task_no FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Main Task not found: %', _main_task_no; END IF;
    FOR v_rec IN
      SELECT task_no FROM public.task_management_raw
       WHERE discipline = _discipline AND task_no LIKE _main_task_no || '-%'
    LOOP
      v_suffix := substring(v_rec.task_no FROM length(_main_task_no) + 2);
      v_seg := split_part(v_suffix, '-', 1);
      BEGIN v_n := v_seg::int; IF v_n > v_max THEN v_max := v_n; END IF;
      EXCEPTION WHEN others THEN END;
    END LOOP;
    v_next := _main_task_no || '-' || lpad((v_max + 1)::text, 2, '0');
  ELSE
    SELECT COALESCE(MAX(task_no::int), 0) INTO v_max
      FROM public.task_management_raw
     WHERE discipline = _discipline
       AND (main_task_no IS NULL OR main_task_no = '')
       AND task_no ~ '^[0-9]+$';
    v_next := lpad((v_max + 1)::text, 3, '0');
  END IF;
  WHILE EXISTS (
    SELECT 1 FROM public.task_management_raw
     WHERE discipline = _discipline AND task_no = v_next
  ) LOOP
    v_max := v_max + 1;
    IF _main_task_no IS NOT NULL AND _main_task_no <> '' THEN
      v_next := _main_task_no || '-' || lpad((v_max + 1)::text, 2, '0');
    ELSE
      v_next := lpad((v_max + 1)::text, 3, '0');
    END IF;
  END LOOP;
  RETURN v_next;
END;
$function$;

-- Final trigger + update_task_summary strictly on new values
CREATE OR REPLACE FUNCTION public.trg_task_rollup_fn()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.main_task_no is not null and old.level = 'sub' then
      perform public.update_task_summary(old.discipline, old.main_task_no);
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.main_task_no is distinct from new.main_task_no
       and old.main_task_no is not null and old.level = 'sub' then
      perform public.update_task_summary(old.discipline, old.main_task_no);
    end if;
  end if;
  if new.main_task_no is not null and new.level = 'sub' then
    perform public.update_task_summary(new.discipline, new.main_task_no);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_task_summary(_discipline text, _main_task_no text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  agg record; worst text;
  rank_order text[] := array['위험','지연','주의','정상','완료'];
  _ad integer;
begin
  if _main_task_no is null then return; end if;
  select
    sum(coalesce(actual_progress,0) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as ap,
    sum(coalesce(plan_progress,0) * greatest(coalesce(plan_end - plan_start, 0) + 1, 1))::numeric
      / nullif(sum(greatest(coalesce(plan_end - plan_start, 0) + 1, 1)),0) as pp,
    min(plan_start) as ps, max(plan_end) as pe,
    sum(coalesce(plan_days, greatest(coalesce(plan_end - plan_start, 0) + 1, 1))) as pd,
    min(actual_start) as as_, max(actual_finish) as af_,
    bool_and(actual_finish is not null) as all_finished,
    max(forecast_end) as fe, max(slip_days) as sd, count(*) as cnt
    into agg
  from public.task_management_raw
  where discipline = _discipline and main_task_no = _main_task_no and level = 'sub';
  if agg.cnt = 0 then return; end if;
  if agg.as_ is null then _ad := null;
  elsif agg.all_finished and agg.af_ is not null then _ad := (agg.af_ - agg.as_) + 1;
  else _ad := (current_date - agg.as_) + 1; end if;
  select r into worst from (
    select r, idx from unnest(rank_order) with ordinality as t(r, idx)
  ) x
  where exists (
    select 1 from public.task_management_raw
    where discipline=_discipline and main_task_no=_main_task_no
      and level='sub' and auto_judgment = x.r
  ) order by idx limit 1;
  update public.task_management_raw
     set actual_progress = round(coalesce(agg.ap,0)::numeric, 4),
         plan_progress = round(coalesce(agg.pp,0)::numeric, 4),
         progress_variance = round(coalesce(agg.ap,0)::numeric - coalesce(agg.pp,0)::numeric, 4),
         plan_start = agg.ps, plan_end = agg.pe, plan_days = agg.pd,
         actual_start = agg.as_,
         actual_finish = case when agg.all_finished then agg.af_ else null end,
         actual_duration = _ad, forecast_end = agg.fe, slip_days = agg.sd,
         auto_judgment = coalesce(worst, auto_judgment), is_rollup = true
   where discipline = _discipline and task_no = _main_task_no and level = 'main';
end;
$function$;

-- rollup_task_all_mains
CREATE FUNCTION public.rollup_task_all_mains(_discipline text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r record; n int := 0;
begin
  for r in
    select distinct main_task_no from public.task_management_raw
     where discipline = _discipline and level = 'sub' and main_task_no is not null
  loop
    perform public.update_task_summary(_discipline, r.main_task_no);
    n := n + 1;
  end loop;
  return n;
end;
$function$;

-- rollback function
CREATE OR REPLACE FUNCTION public.rollback_task_management_import(_batch_id uuid, _force boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _restored int := 0; _deleted int := 0; _skipped int := 0;
  _rec record; _has_later boolean; _parent record;
BEGIN
  IF NOT public.has_role(_user,'admin') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.task_management_import_logs WHERE id = _batch_id) THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  FOR _rec IN
    SELECT h.discipline, h.task_no, h.field, h.old_value, h.changed_at
      FROM public.task_management_status_history h
      JOIN public.task_management_raw d
        ON d.discipline = h.discipline AND d.task_no = h.task_no
     WHERE h.upload_id = _batch_id AND h.source = 'import'
       AND d.source_import_log_id IS DISTINCT FROM _batch_id
     ORDER BY h.changed_at ASC
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.task_management_status_history later
       WHERE later.discipline = _rec.discipline AND later.task_no = _rec.task_no
         AND later.field = _rec.field AND later.changed_at > _rec.changed_at
         AND later.upload_id IS DISTINCT FROM _batch_id
    ) INTO _has_later;
    IF _has_later AND NOT _force THEN _skipped := _skipped + 1; CONTINUE; END IF;
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
    EXCEPTION WHEN others THEN _skipped := _skipped + 1;
    END;
  END LOOP;
  FOR _parent IN
    SELECT DISTINCT discipline, main_task_no FROM public.task_management_raw
     WHERE source_import_log_id = _batch_id AND main_task_no IS NOT NULL
  LOOP
    PERFORM public.update_task_summary(_parent.discipline, _parent.main_task_no);
  END LOOP;
  UPDATE public.task_management_import_logs
     SET status = 'rolled_back', rolled_back_at = now(), rolled_back_by = _user,
         rollback_force = _force,
         note = COALESCE(note || E'\n', '') || format('Rolled back at %s by %s (force=%s)', now(), _user, _force)
   WHERE id = _batch_id;
  RETURN jsonb_build_object('restored_count', _restored, 'deleted_count', _deleted, 'skipped_count', _skipped);
END;
$function$;