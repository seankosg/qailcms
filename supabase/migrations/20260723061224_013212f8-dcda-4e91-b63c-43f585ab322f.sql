-- 1) Variance (%p) → Cum. Diff
UPDATE public.task_management_field_config
SET display_name = 'Cum. Diff', updated_at = now()
WHERE field_name = 'progress_variance';

-- 2) T.Plan / T.Diff 재확인 (idempotent)
UPDATE public.task_management_field_config
SET display_name = 'T.Plan', updated_at = now()
WHERE field_name = 'expected_progress_today' AND display_name IS DISTINCT FROM 'T.Plan';

UPDATE public.task_management_field_config
SET display_name = 'T.Diff', updated_at = now()
WHERE field_name = 'today_gap' AND display_name IS DISTINCT FROM 'T.Diff';

-- 3) sort_order 260(today_gap) 이상을 +1 밀어 251 자리 확보
UPDATE public.task_management_field_config
SET sort_order = sort_order + 1, updated_at = now()
WHERE sort_order >= 260;

-- 4) today_actual 행 INSERT (없을 때만)
INSERT INTO public.task_management_field_config
  (field_name, display_name, is_visible, sort_order, group_key)
SELECT 'today_actual', 'T.Actual', true, 260, 'forecast'
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_management_field_config WHERE field_name = 'today_actual'
);

-- 이미 존재하면 라벨/그룹만 정합화
UPDATE public.task_management_field_config
SET display_name = 'T.Actual', group_key = 'forecast', updated_at = now()
WHERE field_name = 'today_actual' AND display_name IS DISTINCT FROM 'T.Actual';