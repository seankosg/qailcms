import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_THRESHOLDS, type TaskThresholds } from "@/lib/task-management/derived";
import type { TaskScope } from "@/lib/task-management/kpi-utils";

export interface TmCountsFilters {
  team?: string[];
  hdec_pic_name?: string[];
  hdec_eng_name?: string[];
  discipline?: string[];
  plot?: string[];
  q?: string;
}

export interface TmCounts {
  total: number;
  completed: number;
  wip: number;
  not_started: number;
  planned_started: number;
  actual_started: number;
  in_delay: number;
  start_delayed: number;
  completion_overdue: number;
  critical: number;
  behind: number;
  no_plan_start: number;
  no_plan_end: number;
}

export interface TmCountsByTeamEntry {
  team: string;
  isNull: boolean;
  count: number;
}

export interface TmCountsByTeam {
  in_delay: TmCountsByTeamEntry[];
  start_delayed: TmCountsByTeamEntry[];
  completion_overdue: TmCountsByTeamEntry[];
  critical_delay: TmCountsByTeamEntry[];
  behind_schedule: TmCountsByTeamEntry[];
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

export function useTmItemsCounts(params: {
  filters: TmCountsFilters;
  taskScope: TaskScope;
  asOfDate: string;
  thresholds?: TaskThresholds;
  enabled?: boolean;
}) {
  const { filters, taskScope, asOfDate, enabled = true } = params;
  const t = params.thresholds ?? DEFAULT_THRESHOLDS;
  const filterArr = buildFilters(filters);
  const q = filters.q?.trim() ?? "";

  const args = {
    _filters: filterArr as unknown as any,
    _q: q || undefined,
    _task_scope: taskScope,
    _as_of: asOfDate,
    _worsen_gap: t.worsen_gap,
    _caution_buffer: t.caution_gap_buffer,
  };

  const countsQ = useQuery({
    queryKey: ["tm-items-counts", args],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<TmCounts> => {
      const { data, error } = await (supabase as any).rpc("tm_items_counts", args);
      if (error) throw new Error(error.message);
      return (data ?? {}) as TmCounts;
    },
  });

  const teamQ = useQuery({
    queryKey: ["tm-items-counts-by-team", args],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<TmCountsByTeam> => {
      const { data, error } = await (supabase as any).rpc("tm_items_counts_by_team", args);
      if (error) throw new Error(error.message);
      return (data ?? {}) as TmCountsByTeam;
    },
  });

  return {
    counts: countsQ.data,
    byTeam: teamQ.data,
    isLoading: countsQ.isLoading || teamQ.isLoading,
    error: countsQ.error ?? teamQ.error,
  };
}