CREATE TABLE public.comment_read_state (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key text NOT NULL,
  last_read_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);

GRANT SELECT, INSERT, UPDATE ON public.comment_read_state TO authenticated;
GRANT ALL ON public.comment_read_state TO service_role;

ALTER TABLE public.comment_read_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY comment_read_state_select ON public.comment_read_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY comment_read_state_insert ON public.comment_read_state
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY comment_read_state_update ON public.comment_read_state
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER comment_read_state_touch
  BEFORE UPDATE ON public.comment_read_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();