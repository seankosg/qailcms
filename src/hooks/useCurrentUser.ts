import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return null;
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", authData.user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", authData.user.id),
      ]);
      const roleSet = new Set((roles ?? []).map((r) => r.role));
      const isAdmin = roleSet.has("admin") || roleSet.has("superuser");
      const isEditor = isAdmin || roleSet.has("user");
      return {
        id: authData.user.id,
        email: authData.user.email,
        profile,
        roles: Array.from(roleSet),
        isAdmin,
        isSuperUser: roleSet.has("superuser"),
        isEditor,
        isGuest: !isEditor,
        mustChangePassword: (profile as any)?.must_change_password === true,
        userType: (profile as any)?.user_type as
          | "subcontractor" | "hdec" | "pm_pd" | "admin" | undefined,
        loginId: (profile as any)?.login_id as string | undefined,
      };
    },
    staleTime: 60_000,
  });
}