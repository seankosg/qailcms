import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * TM Milestone 선택지 정본.
 * - 활성 종류(tm_milestone_kinds.is_active) 만 후보로 둔다.
 * - Plot 별 등록 목록(tm_milestone_config.plot) 으로 좁힌다.
 * - 해당 Plot 에 등록이 하나도 없으면 '공통' 등록분을 쓰고, 그것도 없으면 전체 활성 종류.
 */
const COMMON_PLOT = "공통";
/** Plot 별칭 — G 는 별도 등록 없이 '공통' 등록분을 참조한다. */
const PLOT_ALIAS: Record<string, string> = { G: COMMON_PLOT };

export interface TmMilestoneOptions {
  allCodes: string[];
  /** 특정 Plot 에서 선택 가능한 코드 목록 */
  optionsForPlot: (plot: unknown) => string[];
  /** 여러 Plot 이 섞인 경우(일괄 편집) — 교집합 */
  optionsForPlots: (plots: unknown[]) => string[];
}

export function useTmMilestoneOptions(): TmMilestoneOptions {
  const { data } = useQuery({
    queryKey: ["tm_milestone_options", "by-plot"],
    queryFn: async () => {
      const [kindsRes, cfgRes] = await Promise.all([
        (supabase as any)
          .from("tm_milestone_kinds")
          .select("kind_code, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        (supabase as any).from("tm_milestone_config").select("kind, plot"),
      ]);
      if (kindsRes.error) throw kindsRes.error;
      if (cfgRes.error) throw cfgRes.error;
      const allCodes: string[] = (kindsRes.data ?? []).map(
        (r: { kind_code: string }) => r.kind_code,
      );
      const order = new Map(allCodes.map((c, i) => [c, i]));
      const byPlot: Record<string, string[]> = {};
      for (const r of (cfgRes.data ?? []) as { kind: string; plot: string }[]) {
        if (!r?.plot || !r?.kind) continue;
        if (!order.has(r.kind)) continue;
        (byPlot[r.plot] ??= []).push(r.kind);
      }
      for (const k of Object.keys(byPlot)) {
        byPlot[k] = Array.from(new Set(byPlot[k])).sort(
          (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
        );
      }
      return { allCodes, byPlot };
    },
    staleTime: 60_000,
  });

  const allCodes = data?.allCodes ?? [];
  const byPlot = data?.byPlot ?? {};

  const optionsForPlot = useCallback(
    (plot: unknown) => {
      const raw = typeof plot === "string" ? plot.trim() : "";
      const key = PLOT_ALIAS[raw.toUpperCase()] ?? raw;
      if (key && byPlot[key]?.length) return byPlot[key];
      if (byPlot[COMMON_PLOT]?.length) return byPlot[COMMON_PLOT];
      return allCodes;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  const optionsForPlots = useCallback(
    (plots: unknown[]) => {
      const lists = Array.from(
        new Set(plots.map((p) => (typeof p === "string" ? p.trim() : ""))),
      ).map((p) => optionsForPlot(p));
      if (lists.length === 0) return allCodes;
      return lists.reduce((acc, cur) => acc.filter((c) => cur.includes(c)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optionsForPlot, data],
  );

  return { allCodes, optionsForPlot, optionsForPlots };
}
