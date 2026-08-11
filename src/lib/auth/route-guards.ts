import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Admin(=admin 또는 superuser) 전용 라우트 가드.
 * 비관리자는 지정된 fallback 경로로 리다이렉트.
 */
export async function assertAdminOrRedirect(fallback: string = "/outstanding/dashboard") {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw redirect({ to: "/auth" });
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id);
  const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
  if (!(set.has("system_administrator") || set.has("admin") || set.has("superuser"))) {
    throw redirect({ to: fallback });
  }
}