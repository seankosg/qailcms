import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { planGroupsForPlot, type PlotKey, type TeamKey } from "@/lib/defect-management/dashboard-shape";
import type { StageDateRawRow } from "@/lib/defect-management/stage-dates";

export function useSnagStageDates(
  plot: PlotKey,
  teams: TeamKey[],
  asOfDate?: string | null,
  enabled = true,
) {
  return useQuery<StageDateRawRow[]>({
    queryKey: ["snag-stage-dates", plot, [...teams].sort().join(","), asOfDate ?? ""],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("defect_snag_stage_dates_json", {
        _plan_groups: planGroupsForPlot(plot),
        _teams: teams.length ? teams : null,
        _as_of_date: asOfDate || null,
      });
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) throw new Error("defect_snag_stage_dates_json RPC contract mismatch");
      return (data ?? []).map((r: any) => ({
        building: r.building ?? null,
        level_name: r.level_name ?? null,
        room_group: r.room_group ?? null,
        room: r.room ?? null,
        subcontractor: r.subcontractor ?? null,
        team: r.team ?? null,
        p_rect: r.p_rect ?? null,
        p_pre: r.p_pre ?? null,
        p_dar: r.p_dar ?? null,
        p_closed: r.p_closed ?? null,
        p_ho: r.p_ho ?? null,
        a_rect: r.a_rect ?? null,
        a_pre: r.a_pre ?? null,
        a_dar: r.a_dar ?? null,
        a_closed: r.a_closed ?? null,
        a_ho: r.a_ho ?? null,
      })) as StageDateRawRow[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}