
-- SECURITY DEFINER 함수들의 EXECUTE 권한을 회수 (트리거/service_role 경로에서만 호출)
revoke execute on function public.update_task_summary(text, text) from public, anon, authenticated;
revoke execute on function public.trg_task_rollup_fn() from public, anon, authenticated;
revoke execute on function public.trg_task_history_fn() from public, anon, authenticated;
revoke execute on function public.recalc_task_auto_judgment(text) from public, anon, authenticated;
revoke execute on function public.rollup_task_all_parents(text) from public, anon, authenticated;
-- calc_auto_judgment_value는 STABLE(SECURITY INVOKER, 단순 조회)이므로 authenticated에게 실행 허용 유지
