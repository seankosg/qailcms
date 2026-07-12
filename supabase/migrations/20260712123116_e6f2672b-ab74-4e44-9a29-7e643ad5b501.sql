CREATE TABLE public.user_view_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  view_key text NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, view_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_view_preferences TO authenticated;
GRANT ALL ON public.user_view_preferences TO service_role;

ALTER TABLE public.user_view_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select" ON public.user_view_preferences
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.user_view_preferences
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.user_view_preferences
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.user_view_preferences
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_view_preferences_updated_at
  BEFORE UPDATE ON public.user_view_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
