import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SparePartHeaderMappingRow {
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

export const SPARE_PART_HEADER_MAPPING_QK = ["spare-part-header-mappings"] as const;

export function useSparePartHeaderMappings() {
  return useQuery({
    queryKey: SPARE_PART_HEADER_MAPPING_QK,
    queryFn: async (): Promise<SparePartHeaderMappingRow[]> => {
      const { data, error } = await (supabase as any)
        .from("spare_part_header_mappings")
        .select("*")
        .order("target_field", { ascending: true })
        .order("source_header", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SparePartHeaderMappingRow[];
    },
    staleTime: 30_000,
  });
}
