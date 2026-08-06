-- '공통' plot 마일스톤 등록분을 Plot G 정본으로 승격 (멱등)
DELETE FROM public.tm_milestone_config c
WHERE c.plot = '공통'
  AND EXISTS (SELECT 1 FROM public.tm_milestone_config g WHERE g.plot = 'G' AND g.kind = c.kind);

UPDATE public.tm_milestone_config SET plot = 'G' WHERE plot = '공통';