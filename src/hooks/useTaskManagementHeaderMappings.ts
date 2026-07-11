import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TaskManagementHeaderMappingRow {
  id: string;
  module: string;
  source_header: string;
  target_field: string;
  is_custom: boolean;
  is_active: boolean;
  note: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const TASK_MANAGEMENT_HEADER_MAPPING_QK = ["task-management-header-mappings"] as const;

export function useTaskManagementHeaderMappings() {
  return useQuery({
    queryKey: TASK_MANAGEMENT_HEADER_MAPPING_QK,
    queryFn: async (): Promise<TaskManagementHeaderMappingRow[]> => {
      const { data, error } = await (supabase as any)
        .from("task_management_header_mappings")
        .select("*")
        .order("target_field", { ascending: true })
        .order("source_header", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaskManagementHeaderMappingRow[];
    },
    staleTime: 30_000,
  });
}