import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SPL_COLUMNS } from "@/components/spl/raw-data/spl-columns";

export interface SplFieldConfigRow {
  id: string;
  field_key: string;
  label: string;
  group: string | null;
  data_type: string;
  editable: boolean;
  visible: boolean;
  sort_order: number;
  source_group: "hdec" | "aconex" | "system";
  options: any;
  created_at: string;
  updated_at: string;
}

export const SPL_FIELD_CONFIG_QK = ["spl-field-config"] as const;

export function useSplFieldConfig() {
  return useQuery({
    queryKey: SPL_FIELD_CONFIG_QK,
    queryFn: async (): Promise<SplFieldConfigRow[]> => {
      const { data, error } = await (supabase as any)
        .from("spl_field_config")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SplFieldConfigRow[];
    },
    staleTime: 30_000,
  });
}

export function useInvalidateSplFieldConfig() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: SPL_FIELD_CONFIG_QK }), [qc]);
}

/** field_config + 코드 상수 기반 라벨 조회 헬퍼 (ABD 와 동일 규칙) */
export function useSplFieldHelpers() {
  const { data = [] } = useSplFieldConfig();
  return useMemo(() => {
    const byField = new Map(data.map((r) => [r.field_key, r]));
    const codeByKey = new Map(SPL_COLUMNS.map((c) => [c.key, c] as const));
    const getLabel = (field: string): string => {
      const row = byField.get(field);
      if (row?.label) return row.label;
      return codeByKey.get(field)?.label ?? field;
    };
    const getGroup = (field: string): string | null => byField.get(field)?.group ?? null;
    return { getLabel, getGroup };
  }, [data]);
}

/** Admin 전용: spl_field_config UPDATE. RLS 로 비관리자는 실패. */
export async function persistSplFieldConfig(
  patches: Array<{ field_key: string; sort_order?: number; visible?: boolean; label?: string }>,
) {
  if (!patches.length) return;
  const results = await Promise.all(
    patches.map((p) => {
      const { field_key, ...patch } = p;
      return (supabase as any).from("spl_field_config").update(patch).eq("field_key", field_key);
    }),
  );
  const err = results.find((r) => r.error)?.error;
  if (err) throw err;
}
