import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_THRESHOLDS, type TaskThresholds } from "@/lib/task-management/derived";

export const TASK_SETTINGS_QUERY_KEY = ["task-settings"] as const;

/** TM 임계값 단일 소스(tm_alarm_settings → tm_thresholds RPC)를 로드한다.
 *  판정(서버 RPC)·색상 강조(클라이언트) 모두 이 값을 경유해야 한다. */
export function useTaskManagementSettings() {
  return useQuery<TaskThresholds>({
    queryKey: TASK_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("tm_thresholds");
      if (error) throw error;
      if (!data) return { ...DEFAULT_THRESHOLDS };
      return {
        caution_gap_buffer: Number(
          data.caution_gap_buffer ?? DEFAULT_THRESHOLDS.caution_gap_buffer,
        ),
        worsen_gap: Number(data.worsen_gap ?? DEFAULT_THRESHOLDS.worsen_gap),
      } satisfies TaskThresholds;
    },
    staleTime: 30_000,
  });
}