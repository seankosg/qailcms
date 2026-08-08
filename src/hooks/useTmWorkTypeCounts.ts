import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TmCountsFilters } from "./useTmItemsCounts";

export interface TmWorkTypeTeamEntry {
  team: string;
  isNull: boolean;
  count: number;
  delayed: number;
}

export interface TmWorkTypeEntry {
  work_type: string;
  isNull: boolean;
  count: number;
  delayed: number;
  by_team: TmWorkTypeTeamEntry[];
}

export interface TmWorkTypeCounts {
  total: number;
  delayed_total: number;
  items: TmWorkTypeEntry[];
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

/** Actual % < 100% 인 Subtask 를 Work Type(row_type) 별로 집계 (서버 정본).
 *  지연 = Cum. Diff(tm_row_gap) < 0. */
export function useTmWorkTypeCounts(params: {
  filters: TmCountsFilters;
  asOf: string;
  enabled?: boolean;
}) {
  const { filters, asOf, enabled = true } = params;
  const args = {
    _q: filters.q?.trim() || null,
    _filters: buildFilters(filters) as unknown as any,
    _include_inactive: false,
    _as_of: asOf || null,
  };
  return useQuery({
    queryKey: ["tm-worktype-incomplete-counts", args],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<TmWorkTypeCounts> => {
      const { data, error } = await (supabase as any).rpc("tm_worktype_incomplete_counts", args);
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as any;
      return {
        total: Number(d.total ?? 0),
        delayed_total: Number(d.delayed_total ?? 0),
        items: (d.items ?? []) as TmWorkTypeEntry[],
      };
    },
  });
}