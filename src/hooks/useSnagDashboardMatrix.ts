import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MatrixRawRow, PlotKey, TeamKey } from "@/lib/defect-management/dashboard-shape";
import { planGroupsForPlot } from "@/lib/defect-management/dashboard-shape";

export function useSnagDashboardMatrix(plot: PlotKey, teams: TeamKey[], asOfDate?: string | null) {
  return useQuery<MatrixRawRow[]>({
    queryKey: ["snag-dashboard-matrix", plot, [...teams].sort().join(","), asOfDate ?? ""],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("defect_snag_dashboard_matrix_json", {
        _plan_groups: planGroupsForPlot(plot),
        _teams: teams.length ? teams : null,
        _as_of_date: asOfDate || null,
      });
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) throw new Error("defect_snag_dashboard_matrix_json RPC contract mismatch");
      return (data ?? []).map((r: any) => ({
        plan_group: r.plan_group ?? null,
        building: r.building ?? null,
        level_name: r.level_name ?? null,
        room_group: r.room_group ?? null,
        room: r.room ?? null,
        subcontractor: r.subcontractor ?? null,
        team: r.team ?? null,
        status_raw: r.status_raw ?? null,
        cnt: Number(r.cnt) || 0,
        rect_cnt: Number(r.rect_cnt) || 0,
        closed_cnt: Number(r.closed_cnt) || 0,
      })) as MatrixRawRow[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
