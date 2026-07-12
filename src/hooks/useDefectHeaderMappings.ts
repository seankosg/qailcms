import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DefectHeaderMappingRow {
  id: string;
  module: string;
  source_header: string;
  target_field: string;
  is_custom: boolean;
  is_active: boolean;
  note: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const DEFECT_HEADER_MAPPING_QK = ["defect-header-mappings"] as const;

export function useDefectHeaderMappings() {
  return useQuery({
    queryKey: DEFECT_HEADER_MAPPING_QK,
    queryFn: async (): Promise<DefectHeaderMappingRow[]> => {
      const { data, error } = await (supabase as any)
        .from("defect_header_mappings")
        .select("*")
        .order("target_field", { ascending: true })
        .order("source_header", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DefectHeaderMappingRow[];
    },
    staleTime: 30_000,
  });
}