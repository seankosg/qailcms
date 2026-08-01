import { useMemo } from "react";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import { useTmAsOfRows } from "@/hooks/useTmRowsAsOf";

export interface TaskDashboardFilters {
  disciplines: string[];
  plots: string[];
  teams: string[];
  hdecPic?: string[];
  hdecEng?: string[];
  level: "sub" | "main" | "all";
  q: string;
}

function matches(r: any, f: TaskDashboardFilters): boolean {
  if (f.level !== "all" && String(r.level ?? "") !== f.level) return false;
  if (f.disciplines.length && !f.disciplines.includes(r.discipline)) return false;
  if (f.plots.length && !f.plots.includes(r.plot)) return false;
  if (f.teams.length && !f.teams.includes(r.team)) return false;
  if (f.hdecPic?.length && !f.hdecPic.includes(r.hdec_pic_name)) return false;
  if (f.hdecEng?.length && !f.hdecEng.includes(r.hdec_eng_name)) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [r.task_no, r.task_name, r.hdec_pic_name, r.hdec_eng_name, r.category]
      .map((v) => String(v ?? "").toLowerCase())
      .join("|");
    if (!hay.includes(q)) return false;
  }
  return true;
}

/**
 * TM 대시보드 행 소스 = 정본 `tm_rows_as_of(_as_of)` 단일.
 * 필터는 클라이언트에서 적용한다(원시 테이블 직조회 금지).
 */
export function useTaskDashboardData(filters: TaskDashboardFilters, asOf: string) {
  const q = useTmAsOfRows(asOf);
  const data = useMemo(() => {
    const rows = (q.data ?? []).filter((r) => matches(r, filters)) as unknown as TaskItem[];
    let latest: string | null = null;
    for (const r of q.data ?? []) {
      const d = r.data_date ? String(r.data_date).slice(0, 10) : "";
      if (d && (!latest || d > latest)) latest = d;
    }
    (rows as any).latestDataDate = latest;
    return rows;
  }, [q.data, filters]);
  return { ...q, data: q.data ? data : undefined };
}

export function getLatestDataDate(items: TaskItem[] | undefined): string | null {
  if (!items) return null;
  return ((items as any).latestDataDate as string | null) ?? null;
}
