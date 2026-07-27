-- 1) 실행 전 스냅샷 (현재 NULL인 대상 셀만)
CREATE TABLE public.abd_resp_result_restore_snapshot_20260727 AS
SELECT DISTINCT ON (cl.abd_item_id, cl.field)
  cl.abd_item_id,
  cl.field,
  cl.old_value AS restore_value,
  r.r1_response_result AS before_r1,
  r.r2_response_result AS before_r2,
  r.r3_response_result AS before_r3,
  now() AS snapshot_at
FROM public.abd_change_log cl
JOIN public.abd_items_raw r ON r.id = cl.abd_item_id
WHERE cl.upload_id = '38ed83ee-f7c5-4842-a77c-6626b33672b2'
  AND cl.field IN ('r1_response_result','r2_response_result','r3_response_result')
  AND cl.old_value IS NOT NULL
  AND cl.new_value IS NULL
  AND (
    (cl.field='r1_response_result' AND r.r1_response_result IS NULL) OR
    (cl.field='r2_response_result' AND r.r2_response_result IS NULL) OR
    (cl.field='r3_response_result' AND r.r3_response_result IS NULL)
  )
ORDER BY cl.abd_item_id, cl.field, cl.changed_at DESC;

ALTER TABLE public.abd_resp_result_restore_snapshot_20260727 ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.abd_resp_result_restore_snapshot_20260727 TO service_role;

UPDATE public.abd_items_raw r
SET r1_response_result = s.restore_value
FROM public.abd_resp_result_restore_snapshot_20260727 s
WHERE s.field='r1_response_result' AND r.id = s.abd_item_id AND r.r1_response_result IS NULL;

UPDATE public.abd_items_raw r
SET r3_response_result = s.restore_value
FROM public.abd_resp_result_restore_snapshot_20260727 s
WHERE s.field='r3_response_result' AND r.id = s.abd_item_id AND r.r3_response_result IS NULL;

UPDATE public.abd_items_raw r
SET r2_response_result = s.restore_value
FROM public.abd_resp_result_restore_snapshot_20260727 s
WHERE s.field='r2_response_result' AND r.id = s.abd_item_id AND r.r2_response_result IS NULL;