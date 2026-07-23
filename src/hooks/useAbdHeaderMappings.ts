import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AbdTeam = "MECH" | "ELEC" | "ARCH";

export interface AbdHeaderMappingRow {
  id: string;
  team: AbdTeam;
  source_header: string;
  target_field: string;
  round_index: number | null;
  stage: string | null;
  plan_or_actual: string | null;
  is_custom: boolean;
  is_active: boolean;
  note: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const ABD_HEADER_MAPPING_QK = ["abd-header-mappings"] as const;

export function useAbdHeaderMappings() {
  return useQuery({
    queryKey: ABD_HEADER_MAPPING_QK,
    queryFn: async (): Promise<AbdHeaderMappingRow[]> => {
      const { data, error } = await (supabase as any)
        .from("abd_header_mappings")
        .select("*")
        .order("team", { ascending: true })
        .order("source_header", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AbdHeaderMappingRow[];
    },
    staleTime: 30_000,
  });
}