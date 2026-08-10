import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  planGroups: z.array(z.string()).default([]),
  teams: z.array(z.string()).default([]),
  roomGroups: z.array(z.string()).default([]),
  buildings: z.array(z.string()).default([]),
  groupBy: z.array(z.string()).min(1),
  asOfDate: z.string(),
  planMode: z.enum(["baseline", "remaining"]).default("baseline"),
});

const CellsInputSchema = InputSchema.extend({
  bucket: z.enum(["day", "week", "month"]).default("day"),
  rangeStart: z.string(),
  rangeEnd: z.string(),
});

export const getSnagProgressCells = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => CellsInputSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: payload, error } = await (context.supabase as any).rpc("defect_snag_progress_cells_json", {
      _plan_groups: data.planGroups.length ? data.planGroups : null,
      _teams: data.teams.length ? data.teams : null,
      _room_groups: data.roomGroups.length ? data.roomGroups : null,
      _buildings: data.buildings.length ? data.buildings : null,
      _group_by: data.groupBy,
      _bucket: data.bucket,
      _range_start: data.rangeStart,
      _range_end: data.rangeEnd,
      _as_of_date: data.asOfDate,
      _plan_mode: data.planMode,
      // 문서 단위 집계행(`all|...`)은 신버전 매트릭스에서만 사용한다(구 배포본 하위호환).
      _include_agg: true,
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(payload)) throw new Error("defect_snag_progress_cells_json RPC contract mismatch");
    const rows = payload;
    return (rows ?? []).map((r: any) => ({
      group_key: (r.group_key ?? []) as string[],
      bucket_iso: r.bucket_iso ? String(r.bucket_iso).slice(0, 10) : null,
      stage: r.stage as import("./progress-utils").Stage,
      plan_cnt: Number(r.plan_cnt) || 0,
      actual_cnt: Number(r.actual_cnt) || 0,
    }));
  });

export const getSnagProgressTotals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: payload, error } = await (context.supabase as any).rpc("defect_snag_progress_totals_json", {
      _plan_groups: data.planGroups.length ? data.planGroups : null,
      _teams: data.teams.length ? data.teams : null,
      _room_groups: data.roomGroups.length ? data.roomGroups : null,
      _buildings: data.buildings.length ? data.buildings : null,
      _group_by: data.groupBy,
      _as_of_date: data.asOfDate,
      _plan_mode: data.planMode,
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(payload)) throw new Error("defect_snag_progress_totals_json RPC contract mismatch");
    const rows = payload;
    return (rows ?? []).map((r: any) => ({
      group_key: (r.group_key ?? []) as string[],
      stage: r.stage as "start" | "rectified" | "closure",
      total: Number(r.total) || 0,
      done_upto: Number(r.done_upto) || 0,
      plan_upto: Number(r.plan_upto) || 0,
      actual_upto: Number(r.actual_upto) || 0,
      no_plan: Number(r.no_plan) || 0,
      np_mask: (r.np_mask ?? null) as Record<string, number> | null,
    }));
  });