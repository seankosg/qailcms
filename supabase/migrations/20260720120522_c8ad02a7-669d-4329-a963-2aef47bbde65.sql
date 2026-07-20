ALTER TABLE public.team_master
  ADD CONSTRAINT team_master_code_key UNIQUE (code);

ALTER TABLE public.dmr_entries
  ADD CONSTRAINT dmr_entries_discipline_team_master_fkey
  FOREIGN KEY (discipline) REFERENCES public.team_master(code);

ALTER TABLE public.dmr_system_master
  ADD CONSTRAINT dmr_system_master_discipline_team_master_fkey
  FOREIGN KEY (discipline) REFERENCES public.team_master(code);