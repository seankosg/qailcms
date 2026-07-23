import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ChartPoint {
  d: string; // YYYY-MM-DD
  v: number; // 0..1
}

export interface TaskChartCache {
  task_no: string;
  plan_points: ChartPoint[];
  actual_points: ChartPoint[];
  x_start: string | null;
  x_end: string | null;
  last_plan_progress: number | null;
  last_actual_progress: number | null;
  last_plan_at_dd?: number | null;
  last_actual_at_dd?: number | null;
  updated_at: string;
}

/** Task Tree 진입 시 공종 단위 캐시 벌크 조회 (재계산 없음). */
export const getTaskProgressChartsBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({ discipline: z.string().min(1) }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("task_progress_chart_cache")
      .select(
        "task_no, plan_points, actual_points, x_start, x_end, last_plan_progress, last_actual_progress, last_plan_at_dd, last_actual_at_dd, updated_at",
      )
      .eq("discipline", data.discipline);
    if (error) throw new Error(error.message);
    return (rows ?? []) as TaskChartCache[];
  });

/** 팝업 오픈 시 개별 항목 즉시 재계산.
 *  Plan 곡선: plan_start..plan_end 를 60포인트 균등 샘플.
 *  Actual 곡선: status_history(field=actual_progress) 시간 오름차순 + 폴백. */
export const getTaskProgressChartDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        discipline: z.string().min(1),
        task_no: z.string().min(1),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const supa = context.supabase as any;

    const { data: rawRow, error: rawErr } = await supa
      .from("task_management_raw")
      .select(
        "task_no, task_name, plan_start, plan_end, actual_start, actual_finish, actual_progress, data_date",
      )
      .eq("discipline", data.discipline)
      .eq("task_no", data.task_no)
      .maybeSingle();
    if (rawErr) throw new Error(rawErr.message);
    if (!rawRow) throw new Error("Task not found");

    const { data: hist, error: histErr } = await supa
      .from("task_management_status_history")
      .select("new_value, changed_at")
      .eq("discipline", data.discipline)
      .eq("task_no", data.task_no)
      .eq("field", "actual_progress")
      .not("new_value", "is", null)
      .order("changed_at", { ascending: true })
      .limit(2000);
    if (histErr) throw new Error(histErr.message);

    const NPTS = 60;
    const plan_points: ChartPoint[] = [];
    const ps = rawRow.plan_start ? new Date(`${rawRow.plan_start}T00:00:00Z`) : null;
    const pe = rawRow.plan_end ? new Date(`${rawRow.plan_end}T00:00:00Z`) : null;
    if (ps && pe && pe.getTime() > ps.getTime()) {
      const durationMs = pe.getTime() - ps.getTime();
      // Calendar-day linear plan: aligns with Raw Data Cum. Plan / T.Plan
      const pdays = Math.max(1, durationMs / 86400000);
      for (let i = 0; i < NPTS; i++) {
        const t = new Date(ps.getTime() + (durationMs * i) / (NPTS - 1));
        const days = (t.getTime() - ps.getTime()) / 86400000;
        const v = Math.max(0, Math.min(1, days / pdays));
        plan_points.push({ d: t.toISOString().slice(0, 10), v: Number(v.toFixed(4)) });
      }
    }

    // Actual curve: start anchor (actual_start ?? plan_start, v=0)
    //  → mid history snapshots (strictly between anchors)
    //  → last anchor (data_date, actual_progress)
    // No history ⇒ two-point linear = "일할 역계산" inference.
    const actual_points: ChartPoint[] = [];
    const startAnchorDate: string | null =
      (rawRow.actual_start ? String(rawRow.actual_start).slice(0, 10) : null) ??
      (rawRow.plan_start ? String(rawRow.plan_start).slice(0, 10) : null);
    const lastAnchorDate: string | null = rawRow.data_date
      ? String(rawRow.data_date).slice(0, 10)
      : null;
    const lastAnchorVal: number | null =
      rawRow.actual_progress != null
        ? Math.max(0, Math.min(1, Number(rawRow.actual_progress)))
        : null;

    if (startAnchorDate) {
      actual_points.push({ d: startAnchorDate, v: 0 });
    }

    const validHist = ((hist ?? []) as { new_value: string | null; changed_at: string }[])
      .filter((h) => h.new_value != null && h.new_value !== "")
      .map((h) => {
        const dohaShift = new Date(new Date(h.changed_at).getTime() + 3 * 3600_000);
        return {
          d: dohaShift.toISOString().slice(0, 10),
          v: Math.max(0, Math.min(1, Number(h.new_value) || 0)),
        };
      })
      .filter(
        (p) =>
          (!startAnchorDate || p.d > startAnchorDate) &&
          (!lastAnchorDate || p.d < lastAnchorDate),
      );
    for (const p of validHist) {
      actual_points.push({ d: p.d, v: Number(p.v.toFixed(4)) });
    }

    if (lastAnchorDate && lastAnchorVal != null) {
      actual_points.push({ d: lastAnchorDate, v: Number(lastAnchorVal.toFixed(4)) });
    }

    return {
      task_no: rawRow.task_no as string,
      task_name: (rawRow as any).task_name as string | null,
      plan_points,
      actual_points,
      data_date: (rawRow.data_date ?? null) as string | null,
      plan_start: (rawRow.plan_start ?? null) as string | null,
      plan_end: (rawRow.plan_end ?? null) as string | null,
      actual_progress: (rawRow.actual_progress ?? null) as number | null,
    };
  });

/** 관리자 수동 재계산. */
export const recalcTaskProgressChartsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({ discipline: z.string().optional() }).parse(v ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: n, error } = await (context.supabase as any).rpc(
      "recalc_task_progress_charts",
      { _discipline: data.discipline ?? null },
    );
    if (error) throw new Error(error.message);
    return { processed: Number(n ?? 0) };
  });