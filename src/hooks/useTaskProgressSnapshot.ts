import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface CacheRow {
  discipline: string | null;
  task_no: string;
  actual_points: Array<{ d: string; v: number }> | null;
  last_actual_progress: number | null;
}

export interface TaskProgressSnapshot {
  /** 주어진 asOf 이하 가장 최근 actual point의 v (0..1). 데이터 없으면 null. */
  actualAt(disciplineTaskKey: string, asOf: string): number | null;
  /** 저장된 일자별 실적 스냅샷 포인트 전체 (S-Curve 실측 구간 판정용). */
  pointsOf(disciplineTaskKey: string): Array<{ d: string; v: number }> | null;
  ready: boolean;
}

function keyOf(discipline: string | null | undefined, task_no: string | null | undefined) {
  return `${(discipline ?? "").trim()}::${(task_no ?? "").trim()}`;
}

async function fetchAll(): Promise<Map<string, CacheRow>> {
  const pageSize = 1000;
  const map = new Map<string, CacheRow>();
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await (supabase as any)
      .from("task_progress_chart_cache")
      .select("discipline, task_no, actual_points, last_actual_progress")
      .order("task_no", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CacheRow[];
    for (const r of rows) {
      map.set(keyOf(r.discipline, r.task_no), r);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 40000) break;
  }
  return map;
}

export function useTaskProgressSnapshot(): TaskProgressSnapshot & { isLoading: boolean } {
  const q = useQuery({
    queryKey: ["task-progress-snapshot"],
    queryFn: fetchAll,
    staleTime: 5 * 60_000,
  });
  const map = q.data;
  return {
    ready: !!map,
    isLoading: q.isLoading,
    pointsOf(key: string) {
      if (!map) return null;
      const row = map.get(key);
      const pts = row?.actual_points ?? null;
      if (!pts || !pts.length) return null;
      return pts;
    },
    actualAt(key: string, asOf: string) {
      if (!map) return null;
      const row = map.get(key);
      if (!row) return null;
      const pts = row.actual_points ?? [];
      if (!pts.length) return null;
      // pick last point with d <= asOf
      let best: number | null = null;
      for (const p of pts) {
        if (!p || typeof p.d !== "string") continue;
        if (p.d.slice(0, 10) <= asOf.slice(0, 10)) {
          best = Number(p.v ?? 0);
        } else {
          break;
        }
      }
      return best;
    },
  };
}

export function snapshotKey(discipline: string | null | undefined, task_no: string | null | undefined) {
  return keyOf(discipline, task_no);
}