import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { highestRole } from "@/lib/auth/roles";
import { accessFallbackPath, canAccessPath } from "@/lib/auth/route-access";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const [{ data: profile }, { data: roleRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select("must_change_password,is_active")
        .eq("id", data.user.id)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", data.user.id),
    ]);
    if (profile?.is_active === false) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    if (profile?.must_change_password) {
      throw redirect({ to: "/change-password" });
    }
    // Guest / Super Guest 화면 접근 게이트 (정본: @/lib/auth/route-access)
    const top = highestRole((roleRows ?? []).map((r: { role: string }) => r.role));
    const flags = { isGuest: top === "guest", isSuperGuest: top === "super_guest" };
    if ((flags.isGuest || flags.isSuperGuest) && !canAccessPath(flags, location.pathname)) {
      throw redirect({ to: accessFallbackPath(flags) });
    }
    return { user: data.user, accessFlags: flags };
  },

  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});