import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * ABD 팀 탭 정본 — abd_team_list() 무필터 distinct.
 * plot/status/batch 등 화면 필터를 절대 반영하지 않는다(필터로 탭이 줄면 숫자가 사라진다).
 */
export function useAbdTeamList() {
  return useQuery<string[]>({
    queryKey: ["abd", "team-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_team_list");
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[])
        .map((r) => String(r.team ?? "").toUpperCase())
        .filter(Boolean);
    },
    staleTime: 5 * 60_000,
  });
}
