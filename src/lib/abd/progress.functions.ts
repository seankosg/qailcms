import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  plots: z.array(z.string()).default([]),
  teams: z.array(z.string()).default([]),
  groupBy: z.array(z.string()).min(1),
  asOfDate: z.string(),
  planMode: z.enum(["baseline", "remaining"]).default("baseline"),
  round: z.enum(["R1", "R2", "R3", "all"]).default("all"),
});

const CellsInputSchema = InputSchema.extend({
  bucket: z.enum(["day", "week"]).default("day"),
  rangeStart: z.string(),
  rangeEnd: z.string(),
});

export const getAbdProgressCells = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => CellsInputSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc("abd_progress_cells", {
      _plots: data.plots.length ? data.plots : null,
      _teams: data.teams.length ? data.teams : null,
      _group_by: data.groupBy,
      _bucket: data.bucket,
      _range_start: data.rangeStart,
      _range_end: data.rangeEnd,
      _as_of_date: data.asOfDate,
      _plan_mode: data.planMode,
      _round: data.round,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      group_key: (r.group_key ?? []) as string[],
      bucket_iso: r.bucket_iso ? String(r.bucket_iso).slice(0, 10) : null,
      stage: r.stage as "draft" | "submission" | "dar",
      plan_cnt: Number(r.plan_cnt) || 0,
      actual_cnt: Number(r.actual_cnt) || 0,
    }));
  });

export const getAbdProgressTotals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc("abd_progress_totals", {
      _plots: data.plots.length ? data.plots : null,
      _teams: data.teams.length ? data.teams : null,
      _group_by: data.groupBy,
      _as_of_date: data.asOfDate,
      _plan_mode: data.planMode,
      _round: data.round,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      group_key: (r.group_key ?? []) as string[],
      stage: r.stage as "draft" | "submission" | "dar",
      total: Number(r.total) || 0,
      done_upto: Number(r.done_upto) || 0,
      plan_upto: Number(r.plan_upto) || 0,
      actual_upto: Number(r.actual_upto) || 0,
    }));
  });
