INSERT INTO public.tm_milestone_config (plot, kind, target_date)
VALUES ('공통','HO',NULL),('공통','COC',NULL),('공통','DLP',NULL)
ON CONFLICT (plot, kind) DO NOTHING;