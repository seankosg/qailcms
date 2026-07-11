import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TaskManagementFieldConfigRow {
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

export const TASK_MANAGEMENT_FIELD_CONFIG_QK = ["task-management-field-config"] as const;

export function useTaskManagementFieldConfig() {
  return useQuery({
    queryKey: TASK_MANAGEMENT_FIELD_CONFIG_QK,
    queryFn: async (): Promise<TaskManagementFieldConfigRow[]> => {
      const { data, error } = await (supabase as any)
        .from("task_management_field_config")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaskManagementFieldConfigRow[];
    },
    staleTime: 30_000,
  });
}

export function buildTmLabelOverrides(
  rows: TaskManagementFieldConfigRow[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows ?? []) out[r.field_name] = r.display_name;
  return out;
}