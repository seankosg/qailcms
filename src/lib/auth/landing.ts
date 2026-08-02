import { supabase } from "@/integrations/supabase/client";
import { QAQC_HOME, isQaqcAllowedPath, isQaqcRestricted } from "@/lib/auth/qaqc";
import { clearLastRoute, loadLastRoute } from "@/lib/last-route";

/**
 * 로그인 직후 이동할 경로를 결정한다.
 * QAQC 제한 사용자는 저장된 last-route 가 SM 섹션 밖이면 무조건 SM Dashboard 로 보낸다.
 */
export async function resolveLandingRoute(userId: string): Promise<string> {
  let restricted = false;
  try {
    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("team,user_type").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    restricted = isQaqcRestricted({
      team: (profile as any)?.team ?? null,
      userType: (profile as any)?.user_type ?? null,
      roles: (roles ?? []).map((r: { role: string }) => r.role),
    });
  } catch {
    restricted = false;
  }

  const last = loadLastRoute();
  if (restricted) {
    const path = last?.split("?")[0].split("#")[0] ?? "";
    if (!last || !isQaqcAllowedPath(path)) {
      clearLastRoute();
      return QAQC_HOME;
    }
    return last;
  }
  return last ?? "/my-work-space";
}
