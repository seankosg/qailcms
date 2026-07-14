import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SPARE_PART_COLUMNS } from "@/lib/spare-part/columns";

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

/**
 * field_config에서 파생한 기본 컬럼 순서/노출.
 * `doc_ref`는 시스템 고정 컬럼이므로 제외.
 * field_config에 없는 신규 코드 컬럼은 코드 순서 그대로 뒤에 append.
 */
export function useSparePartDefaults() {
  const { data } = useSparePartFieldConfig();
  return useMemo(() => {
    const rows = data ?? [];
    const codeKeys = SPARE_PART_COLUMNS.map((c) => c.key).filter((k) => k !== "doc_ref");
    const codeSet = new Set(codeKeys);
    const configured = rows
      .filter((r) => codeSet.has(r.field_name) && r.field_name !== "doc_ref")
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

/** Admin 전용: 컬럼 순서/노출을 field_config에 반영. RLS로 비관리자는 실패. */
export async function persistSparePartFieldConfig(
  patches: Array<{ field_name: string; sort_order?: number; is_visible?: boolean }>,
) {
  if (!patches.length) return;
  const results = await Promise.all(
    patches.map((p) => {
      const { field_name, ...patch } = p;
      return (supabase as any)
        .from("spare_part_field_config")
        .update(patch)
        .eq("field_name", field_name);
    }),
  );
  const err = results.find((r) => r.error)?.error;
  if (err) throw err;
}
