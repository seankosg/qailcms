import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * 과거 판정(As-of 과거 선택) = "지금의 계획에 비추면 그때 어디였나".
 * - Plan%  : 현재본 계획을 p_data_date 까지 평가 (계획 버전 소급 없음 = 재계획 존중 원칙)
 * - Actual%: status_history 의 그 시점 관측치. 이력이 없으면 actual_source='none'.
 * 서버 RPC `tm_judge_at_date` 결과를 그대로 반환한다.
 */
export interface TmJudgmentRow {
  id: string;
  cum_plan_pct: number | null;
  cum_actual_pct: number | null;
  gap_pct: number | null;
  auto_judgment: string | null;
  delay_days: number | null;
  alarm_reason: string | null;
  /** 'history' | 'none' — 'none' 이면 그 시점 관측 이력이 없음 */
  actual_source?: string | null;
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