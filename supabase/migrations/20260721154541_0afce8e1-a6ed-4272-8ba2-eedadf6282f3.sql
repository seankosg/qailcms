
-- 1. Column
ALTER TABLE public.abd_items_raw ADD COLUMN IF NOT EXISTS batch_no text NULL;

-- 2. Index for grouping/filter
CREATE INDEX IF NOT EXISTS abd_items_raw_batch_no_idx
  ON public.abd_items_raw (team, batch_no)
  WHERE batch_no IS NOT NULL;

-- 3. Field config seed (sort_order 65 between abd_ocs_no=60 and document_title=70)
INSERT INTO public.abd_field_config (field_key, label, "group", sort_order, data_type, editable, visible)
VALUES ('batch_no', 'Batch No.', 'identity', 65, 'text', true, true)
ON CONFLICT (field_key) DO UPDATE
  SET label = EXCLUDED.label,
      "group" = EXCLUDED."group",
      sort_order = EXCLUDED.sort_order,
      data_type = EXCLUDED.data_type,
      editable = EXCLUDED.editable,
      visible = EXCLUDED.visible;

-- 4. Header mapping seeds for MECH/ELEC/ARCH (identity field: round_index/stage/plan_or_actual NULL)
INSERT INTO public.abd_header_mappings (team, source_header, target_field, round_index, stage, plan_or_actual, active)
SELECT team, sh, 'batch_no', NULL, NULL, NULL, true
FROM (VALUES ('MECH'), ('ELEC'), ('ARCH')) AS t(team)
CROSS JOIN (VALUES ('BATCH NO.'), ('BATCH NO'), ('BATCH NUMBER'), ('BATCH')) AS h(sh)
ON CONFLICT DO NOTHING;
