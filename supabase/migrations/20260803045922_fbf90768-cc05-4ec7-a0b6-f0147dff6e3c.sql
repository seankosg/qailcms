-- R2-7 (b): 파생 4종(auto_judgment, plan_progress, slip_days, actual_duration) 이력 기록 제거
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
  -- R2-7: 트리거·롤업이 재계산하는 파생값(auto_judgment / plan_progress /
  -- slip_days / actual_duration)은 사람의 변경 이력이 아니므로 기록하지 않는다.
  -- actual_progress 이력은 tm_today_actual 이 사용하므로 절대 제거 금지.
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
  if new.forecast_end is distinct from old.forecast_end then
    insert into public.task_management_status_history
      (task_raw_id, discipline, task_no, field, old_value, new_value, source, changed_by)
    values (new.id, new.discipline, new.task_no, 'forecast_end',
      old.forecast_end::text, new.forecast_end::text, src, uid);
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

-- R2-4 (c): 전체 인덱스에 완전히 포함되는 부분 인덱스 제거
DROP INDEX IF EXISTS public.idx_tmsh_taskraw_field_changed;

-- R2-8 (b): 사용처 0건 구함수 폐기
DROP FUNCTION IF EXISTS public.tm_actual_at_date(date);
DROP FUNCTION IF EXISTS public.tm_judge_at_date(date);
DROP FUNCTION IF EXISTS public.tm_judge_snapshot_at_date(date);

-- R2-7 (d): 가드레일 주석
COMMENT ON FUNCTION public.aac_tm_autofill_actuals_fn() IS
'완료 정본 = actual_finish 단독.
actual_progress = 1 은 조항 (h) 를 통해 finish 를 채우는 경로일 뿐이며,
판정·집계는 finish 하나만 읽는다. 새 술어를 만들지 마라.';