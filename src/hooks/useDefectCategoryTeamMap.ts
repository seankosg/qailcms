import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DefectTeam } from "@/lib/defect-management/columns";

export interface CategoryTeamMapRow {
  category: string;
  team: DefectTeam;
  updated_at: string;
  updated_by: string | null;
}

const KEY = ["defect-category-team-map"] as const;

export function useDefectCategoryTeamMap() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CategoryTeamMapRow[]> => {
      const { data, error } = await (supabase as any)
        .from("defect_category_team_map")
        .select("category, team, updated_at, updated_by")
        .order("team", { ascending: true })
        .order("category", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CategoryTeamMapRow[];
    },
  });
}

export function useUpsertCategoryTeamMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { category: string; team: DefectTeam }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? null;
      const { error } = await (supabase as any)
        .from("defect_category_team_map")
        .upsert(
          { category: input.category.trim(), team: input.team, updated_by: userId },
          { onConflict: "category" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCategoryTeamMap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (category: string) => {
      const { error } = await (supabase as any)
        .from("defect_category_team_map")
        .delete()
        .eq("category", category);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}