import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ABD_COLUMNS } from "@/lib/abd/columns";

export interface AbdFieldConfigRow {
  id: string;
  field_key: string;
  label: string;
  group: string | null;
  data_type: string;
  editable: boolean;
  visible: boolean;
  sort_order: number;
  options: any;
  created_at: string;
  updated_at: string;
}

export const ABD_FIELD_CONFIG_QK = ["abd-field-config"] as const;

export function useAbdFieldConfig() {
  return useQuery({
    queryKey: ABD_FIELD_CONFIG_QK,
    queryFn: async (): Promise<AbdFieldConfigRow[]> => {
      const { data, error } = await (supabase as any)
        .from("abd_field_config")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AbdFieldConfigRow[];
    },
    staleTime: 30_000,
  });
}

export function useInvalidateAbdFieldConfig() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ABD_FIELD_CONFIG_QK }), [qc]);
}

/** field_config + 코드 상수 기반 라벨/그룹 조회 헬퍼 */
export function useAbdFieldHelpers() {
  const { data = [] } = useAbdFieldConfig();
  return useMemo(() => {
    const byField = new Map(data.map((r) => [r.field_key, r]));
    const codeByKey = new Map(ABD_COLUMNS.map((c) => [c.key, c] as const));

    const getLabel = (field: string): string => {
      const row = byField.get(field);
      if (row?.label) return row.label;
      return codeByKey.get(field)?.label ?? field;
    };
    const getGroup = (field: string): string | null => {
      const row = byField.get(field);
      if (row?.group) return row.group;
      return codeByKey.get(field)?.group ?? null;
    };
    return { getLabel, getGroup };
  }, [data]);
}

/**
 * field_config 기반 기본 컬럼 순서/노출.
 * field_config에 없는 코드 컬럼은 뒤에 append.
 */
export function useAbdDefaults() {
  const { data } = useAbdFieldConfig();
  return useMemo(() => {
    const rows = data ?? [];
    const codeKeys = ABD_COLUMNS.map((c) => c.key);
    const codeSet = new Set(codeKeys);
    const configured = rows
      .filter((r) => codeSet.has(r.field_key))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => r.field_key);
    const configuredSet = new Set(configured);
    const defaultOrder = rows.length
      ? [...configured, ...codeKeys.filter((k) => !configuredSet.has(k))]
      : codeKeys;
    const defaultVisibility: Record<string, boolean> = {};
    for (const r of rows) {
      if (codeSet.has(r.field_key)) defaultVisibility[r.field_key] = !!r.visible;
    }
    return { defaultOrder, defaultVisibility };
  }, [data]);
}

/** Admin 전용: abd_field_config UPDATE. RLS로 비관리자는 실패. */
export async function persistAbdFieldConfig(
  patches: Array<{ field_key: string; sort_order?: number; visible?: boolean; label?: string }>,
) {
  if (!patches.length) return;
  const results = await Promise.all(
    patches.map((p) => {
      const { field_key, ...patch } = p;
      return (supabase as any)
        .from("abd_field_config")
        .update(patch)
        .eq("field_key", field_key);
    }),
  );
  const err = results.find((r) => r.error)?.error;
  if (err) throw err;
}