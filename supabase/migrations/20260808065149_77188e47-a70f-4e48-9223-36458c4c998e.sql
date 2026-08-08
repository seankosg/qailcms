ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS recipient_names text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS task_comments_recipient_names_idx
  ON public.task_comments USING gin (recipient_names);