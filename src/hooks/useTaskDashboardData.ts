import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TaskItem } from "@/lib/task-management/schedule-utils";

export interface TaskDashboardFilters {
  disciplines: string[];
  plots: string[];
  teams: string[];
  level: "child" | "parent" | "all";
  q: string;
}

const SELECT_COLS =
  "id, task_no, task_name, discipline, team, plot, pic, category, floor_level, risk, level, status_manual, auto_judgment, plan_start, plan_end, actual_start, actual_progress, slip_days, data_date";

async function fetchAll(filters: TaskDashboardFilters): Promise<TaskItem[]> {
  const pageSize = 1000;
  const out: TaskItem[] = [];
  let from = 0;
  let latestDataDate: string | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = (supabase as any)
      .from("task_management_raw")
      .select(SELECT_COLS)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (filters.level !== "all") query = query.eq("level", filters.level);
    if (filters.disciplines.length) query = query.in("discipline", filters.disciplines);
    if (filters.plots.length) query = query.in("plot", filters.plots);
    if (filters.teams.length) query = query.in("team", filters.teams);
    if (filters.q.trim()) {
      const q = filters.q.trim().replace(/[%,]/g, "");
      query = query.or(
        `task_no.ilike.%${q}%,task_name.ilike.%${q}%,pic.ilike.%${q}%,category.ilike.%${q}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as (TaskItem & { data_date?: string | null })[];
    for (const r of rows) {
      if (r.data_date && (!latestDataDate || r.data_date > latestDataDate)) {
        latestDataDate = String(r.data_date).slice(0, 10);
      }
    }
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 20000) break; // safety
  }
  (out as any).latestDataDate = latestDataDate;
  return out;
}

export function useTaskDashboardData(filters: TaskDashboardFilters) {
  return useQuery({
    queryKey: ["task-dashboard", filters],
    queryFn: () => fetchAll(filters),
    staleTime: 30_000,
  });
}

export function getLatestDataDate(items: TaskItem[] | undefined): string | null {
  if (!items) return null;
  return ((items as any).latestDataDate as string | null) ?? null;
}