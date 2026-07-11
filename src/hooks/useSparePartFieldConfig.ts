import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SparePartFieldConfigRow {
  id: string;
  field_name: string;
  display_name: string;
  is_visible: boolean;
  sort_order: number;
  group_key: string | null;
  note: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const SPARE_PART_FIELD_CONFIG_QK = ["spare-part-field-config"] as const;

export function useSparePartFieldConfig() {
  return useQuery({
    queryKey: SPARE_PART_FIELD_CONFIG_QK,
    queryFn: async (): Promise<SparePartFieldConfigRow[]> => {
      const { data, error } = await (supabase as any)
        .from("spare_part_field_config")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SparePartFieldConfigRow[];
    },
    staleTime: 30_000,
  });
}

export function buildLabelOverrides(
  rows: SparePartFieldConfigRow[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows ?? []) out[r.field_name] = r.display_name;
  return out;
}
