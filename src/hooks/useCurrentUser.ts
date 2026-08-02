import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, ROLE_RANK, type AppRole, type UserType } from "@/types/enums";
import { isQaqcRestricted } from "@/lib/auth/qaqc";

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
      const roleList = (roles ?? []).map((r) => r.role as string);
      const roleSet = new Set(roleList);
      const appRoles = roleList.filter((r): r is AppRole => r in ROLE_RANK);
      const rank = appRoles.reduce((m, r) => Math.max(m, ROLE_RANK[r] ?? 0), 0);
      const primaryRole = appRoles.reduce<AppRole | null>((best, role) => {
        if (!best) return role;
        return ROLE_RANK[role] > ROLE_RANK[best] ? role : best;
      }, null);
      const roleLabel = primaryRole
        ? primaryRole === "d_superuser"
          ? "D.Superuser"
          : ROLE_LABELS[primaryRole]
        : "Guest";
      const isAdmin = roleSet.has("admin") || roleSet.has("superuser");
      const isSuperUser = roleSet.has("superuser");
      const isSeniorUser = roleSet.has("senior_user");
      const isUser = roleSet.has("user");
      const isSuperGuest = roleSet.has("super_guest");
      const isDSuperUser = roleSet.has("d_superuser");
      const p = (profile ?? {}) as any;
      const qaqcRestricted = isQaqcRestricted({
        team: p.team ?? null,
        userType: p.user_type ?? null,
        roles: roleList,
      });
      const isEditor = !qaqcRestricted && (isAdmin || isDSuperUser || isSeniorUser || isUser);
      const canEdit = !qaqcRestricted && rank >= ROLE_RANK.senior_user;
      return {
        id: authData.user.id,
        email: authData.user.email,
        profile,
        roles: Array.from(roleSet) as (AppRole | string)[],
        appRoles,
        primaryRole,
        roleLabel,
        rank,
        isAdmin,
        isSuperUser,
        isSeniorUser,
        isUser,
        isSuperGuest,
        isDSuperUser,
        isEditor,
        isGuest: primaryRole === "guest" || !primaryRole,
        canEdit,
        qaqcRestricted,
        mustChangePassword: p.must_change_password === true,
        userType: p.user_type as UserType | undefined,
        loginId: p.login_id as string | undefined,
        name: (p.name ?? p.display_name ?? null) as string | null,
        team: (p.team ?? null) as string | null,
        subcontractor_name: (p.subcontractor_name ?? null) as string | null,
        subsub_name: (p.subsub_name ?? null) as string | null,
        hdec_pic_name: (p.hdec_pic_name ?? null) as string | null,
        hdec_eng_name: (p.hdec_eng_name ?? null) as string | null,
      };
    },
    staleTime: 60_000,
  });
}