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
    src := coalesce(nullif(current_setting('app.change_source', true), ''), 'manual');
  exception when others then src := 'manual';
  end;
  begin
    uid := nullif(current_setting('app.change_user', true), '')::uuid;
  exception when others then uid := null;
  end;
  if uid is null then
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

-- (백필 생략: task_management_raw에 편집자 컬럼이 없어 과거 changed_by NULL 이력은 복구 불가)