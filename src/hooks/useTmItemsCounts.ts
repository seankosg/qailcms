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

export interface TmWeightedProgress {
  planned: number; // 0..100
  actual: number; // 0..100
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

  // 가중 진도(%) — 서버 정본 (tm_items_weighted_progress).
  const weightedArgs = {
    _q: q || null,
    _filters: (() => {
      // taskScope 를 서버 필터에 포함시켜 total/counts 와 동일 스코프 보장.
      const base = [...filterArr];
      if (taskScope !== "all") {
        base.push({
          column: "level",
          op: "in",
          value: [taskScope === "main" ? "main" : "sub"],
        } as any);
      }
      return base as unknown as any;
    })(),
    _include_inactive: false,
    _as_of: asOfDate,
  };
  const weightedQ = useQuery({
    queryKey: ["tm-items-weighted", weightedArgs],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<TmWeightedProgress> => {
      const { data, error } = await (supabase as any).rpc(
        "tm_items_weighted_progress",
        weightedArgs,
      );
      if (error) throw new Error(error.message);
      const obj = (data ?? {}) as {
        planned?: number;
        actual?: number;
        planned_pct?: number;
        actual_pct?: number;
      };
      return {
        planned: Number(obj.planned_pct ?? obj.planned ?? 0),
        actual: Number(obj.actual_pct ?? obj.actual ?? 0),
      };
    },
  });

  return {
    counts: countsQ.data,
    byTeam: teamQ.data,
    weighted: weightedQ.data,
    isLoading: countsQ.isLoading || teamQ.isLoading || weightedQ.isLoading,
    isError: countsQ.isError || teamQ.isError || weightedQ.isError,
    error: countsQ.error ?? teamQ.error ?? weightedQ.error,
    /** RPC 별 실패 원문 — 배너에 그대로 노출한다(원인 추적용). */
    errors: [
      { rpc: "tm_items_counts", error: countsQ.error },
      { rpc: "tm_items_counts_by_team", error: teamQ.error },
      { rpc: "tm_items_weighted_progress", error: weightedQ.error },
    ].filter((e) => !!e.error) as Array<{ rpc: string; error: unknown }>,
  };
}