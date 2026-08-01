import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * TM 정본 as-of 행 소스.
 * 서버 `tm_rows_as_of(_as_of)` = 실적 마스킹 + 정본 판정(tm_kpi_judgment_g, Main 가중 계획 tm_row_tplan) 적용.
 * jsonb 래퍼(`tm_rows_as_of_json`)를 경유해 PostgREST 1,000행 상한을 회피한다.
 */
export interface TmAsOfRow {
  id: string;
  auto_judgment: string | null;
  actual_progress: number | null;
  actual_start: string | null;
  actual_finish: string | null;
  cum_plan_pct: number | null;
  cum_actual_pct: number | null;
  gap_pct: number | null;
  delay_days: number | null;
  alarm_reason: string | null;
}

export function useTmRowsAsOf(asOf: string, enabled = true) {
  const q = useQuery({
    queryKey: ["tm-rows-as-of", asOf],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("tm_rows_as_of_json", {
        p_as_of: asOf,
      });
      if (error) throw new Error(error.message);
      if (data != null && !Array.isArray(data)) {
        throw new Error("tm_rows_as_of_json RPC contract mismatch: expected jsonb array");
      }
      const rows = ((data ?? []) as unknown[]) as TmAsOfRow[];
      const map = new Map<string, TmAsOfRow>();
      for (const r of rows) map.set(r.id, r);
      return map;
    },
    enabled: enabled && !!asOf,
    staleTime: 60_000,
  });
  return {
    map: q.data ?? new Map<string, TmAsOfRow>(),
    ready: !!q.data,
    isLoading: q.isLoading,
  };
}
