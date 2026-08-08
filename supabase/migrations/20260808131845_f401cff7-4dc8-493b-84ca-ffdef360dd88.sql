-- 1) 배치 추적 컬럼 (재발 방지: 롤백은 배치 id 기준)
ALTER TABLE public.wrt_stage_progress ADD COLUMN IF NOT EXISTS backfill_batch_id uuid;
ALTER TABLE public.spl_stage_progress ADD COLUMN IF NOT EXISTS backfill_batch_id uuid;
CREATE INDEX IF NOT EXISTS idx_wrt_sp_backfill_batch ON public.wrt_stage_progress(backfill_batch_id) WHERE backfill_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spl_sp_backfill_batch ON public.spl_stage_progress(backfill_batch_id) WHERE backfill_batch_id IS NOT NULL;

-- 2) WRT 롤백: 현재 NULL 이 아닌 actual_start/actual_finish 중 마지막 로그 source='app' 인 칸
WITH last_log AS (
  SELECT DISTINCT ON (row_id, column_name) row_id, column_name, source
  FROM public.wrt_change_log
  WHERE column_name IN ('actual_start','actual_finish')
  ORDER BY row_id, column_name, changed_at DESC
),
tgt AS (
  SELECT p.id,
         (p.actual_start IS NOT NULL AND ls.source = 'app') AS clr_s,
         (p.actual_finish IS NOT NULL AND lf.source = 'app') AS clr_f,
         p.actual_start, p.actual_finish, p.item_id, p.stage_code
  FROM public.wrt_stage_progress p
  LEFT JOIN last_log ls ON ls.row_id = p.id AND ls.column_name = 'actual_start'
  LEFT JOIN last_log lf ON lf.row_id = p.id AND lf.column_name = 'actual_finish'
),
ins AS (
  INSERT INTO public.wrt_change_log (table_name,row_id,item_id,stage_code,action,column_name,old_value,new_value,source)
  SELECT 'wrt_stage_progress', t.id, t.item_id, t.stage_code, 'update', c.col, c.val::text, NULL, 'rollback'
  FROM tgt t
  CROSS JOIN LATERAL (VALUES ('actual_start', t.actual_start, t.clr_s), ('actual_finish', t.actual_finish, t.clr_f)) AS c(col,val,do_clr)
  WHERE c.do_clr
  RETURNING 1
)
UPDATE public.wrt_stage_progress p
SET actual_start = CASE WHEN t.clr_s THEN NULL ELSE p.actual_start END,
    actual_finish = CASE WHEN t.clr_f THEN NULL ELSE p.actual_finish END,
    actual_estimated = false,
    updated_at = now()
FROM tgt t
WHERE p.id = t.id AND (t.clr_s OR t.clr_f);

-- 3) SPL 롤백 (동일 규칙)
WITH last_log AS (
  SELECT DISTINCT ON (row_id, column_name) row_id, column_name, source
  FROM public.spl_change_log
  WHERE column_name IN ('actual_start','actual_finish')
  ORDER BY row_id, column_name, changed_at DESC
),
tgt AS (
  SELECT p.id,
         (p.actual_start IS NOT NULL AND ls.source = 'app') AS clr_s,
         (p.actual_finish IS NOT NULL AND lf.source = 'app') AS clr_f,
         p.actual_start, p.actual_finish, p.item_id, p.stage_code
  FROM public.spl_stage_progress p
  LEFT JOIN last_log ls ON ls.row_id = p.id AND ls.column_name = 'actual_start'
  LEFT JOIN last_log lf ON lf.row_id = p.id AND lf.column_name = 'actual_finish'
),
ins AS (
  INSERT INTO public.spl_change_log (table_name,row_id,item_id,stage_code,action,column_name,old_value,new_value,source)
  SELECT 'spl_stage_progress', t.id, t.item_id, t.stage_code, 'update', c.col, c.val::text, NULL, 'rollback'
  FROM tgt t
  CROSS JOIN LATERAL (VALUES ('actual_start', t.actual_start, t.clr_s), ('actual_finish', t.actual_finish, t.clr_f)) AS c(col,val,do_clr)
  WHERE c.do_clr
  RETURNING 1
)
UPDATE public.spl_stage_progress p
SET actual_start = CASE WHEN t.clr_s THEN NULL ELSE p.actual_start END,
    actual_finish = CASE WHEN t.clr_f THEN NULL ELSE p.actual_finish END,
    actual_estimated = false,
    updated_at = now()
FROM tgt t
WHERE p.id = t.id AND (t.clr_s OR t.clr_f);

-- 4) 완전히 빈 progress 행 정리
DELETE FROM public.wrt_stage_progress
WHERE plan_start IS NULL AND actual_start IS NULL AND plan_finish IS NULL AND actual_finish IS NULL
  AND (flag_value IS NULL OR flag_value = '') AND coalesce(na_flag,false) = false
  AND (remarks IS NULL OR remarks = '');
DELETE FROM public.spl_stage_progress
WHERE plan_start IS NULL AND actual_start IS NULL AND plan_finish IS NULL AND actual_finish IS NULL
  AND (flag_value IS NULL OR flag_value = '') AND coalesce(na_flag,false) = false
  AND (remarks IS NULL OR remarks = '');