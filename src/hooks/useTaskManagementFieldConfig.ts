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

/**
 * field_config 기반 기본 컬럼 순서/노출. `task_no`는 시스템 고정 컬럼이므로 제외.
 */
export function useTmDefaults() {
  const { data } = useTaskManagementFieldConfig();
  return useMemo(() => {
    const rows = data ?? [];
    const codeKeys = TM_COLUMNS.map((c) => c.key).filter((k) => k !== "task_no");
    const codeSet = new Set(codeKeys);
    const configured = rows
      .filter((r) => codeSet.has(r.field_name) && r.field_name !== "task_no")
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => r.field_name);
    const configuredSet = new Set(configured);
    const defaultOrder = rows.length
      ? [...configured, ...codeKeys.filter((k) => !configuredSet.has(k))]
      : codeKeys;
    const defaultVisibility: Record<string, boolean> = {};
    for (const r of rows) {
      if (codeSet.has(r.field_name)) defaultVisibility[r.field_name] = !!r.is_visible;
    }
    return { defaultOrder, defaultVisibility };
  }, [data]);
}

/** Admin 전용: field_config UPDATE. RLS로 비관리자는 실패. */
export async function persistTmFieldConfig(
  patches: Array<{ field_name: string; sort_order?: number; is_visible?: boolean }>,
) {
  if (!patches.length) return;
  const results = await Promise.all(
    patches.map((p) => {
      const { field_name, ...patch } = p;
      return (supabase as any)
        .from("task_management_field_config")
        .update(patch)
        .eq("field_name", field_name);
    }),
  );
  const err = results.find((r) => r.error)?.error;
  if (err) throw err;
}