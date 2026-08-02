import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { QAQC_HOME, isQaqcAllowedPath, isQaqcRestricted } from "@/lib/auth/qaqc";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: profile } = await supabase
      .from("profiles")
      .select("must_change_password,is_active,team,user_type")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.is_active === false) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    if (profile?.must_change_password) {
      throw redirect({ to: "/change-password" });
    }
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const qaqcRestricted = isQaqcRestricted({
      team: (profile as any)?.team ?? null,
      userType: (profile as any)?.user_type ?? null,
      roles: (roles ?? []).map((r: { role: string }) => r.role),
    });
    if (qaqcRestricted && !isQaqcAllowedPath(location.pathname)) {
      throw redirect({ to: QAQC_HOME });
    }
    return { user: data.user };
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});