import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_THRESHOLDS, type TaskThresholds } from "@/lib/task-management/derived";

export const TASK_SETTINGS_QUERY_KEY = ["task-settings"] as const;

/** task_management_settings 단일 행을 로드한다. 없으면 기본값. */
export function useTaskManagementSettings() {
  return useQuery<TaskThresholds>({
    queryKey: TASK_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_settings")
        .select("*")
        .eq("id", "default")
        .maybeSingle();
      if (error) throw error;
      if (!data) return { ...DEFAULT_THRESHOLDS };
      return {
        behind_warn_gap: Number(data.behind_warn_gap ?? DEFAULT_THRESHOLDS.behind_warn_gap),
        behind_late_gap: Number(data.behind_late_gap ?? DEFAULT_THRESHOLDS.behind_late_gap),
        slip_warn_days: Number(data.slip_warn_days ?? DEFAULT_THRESHOLDS.slip_warn_days),
        slip_late_days: Number(data.slip_late_days ?? DEFAULT_THRESHOLDS.slip_late_days),
      } satisfies TaskThresholds;
    },
    staleTime: 30_000,
  });
}