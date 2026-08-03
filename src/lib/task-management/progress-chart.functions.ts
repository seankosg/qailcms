import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ChartPoint {
  d: string; // YYYY-MM-DD
  v: number; // 0..1
}

/** tm_kpi_norm_actual 과 동일 규칙: 0..1 정규화(1 초과는 100분율로 간주). */
function normActual(v: unknown): number {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  const x = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, x));
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
 *  Actual 곡선(R2-1): 2점 직선(일할 역계산) — 이력 스냅샷 사용 금지.
 *   - 시작 앵커 = actual_start ?? plan_start, v=0
 *   - 끝 앵커  = actual_finish 있으면 그 날짜 v=1,
 *               없으면 COALESCE(progress_observed_at, data_date) 에서 v=norm(actual_progress)
 *   - 앵커가 하나라도 없거나 끝<시작 이면 빈 배열. */
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
        "task_no, task_name, plan_start, plan_end, actual_start, actual_finish, actual_progress, progress_observed_at, data_date",
      )
      .eq("discipline", data.discipline)
      .eq("task_no", data.task_no)
      .maybeSingle();
    if (rawErr) throw new Error(rawErr.message);
    if (!rawRow) throw new Error("Task not found");

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

    // R2-1: 2점 직선. 이력(status_history) 참조 없음.
    const actual_points: ChartPoint[] = [];
    const startAnchorDate: string | null =
      (rawRow.actual_start ? String(rawRow.actual_start).slice(0, 10) : null) ??
      (rawRow.plan_start ? String(rawRow.plan_start).slice(0, 10) : null);
    const finishIso = rawRow.actual_finish ? String(rawRow.actual_finish).slice(0, 10) : null;
    const lastAnchorDate: string | null =
      finishIso ??
      (rawRow.progress_observed_at
        ? String(rawRow.progress_observed_at).slice(0, 10)
        : rawRow.data_date
          ? String(rawRow.data_date).slice(0, 10)
          : null);
    const lastAnchorVal: number | null = finishIso
      ? 1
      : rawRow.actual_progress != null
        ? normActual(rawRow.actual_progress)
        : null;

    if (
      startAnchorDate &&
      lastAnchorDate &&
      lastAnchorVal != null &&
      lastAnchorDate >= startAnchorDate
    ) {
      actual_points.push({ d: startAnchorDate, v: 0 });
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
      actual_finish: (rawRow.actual_finish ?? null) as string | null,
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