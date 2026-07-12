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
  origin: "hdec" | "aconex" | "system" | null;
  source_label: string | null;
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

/** field_config에서 정의된 필수 필드 여부 (note에 "required" 포함 시 필수 취급).
 *  현재 스키마엔 별도 required 컬럼이 없으므로 note 힌트를 사용. */
export function useDefectFieldHelpers() {
  const { data = [] } = useDefectFieldConfig();
  return useMemo(() => {
    const byField = new Map(data.map((r) => [r.field_name, r]));

    const isFieldRequired = (field: string): boolean => {
      if (!field) return false;
      // 시스템 필수: source_issue_no
      if (field === "source_issue_no") return true;
      const row = byField.get(field);
      if (!row) return false;
      const note = (row.note ?? "").toLowerCase();
      return note.includes("required") || note.includes("필수");
    };

    const getLabel = (field: string): string => {
      const row = byField.get(field);
      if (row) return row.display_name;
      const code = DEFECT_COLUMNS.find((c) => c.key === field);
      return code?.label ?? field;
    };

    const getSourceLabel = (field: string): string => {
      const row = byField.get(field);
      if (row?.source_label) return row.source_label;
      // fallback rule-based
      if (field.startsWith("hdec_")) return "HDEC";
      return "System";
    };

    const getSourceOrigin = (field: string): "hdec" | "aconex" | "system" => {
      const row = byField.get(field);
      if (row?.origin) return row.origin;
      if (field.startsWith("hdec_")) return "hdec";
      return "system";
    };

    return { isFieldRequired, getLabel, getSourceLabel, getSourceOrigin };
  }, [data]);
}