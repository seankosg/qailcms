import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TeamOption {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export const TEAM_OPTIONS_QK = ["team-master", "active"] as const;

export function useTeamOptions() {
  return useQuery({
    queryKey: TEAM_OPTIONS_QK,
    queryFn: async (): Promise<TeamOption[]> => {
      const { data, error } = await (supabase as any)
        .from("team_master")
        .select("id,code,name,sort_order,is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TeamOption[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAllTeamOptions() {
  return useQuery({
    queryKey: ["team-master", "all"] as const,
    queryFn: async (): Promise<TeamOption[]> => {
      const { data, error } = await (supabase as any)
        .from("team_master")
        .select("id,code,name,sort_order,is_active")
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TeamOption[];
    },
    staleTime: 5 * 60_000,
  });
}

/** 대문자 정규화, 빈 값 → null. */
export function normalizeTeamCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  return s === "" ? null : s;
}

/** 대소문자 무관 매칭. 매칭 실패 시 null. */
export function matchTeamCode(
  raw: string | null | undefined,
  options: TeamOption[] | undefined,
): TeamOption | null {
  const code = normalizeTeamCode(raw);
  if (!code || !options?.length) return null;
  return options.find((o) => o.code.toUpperCase() === code) ?? null;
}