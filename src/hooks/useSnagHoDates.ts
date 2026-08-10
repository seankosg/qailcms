import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { planGroupsForPlot, type PlotKey, type TeamKey } from "@/lib/defect-management/dashboard-shape";
import type { HoDateRawRow } from "@/lib/defect-management/ho-dates";

export function useSnagHoDates(
  plot: PlotKey,
  teams: TeamKey[],
  asOfDate?: string | null,
  enabled = true,
) {
  return useQuery<HoDateRawRow[]>({
    queryKey: ["snag-ho-dates", plot, [...teams].sort().join(","), asOfDate ?? ""],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("defect_snag_ho_dates_json", {
        _plan_groups: planGroupsForPlot(plot),
        _teams: teams.length ? teams : null,
        _as_of_date: asOfDate || null,
      });
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) throw new Error("defect_snag_ho_dates_json RPC contract mismatch");
      return (data ?? []).map((r: any) => ({
        building: r.building ?? null,
        level_name: r.level_name ?? null,
        room_group: r.room_group ?? null,
        room: r.room ?? null,
        subcontractor: r.subcontractor ?? null,
        ho_max: r.ho_max ?? null,
      })) as HoDateRawRow[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
