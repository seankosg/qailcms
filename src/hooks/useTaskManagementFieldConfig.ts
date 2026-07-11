import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { TM_COLUMNS } from "@/lib/task-management/columns";

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

/**
 * Field Config의 Display Name을 최우선으로 하고, 없으면 TM_COLUMNS.label,
 * 그마저 없으면 key를 반환하는 라벨 resolver를 제공하는 훅.
 */
export function useTmColumnLabel(): (key: string) => string {
  const { data } = useTaskManagementFieldConfig();
  return useMemo(() => {
    const overrides = buildTmLabelOverrides(data);
    const codeLabels = new Map(TM_COLUMNS.map((c) => [c.key, c.label] as const));
    return (key: string) => overrides[key] ?? codeLabels.get(key) ?? key;
  }, [data]);
}