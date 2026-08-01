CREATE OR REPLACE VIEW public.wrt_precedence_violations AS
WITH hdec AS (
  SELECT p.item_id, p.stage_code, c.sort_order, c.label,
         COALESCE(p.actual_finish, p.actual_start) AS actual_any
  FROM wrt_stage_progress p
  JOIN wrt_stage_catalog c ON c.stage_code = p.stage_code
  WHERE c.actual_authority = 'HDEC' AND c.value_type <> 'flag'
    AND c.stage_code <> ALL (ARRAY['RESPONSE_DATE_R1','RESPONSE_DATE_R2'])
), sub_any AS (
  -- 해당 아이템에 HDEC 제출 실적이 하나라도 존재하는가 (전 라운드)
  SELECT i.id AS item_id,
         EXISTS (SELECT 1 FROM wrt_stage_progress p
                  WHERE p.item_id = i.id
                    AND p.stage_code IN ('SUBMISSION_R1','SUBMISSION_R2')
                    AND COALESCE(p.actual_finish, p.actual_start) IS NOT NULL) AS has_sub
  FROM wrt_items i
), prec AS (
  SELECT 'precedence'::text AS violation_type, h.item_id, i.wrt_number, i.plot, i.team,
         h.stage_code, h.label, h.sort_order, h.actual_any AS actual_date,
         (SELECT count(*) FROM hdec pr
           WHERE pr.item_id = h.item_id AND pr.sort_order < h.sort_order AND pr.actual_any IS NULL) AS missing_predecessors,
         '선행 단계 실적 없이 후행 실적 존재'::text AS detail
  FROM hdec h JOIN wrt_items i ON i.id = h.item_id
  WHERE h.actual_any IS NOT NULL
    AND EXISTS (SELECT 1 FROM hdec pr
                 WHERE pr.item_id = h.item_id AND pr.sort_order < h.sort_order AND pr.actual_any IS NULL)
), rounds AS (
  SELECT i.id AS item_id, i.wrt_number, i.plot, i.team, r.n,
         sa.has_sub,
         sub.actual_any AS sub_actual,
         rd.actual_any  AS resp_actual,
         NULLIF(btrim(CASE WHEN r.n = 1 THEN i.r1_response_code ELSE i.r2_response_code END), '') AS resp_code
  FROM wrt_items i
  JOIN sub_any sa ON sa.item_id = i.id
  CROSS JOIN (VALUES (1),(2)) r(n)
  LEFT JOIN LATERAL (SELECT COALESCE(p.actual_finish, p.actual_start) AS actual_any
                       FROM wrt_stage_progress p
                      WHERE p.item_id = i.id AND p.stage_code = 'SUBMISSION_R' || r.n) sub ON true
  LEFT JOIN LATERAL (SELECT COALESCE(p.actual_finish, p.actual_start) AS actual_any
                       FROM wrt_stage_progress p
                      WHERE p.item_id = i.id AND p.stage_code = 'RESPONSE_DATE_R' || r.n) rd ON true
), classified AS (
  -- 회신(회신일 또는 회신코드)이 존재하는 라운드만 대상
  SELECT r.*,
    CASE
      -- 제출 실적이 전 라운드에 걸쳐 전무 → 정상 대기 (HDEC 임포트 전 데이터 상태)
      WHEN r.sub_actual IS NULL AND NOT r.has_sub THEN 'pending_hdec'
      -- 제출 실적이 어딘가 존재하는데 이 라운드 제출이 비어 회신만 귀속 → 라운드 귀속 불일치
      WHEN r.sub_actual IS NULL AND r.has_sub THEN 'ghost_round'
      -- 회신일이 제출 실적보다 앞섬
      WHEN r.resp_actual IS NOT NULL AND r.resp_actual < r.sub_actual THEN 'response_before_submission'
      ELSE NULL
    END AS vtype
  FROM rounds r
  WHERE r.resp_actual IS NOT NULL OR r.resp_code IS NOT NULL
), rnd AS (
  SELECT vtype AS violation_type, item_id, wrt_number, plot, team,
         'ROUND_' || n AS stage_code,
         'Response (R' || n || ')' AS label,
         60 + (n - 1) * 30 AS sort_order,
         resp_actual AS actual_date,
         0::bigint AS missing_predecessors,
         CASE vtype
           WHEN 'pending_hdec' THEN 'HDEC 제출 실적 미입력 상태에서 Aconex 회신만 존재 (임포트 대기 · 위반 아님)'
           WHEN 'ghost_round'  THEN '다른 라운드에는 제출 실적이 있으나 이 라운드 제출 없이 회신 귀속'
           ELSE '회신일이 제출 실적일보다 앞섬'
         END AS detail
  FROM classified WHERE vtype IS NOT NULL
)
SELECT violation_type, item_id, wrt_number, plot, team, stage_code, label, sort_order,
       actual_date, missing_predecessors, detail FROM prec
UNION ALL
SELECT violation_type, item_id, wrt_number, plot, team, stage_code, label, sort_order,
       actual_date, missing_predecessors, detail FROM rnd;

GRANT SELECT ON public.wrt_precedence_violations TO authenticated;
GRANT ALL ON public.wrt_precedence_violations TO service_role;
