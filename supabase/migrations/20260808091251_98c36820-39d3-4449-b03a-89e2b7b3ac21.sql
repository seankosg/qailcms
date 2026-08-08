-- Corrective, idempotent re-classification of spl_stage_progress.flag_value.
-- Classifies by the value itself (no dependency on change logs).
-- Supersedes the inverted UPDATEs in 20260808081516.

UPDATE public.spl_stage_progress
SET flag_value = 'REQUIRED'
WHERE flag_value IS NOT NULL
  AND flag_value <> 'REQUIRED'
  AND lower(btrim(flag_value)) IN (
    'o', 'yes', 'rqrd-final', 'rqrd-not final', 'not yet',
    'mfg. letter for physical',
    'specialist letter for physical',
    'addl physical spare parts rqrd (dar)'
  );

UPDATE public.spl_stage_progress
SET flag_value = 'N/A'
WHERE flag_value <> 'N/A'
  AND (
    flag_value IS NULL
    OR lower(btrim(flag_value)) IN (
      'x', 'n/a', 'na', 'n.a.', 'not rqrd', 'not provided', '0', '',
      'spl are incomplete as per specs'
    )
  );
