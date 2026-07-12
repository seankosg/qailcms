import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFECT_COLUMNS } from "@/lib/defect-management/columns";

export interface DefectFieldConfigRow {
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

export const DEFECT_FIELD_CONFIG_QK = ["defect-field-config"] as const;

export function useDefectFieldConfig() {
  return useQuery({
    queryKey: DEFECT_FIELD_CONFIG_QK,
    queryFn: async (): Promise<DefectFieldConfigRow[]> => {
      const { data, error } = await (supabase as any)
        .from("defect_field_config")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DefectFieldConfigRow[];
    },
    staleTime: 30_000,
  });
}

export function buildDefectLabelOverrides(rows: DefectFieldConfigRow[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows ?? []) out[r.field_name] = r.display_name;
  return out;
}

export function useDefectColumnLabel(): (key: string) => string {
  const { data } = useDefectFieldConfig();
  return useMemo(() => {
    const overrides = buildDefectLabelOverrides(data);
    const codeLabels = new Map(DEFECT_COLUMNS.map((c) => [c.key, c.label] as const));
    return (key: string) => overrides[key] ?? codeLabels.get(key) ?? key;
  }, [data]);
}