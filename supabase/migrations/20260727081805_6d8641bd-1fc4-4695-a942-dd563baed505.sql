-- 1) trg_task_history 함수: auth.uid() 폴백 추가
CREATE OR REPLACE FUNCTION public.trg_task_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  if uid is null and src <> 'import' then
    begin
      uid := auth.uid();
    exception when others then uid := null;
    end;
  end if;

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
$$;

-- 2) tm_edit_record_daily: 사용자×날짜 편집 유무만 반환하도록 단순화
DROP FUNCTION IF EXISTS public.tm_edit_record_daily(date, date);
CREATE OR REPLACE FUNCTION public.tm_edit_record_daily(p_from date, p_to date)
RETURNS TABLE(user_id uuid, date_key date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    h.changed_by AS user_id,
    ((h.changed_at AT TIME ZONE 'Asia/Qatar')::date) AS date_key
  FROM public.task_management_status_history h
  WHERE h.source = 'manual'
    AND h.changed_by IS NOT NULL
    AND ((h.changed_at AT TIME ZONE 'Asia/Qatar')::date) BETWEEN p_from AND p_to
  GROUP BY 1, 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tm_edit_record_daily(date, date) TO authenticated;