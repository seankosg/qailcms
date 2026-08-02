-- ============================================================
-- G-2 : TM 실적 정합 마이그레이션 (Case A ~ D)
-- 기준시 = Asia/Qatar. 모든 값은 2026-08-02 실측 기반.
-- ============================================================

-- Case B : actual_progress = 1 AND actual_finish IS NULL (14건)
-- 규칙 ① 이력의 최초 100% 관측일(도하 날짜), 하한 = actual_start(없으면 plan_start).
-- 13건은 규칙 ① 그대로. EL-D-29-01 만 규칙 ①의 확장 적용(아래 주석 참조).
UPDATE public.task_management_raw t
SET actual_finish = v.fin, actual_finish_source = 'migration'
FROM (VALUES
  ('4c382fa8-867a-476f-a67a-808332845466'::uuid, DATE '2026-07-30'), -- EL-C-09-04
  ('d6b6371b-7a45-49a0-9388-1829373a060e'::uuid, DATE '2026-08-01'), -- EL-C-09-05
  ('2ba2e73a-609e-4e95-b1c2-181eaee33f99'::uuid, DATE '2026-07-26'), -- EL-C-13-03
  ('1b259541-8bfc-4461-9d8f-d7dcfacd73a4'::uuid, DATE '2026-07-22'), -- EL-C-14-01
  ('35c9257a-99a4-46aa-9552-6d17d5f9d08e'::uuid, DATE '2026-07-26'), -- EL-D-05-01
  ('c448b994-8b33-4752-898c-9f056a9ebbcc'::uuid, DATE '2026-07-19'), -- EL-D-29 (최초 100% 관측 UTC 2026-07-19 04:57:45)
  -- EL-D-29-01 : 규칙 ①의 확장 적용 (사용자 확정). 근거 —
  --   · 자기 이력에 actual_progress 변경 기록 0건. status_history 최초 기록이
  --     2026-07-19 04:57:42 이므로 이력 부재는 "완료된 적 없음"이 아니라
  --     "이력 시작 이전에 이미 100%"를 뜻한다.
  --   · 형제 행 EL-D-29 의 최초 100% 관측일이 2026-07-19 다.
  --   · 두 행은 동일 계획창(2026-07-12~07-17), 동일 actual_start(2026-07-06),
  --     2026-07-20 10:38 동일 백필 세션에서 함께 완료일이 채워졌다.
  --   · 실제 완료일은 07-06 ~ 07-19 사이로 확정 불가하며, 07-19 는
  --     "가장 이른 날" 원칙 하에서 방어 가능한 상한이다.
  --   · 게이트 3 에서 "완료일 미확인" 배지 대상 (actual_finish_source = 'migration').
  ('e062776b-d079-4508-b0e7-6bbbae2033f5'::uuid, DATE '2026-07-19'), -- EL-D-29-01
  ('981be692-4596-4dec-a7ef-11fe4f5558a2'::uuid, DATE '2026-07-23'), -- EL-D-31-01
  ('83423818-159c-4ade-8eb3-cd374eff8fba'::uuid, DATE '2026-07-27'), -- ME-C-03-03
  ('4861a108-a64d-4e41-b1f9-82a24278c7dc'::uuid, DATE '2026-07-30'), -- ME-C-03-18
  ('53629400-a0aa-4df1-b6f8-3882c6642e18'::uuid, DATE '2026-08-01'), -- ME-C-08-21
  ('074b5e34-28a2-49a3-acfb-9652c442451d'::uuid, DATE '2026-07-30'), -- ME-C-16
  ('781f5339-50e5-4399-8307-8260155581a9'::uuid, DATE '2026-07-30'), -- ME-C-16-01
  ('fb45ee43-cdcf-4806-adb7-3b67dfb9fd88'::uuid, DATE '2026-07-30')  -- ME-D-08-03
) AS v(id, fin)
WHERE t.id = v.id AND t.actual_finish IS NULL AND t.actual_progress = 1;

-- Case A : actual_finish 있고 progress < 1 (1건, ME-C-08-22)
UPDATE public.task_management_raw
SET actual_progress = 1
WHERE id = '2264767b-c75f-44a3-981a-a111061bb97b'
  AND actual_finish IS NOT NULL AND coalesce(actual_progress, 0) < 1;

-- Case C : actual_start > actual_finish (3건). 두 값 모두 정상 범위(J-2 CHECK 하) 확인됨.
UPDATE public.task_management_raw
SET actual_start = actual_finish
WHERE id IN (
  '15ad44e3-4eee-4f14-bb3f-5f66c90d34eb', -- EL-C-23-01  2026-07-13 -> 2026-07-12
  '8de70139-4693-41a0-914b-b8816cdddd44', -- EL-G-07-01  2026-07-11 -> 2026-07-10
  '6af437ab-ae0e-4bba-b732-196f7770636a'  -- ME-C-08-01  2026-07-20 -> 2026-07-16
) AND actual_start > actual_finish;

-- Case D : progress > 0 AND actual_start IS NULL (33건)
-- actual_start := 이력의 최초 progress>0 관측일(도하), 없으면 plan_start.
-- C3 보장을 위해 actual_finish 가 있으면 그보다 늦지 않도록 least() 적용.
WITH h AS (
  SELECT task_raw_id,
         min((changed_at AT TIME ZONE 'Asia/Qatar')::date)
           FILTER (WHERE field = 'actual_progress'
                     AND coalesce(nullif(new_value, '')::numeric, 0) > 0) AS first_pos
  FROM public.task_management_status_history
  GROUP BY 1
)
UPDATE public.task_management_raw t
SET actual_start = least(coalesce(h.first_pos, t.plan_start),
                         coalesce(t.actual_finish, coalesce(h.first_pos, t.plan_start)))
FROM h
WHERE h.task_raw_id = t.id
  AND t.actual_start IS NULL
  AND coalesce(t.actual_progress, 0) > 0
  AND coalesce(h.first_pos, t.plan_start) IS NOT NULL;
