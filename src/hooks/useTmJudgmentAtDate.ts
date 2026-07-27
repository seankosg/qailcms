import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Data Date 시맨틱: Actual% 는 현재값 유지, Plan/gap/judgment 만 as-of 재계산.
 * 서버 RPC `tm_judge_at_date` 결과를 그대로 반환한다. (스냅샷/Actual 이동 아님)
 */
export interface TmJudgmentRow {
  id: string;
  cum_plan_pct: number | null;
  cum_actual_pct: number | null;
  gap_pct: number | null;
  auto_judgment: string | null;
  delay_days: number | null;
  alarm_reason: string | null;
}

export function useTmJudgmentAtDate(asOf: string, enabled: boolean) {
  const q = useQuery({
    queryKey: ["tm-judge-at-date", asOf],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        "tm_judge_at_date",
        { p_data_date: asOf },
      );
      if (error) throw new Error(error.message);
      // 반환 계약: jsonb 배열 (행 상한 비적용).
      if (data != null && !Array.isArray(data)) {
        throw new Error("tm_judge_at_date RPC contract mismatch: expected jsonb array");
      }
      const rows = ((data ?? []) as unknown[]) as TmJudgmentRow[];
      const map = new Map<string, TmJudgmentRow>();
      for (const r of rows) map.set(r.id, r);
      return map;
    },
    enabled: enabled && !!asOf,
    staleTime: 60_000,
  });
  return { map: q.data ?? new Map<string, TmJudgmentRow>(), isLoading: q.isLoading, ready: !!q.data };
}

/** 병합 헬퍼 — 반드시 Actual 관련 컬럼은 건드리지 않는다. */
export function mergeTmJudgment<
  T extends { id: string; auto_judgment?: string | null },
>(items: T[], map: Map<string, TmJudgmentRow>): T[] {
  if (map.size === 0) return items;
  return items.map((it) => {
    const j = map.get(it.id);
    if (!j) return it;
    return {
      ...it,
      auto_judgment: j.auto_judgment ?? null,
      gap_pct: j.gap_pct ?? null,
      cum_plan_pct: j.cum_plan_pct ?? null,
      delay_days: j.delay_days ?? null,
      alarm_reason: j.alarm_reason ?? null,
    } as T;
  });
}