import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_change_password,is_active")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.is_active === false) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    if (profile?.must_change_password) {
      throw redirect({ to: "/change-password" });
    }
    return { user: data.user };
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});