import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id);
    const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!(set.has("admin") || set.has("superuser"))) {
      throw redirect({ to: "/outstanding/dashboard" });
    }
  },
  component: () => <Outlet />,
});
