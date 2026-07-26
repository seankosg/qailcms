import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TmJudgmentRow {
  id: string;
  effective_actual_progress: number | null;
  cum_plan_pct: number | null;
  cum_actual_pct: number | null;
  gap_pct: number | null;
  auto_judgment: string | null;
  delay_days: number | null;
  alarm_reason: string | null;
}

/**
 * 지정한 Data Date 기준의 서버측 재판정 결과를 조회.
 * asOf 가 비어있거나 최신 Data Date 와 동일하면 호출하지 않고 map={} 반환.
 */
export function useTmJudgmentAtDate(asOf: string, enabled: boolean) {
  const q = useQuery({
    queryKey: ["tm-judge-at-date-snapshot", asOf],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        "tm_judge_snapshot_at_date",
        { p_data_date: asOf },
      );
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as TmJudgmentRow[];
      const map = new Map<string, TmJudgmentRow>();
      for (const r of rows) map.set(r.id, r);
      return map;
    },
    enabled: enabled && !!asOf,
    staleTime: 60_000,
  });
  return { map: q.data ?? new Map<string, TmJudgmentRow>(), isLoading: q.isLoading, ready: !!q.data };
}