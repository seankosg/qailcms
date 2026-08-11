import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** SPL 임포트 양식 스코프 (ABD 의 team 스코프에 대응) */
export type SplForm = "HDEC" | "VIEW" | "ACONEX";

export interface SplHeaderMappingRow {
  id: string;
  form: SplForm;
  source_header: string;
  target_field: string;
  stage: string | null;
  plan_or_actual: string | null;
  is_custom: boolean;
  is_active: boolean;
  note: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const SPL_HEADER_MAPPING_QK = ["spl-header-mappings"] as const;

export function useSplHeaderMappings() {
  return useQuery({
    queryKey: SPL_HEADER_MAPPING_QK,
    queryFn: async (): Promise<SplHeaderMappingRow[]> => {
      const { data, error } = await (supabase as any)
        .from("spl_header_mappings")
        .select("*")
        .order("form", { ascending: true })
        .order("source_header", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SplHeaderMappingRow[];
    },
    staleTime: 30_000,
  });
}
