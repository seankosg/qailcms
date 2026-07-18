
-- ABD comments
CREATE TABLE public.abd_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abd_item_id uuid NOT NULL REFERENCES public.abd_items_raw(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES public.abd_comments(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'general',
  message text NOT NULL CHECK (char_length(message) <= 2000),
  source text NOT NULL DEFAULT 'app_manual',
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.abd_comments TO authenticated;
GRANT ALL ON public.abd_comments TO service_role;
ALTER TABLE public.abd_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abd_comments_select_auth" ON public.abd_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "abd_comments_insert_self" ON public.abd_comments FOR INSERT TO authenticated WITH CHECK (author_user_id = auth.uid());
CREATE POLICY "abd_comments_update_own_or_admin" ON public.abd_comments FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'))
  WITH CHECK (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'));
CREATE POLICY "abd_comments_delete_own_or_admin" ON public.abd_comments FOR DELETE TO authenticated
  USING (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'));
CREATE INDEX idx_abd_comments_item ON public.abd_comments(abd_item_id, created_at);
CREATE INDEX idx_abd_comments_parent ON public.abd_comments(parent_comment_id);

-- Defect comments
CREATE TABLE public.defect_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_raw_id uuid NOT NULL REFERENCES public.defect_items_raw(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES public.defect_comments(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'general',
  message text NOT NULL CHECK (char_length(message) <= 2000),
  source text NOT NULL DEFAULT 'app_manual',
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_comments TO authenticated;
GRANT ALL ON public.defect_comments TO service_role;
ALTER TABLE public.defect_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "defect_comments_select_auth" ON public.defect_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "defect_comments_insert_self" ON public.defect_comments FOR INSERT TO authenticated WITH CHECK (author_user_id = auth.uid());
CREATE POLICY "defect_comments_update_own_or_admin" ON public.defect_comments FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'))
  WITH CHECK (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'));
CREATE POLICY "defect_comments_delete_own_or_admin" ON public.defect_comments FOR DELETE TO authenticated
  USING (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'));
CREATE INDEX idx_defect_comments_item ON public.defect_comments(defect_raw_id, created_at);
CREATE INDEX idx_defect_comments_parent ON public.defect_comments(parent_comment_id);

-- Task comments
CREATE TABLE public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_raw_id uuid NOT NULL REFERENCES public.task_management_raw(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES public.task_comments(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'general',
  message text NOT NULL CHECK (char_length(message) <= 2000),
  source text NOT NULL DEFAULT 'app_manual',
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_comments_select_auth" ON public.task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_comments_insert_self" ON public.task_comments FOR INSERT TO authenticated WITH CHECK (author_user_id = auth.uid());
CREATE POLICY "task_comments_update_own_or_admin" ON public.task_comments FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'))
  WITH CHECK (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'));
CREATE POLICY "task_comments_delete_own_or_admin" ON public.task_comments FOR DELETE TO authenticated
  USING (author_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'superuser'));
CREATE INDEX idx_task_comments_item ON public.task_comments(task_raw_id, created_at);
CREATE INDEX idx_task_comments_parent ON public.task_comments(parent_comment_id);

-- updated_at triggers (reuse existing function public.update_updated_at_column if exists, else create)
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_abd_comments_updated BEFORE UPDATE ON public.abd_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_defect_comments_updated BEFORE UPDATE ON public.defect_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_task_comments_updated BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.abd_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.defect_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
