import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async ({ location }) => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id);
    const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (set.has("admin") || set.has("superuser")) return;
    // ABD OCS 유지보수 화면은 HDEC PIC(Team DESN) 에게도 관리자와 동일하게 개방한다.
    if (location.pathname.startsWith("/admin/ocs-import")) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("user_type, team")
        .eq("id", authData.user.id)
        .maybeSingle();
      const p = profile as { user_type?: string | null; team?: string | null } | null;
      if (p?.user_type === "hdec_pic" && p?.team === "DESN") return;
    }
    throw redirect({ to: "/project-dashboard" });
  },
  component: () => <Outlet />,
});
