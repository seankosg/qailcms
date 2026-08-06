import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TaskScope } from "@/lib/task-management/kpi-utils";
import type { TmCountsFilters, TmCountsByTeamEntry } from "./useTmItemsCounts";

export type OverdueBadge = "WARNING" | "RISK" | "SAFE" | "PASS";

export interface TmOverdueCounts {
  total: number;
  plan: Record<string, number>;
  actual: Record<string, number>;
  plan_by_team: Record<string, TmCountsByTeamEntry[]>;
  actual_by_team: Record<string, TmCountsByTeamEntry[]>;
}

function buildFilters(f: TmCountsFilters) {
  const arr: Array<{ column: string; op: "in"; value: string[] }> = [];
  const push = (col: string, v?: string[]) => {
    if (v && v.length) arr.push({ column: col, op: "in", value: v });
  };
  push("team", f.team);
  push("hdec_pic_name", f.hdec_pic_name);
  push("hdec_eng_name", f.hdec_eng_name);
  push("discipline", f.discipline);
  push("plot", f.plot);
  return arr;
}

/** Raw Data 의 Plan/Actual Overdue 뱃지 기준 집계 (서버 정본). */
export function useTmMilestoneOverdueCounts(params: {
  filters: TmCountsFilters;
  taskScope: TaskScope;
  enabled?: boolean;
}) {
  const { filters, taskScope, enabled = true } = params;
  const args = {
    _q: filters.q?.trim() || null,
    _filters: buildFilters(filters) as unknown as any,
    _include_inactive: false,
    _task_scope: taskScope,
  };
  return useQuery({
    queryKey: ["tm-milestone-overdue-counts", args],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<TmOverdueCounts> => {
      const { data, error } = await (supabase as any).rpc("tm_milestone_overdue_counts", args);
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as any;
      return {
        total: Number(d.total ?? 0),
        plan: (d.plan ?? {}) as Record<string, number>,
        actual: (d.actual ?? {}) as Record<string, number>,
        plan_by_team: (d.plan_by_team ?? {}) as Record<string, TmCountsByTeamEntry[]>,
        actual_by_team: (d.actual_by_team ?? {}) as Record<string, TmCountsByTeamEntry[]>,
      };
    },
  });
}
