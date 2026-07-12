import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DefectFilters {
  teams: string[];
  status: string[];
  q: string;
  includeInactive: boolean;
}

const PAGE_SIZE = 1000;
const SAFETY_CAP = 40000;

export interface DefectItem {
  id: string;
  source_issue_no: string;
  team: string;
  data_date: string | null;
  source_import_log_id: string | null;
  is_active: boolean;

  location_raw: string | null;
  plan_title: string | null;
  plan_group: string | null;
  status_raw: string | null;
  assigned_to: string | null;
  category: string | null;
  defect_type: string | null;
  item: string | null;
  description: string | null;
  priority: string | null;
  due_by: string | null;
  created_by_name: string | null;
  created_by_team_name: string | null;
  created_date: string | null;
  ir: string | null;
  forms: string | null;
  last_updated_at: string | null;
  updated_description: string | null;
  updated_by_name: string | null;
  updated_status: string | null;
  updated_date_raw: string | null;
  location_reference: string | null;
  classification: string | null;
  podium_area: string | null;

  issue_no: string | null;
  subcontractor_issue_no: string | null;
  subcontractor_issue_source: string | null;
  main_trade: string | null;
  sub_trade: string | null;
  trade_detail: string | null;
  area_type: string | null;
  area_level: string | null;
  area_location: string | null;
  subcontractor_name: string | null;
  subsub_name: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  captured_by_name: string | null;
  work_type: string | null;
  classification_source: string | null;
  classified_at: string | null;
  planned_start_date: string | null;
  planned_completion_date: string | null;
  planned_closure_date: string | null;
  actual_start_date: string | null;
  actual_completion_date: string | null;
  actual_closure_date: string | null;
  planned_progress_pct: number | null;
  actual_progress_pct: number | null;
  completion_status: string | null;
  closure_status: string | null;
  status_manual: string | null;
  hdec_verification: string | null;
  hdec_reason: string | null;
  hdec_comments: string | null;
  aconex_comments: string | null;
  remarks: string | null;

  priority_locked: boolean;
  hdec_verification_locked: boolean;
  is_critical: boolean;

  created_at: string;
  updated_at: string;
}

async function fetchAll(filters: DefectFilters): Promise<DefectItem[]> {
  const out: DefectItem[] = [];
  let from = 0;
  let latestDataDate: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = (supabase as any)
      .from("defect_items_raw")
      .select("*")
      .order("source_issue_no", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (!filters.includeInactive) query = query.eq("is_active", true);
    if (filters.teams.length) query = query.in("team", filters.teams);
    if (filters.status.length) query = query.in("status_raw", filters.status);
    if (filters.q.trim()) {
      const q = filters.q.trim().replace(/[%,]/g, "");
      query = query.or(
        `source_issue_no.ilike.%${q}%,description.ilike.%${q}%,location_raw.ilike.%${q}%,assigned_to.ilike.%${q}%,subcontractor_name.ilike.%${q}%,hdec_pic_name.ilike.%${q}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DefectItem[];
    for (const r of rows) {
      if (r.data_date && (!latestDataDate || r.data_date > latestDataDate)) {
        latestDataDate = String(r.data_date).slice(0, 10);
      }
    }
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (from > SAFETY_CAP) break;
  }
  (out as any).latestDataDate = latestDataDate;
  return out;
}

export function useDefectRawData(filters: DefectFilters) {
  return useQuery({
    queryKey: ["defect-raw-data", filters],
    queryFn: () => fetchAll(filters),
    staleTime: 30_000,
  });
}

export function getDefectLatestDataDate(items: DefectItem[] | undefined): string | null {
  if (!items) return null;
  return ((items as any).latestDataDate as string | null) ?? null;
}