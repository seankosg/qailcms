import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FilterSchema = z.object({
  plots: z.array(z.string()).default([]),
  teams: z.array(z.string()).default([]),
  batch_no: z.array(z.string()).default([]),
});

type RowOut = { bucket: string; team: string | null; cnt: number };

function toArrOrNull(a: string[]) {
  return a && a.length ? a : null;
}

export const getAbdDashboardRow1 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => FilterSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: payload, error } = await (context.supabase as any).rpc("abd_dashboard_row1_json", {
      _plots: toArrOrNull(data.plots),
      _teams: toArrOrNull(data.teams),
      _batch_no: toArrOrNull(data.batch_no),
    });
    if (error) throw new Error(error.message);
    return (Array.isArray(payload) ? payload : []) as RowOut[];
  });

export const getAbdDashboardRow2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => FilterSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: payload, error } = await (context.supabase as any).rpc("abd_dashboard_row2_json", {
      _plots: toArrOrNull(data.plots),
      _teams: toArrOrNull(data.teams),
      _batch_no: toArrOrNull(data.batch_no),
    });
    if (error) throw new Error(error.message);
    return (Array.isArray(payload) ? payload : []) as RowOut[];
  });

export const getAbdDashboardStatusDist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => FilterSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc("abd_dashboard_status_dist", {
      _plots: toArrOrNull(data.plots),
      _teams: toArrOrNull(data.teams),
      _batch_no: toArrOrNull(data.batch_no),
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ status: string; cnt: number }>;
  });

export const getAbdDashboardAttentionLists = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => FilterSchema.extend({ limit: z.number().int().default(20) }).parse(v))
  .handler(async ({ data, context }) => {
    const { data: payload, error } = await context.supabase.rpc("abd_dashboard_attention_lists", {
      _plots: toArrOrNull(data.plots) ?? undefined,
      _teams: toArrOrNull(data.teams) ?? undefined,
      _limit: data.limit,
      _batch_no: toArrOrNull(data.batch_no) ?? undefined,
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(payload)) {
      throw new Error("[abd_dashboard_attention_lists] jsonb 배열 계약 위반: 응답이 배열이 아님");
    }
    return payload as Array<{
      list_kind: "needs_planning" | "ur_aging" | "status_mismatch";
      id: string; team: string | null; plot: string | null; abd_number: string | null;
      document_title: string | null; current_stage: string | null; ur_aging_days: number | null;
      latest_status: string | null; hdec_pic_name: string | null;
    }>;
  });

export const getAbdDashboardCrosscut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => FilterSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc("abd_dashboard_crosscut", {
      _plots: toArrOrNull(data.plots),
      _teams: toArrOrNull(data.teams),
      _batch_no: toArrOrNull(data.batch_no),
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ dis: string; service: string; bucket: string; cnt: number }>;
  });

/** Row1/Row2 결과를 카드별 { total, byTeam } 형태로 재구성 */
export function pivotRows(rows: RowOut[]) {
  const totals = new Map<string, number>();
  const byTeam = new Map<string, Array<{ team: string; count: number }>>();
  for (const r of rows) {
    if (r.team == null) {
      totals.set(r.bucket, (totals.get(r.bucket) ?? 0) + r.cnt);
    } else {
      const arr = byTeam.get(r.bucket) ?? [];
      arr.push({ team: r.team, count: r.cnt });
      byTeam.set(r.bucket, arr);
    }
  }
  return { totals, byTeam };
}

export type AbdRowOut = RowOut;

export type AbdStageGroupCount = {
  stage_group: string;
  /** current_stage 코드값 (DS1/DF2/RS3/RESUBMIT1/Approved …). 라운드 소계용. */
  stage: string;
  team: string;
  total: number;
  delayed: number;
};

/** Progress KPI 스트립 정본: stage_group × team 재고/지연 카운트 (RPC 1회) */
export const getAbdStageGroupCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => FilterSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: payload, error } = await (context.supabase as any).rpc("abd_stage_group_counts", {
      _plots: toArrOrNull(data.plots),
      _teams: toArrOrNull(data.teams),
      _batch_no: toArrOrNull(data.batch_no),
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(payload)) {
      throw new Error("[abd_stage_group_counts] jsonb 배열 계약 위반: 응답이 배열이 아님");
    }
    return (payload as any[]).map((r) => ({
      stage_group: String(r.stage_group ?? ""),
      stage: String(r.stage ?? ""),
      team: String(r.team ?? ""),
      total: Number(r.total ?? 0),
      delayed: Number(r.delayed ?? 0),
    })) as AbdStageGroupCount[];
  });

export type AbdJudgmentMixRow = {
  stage: "NS" | "DS" | "UR" | "Approved";
  total: number;
  approved: number;
  normal: number;
  caution: number;
  delayed: number;
  critical: number;
};

export const getAbdDashboardJudgmentMix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({
      batch_no: z.array(z.string()).default([]),
      plots: z.array(z.string()).default([]),
    }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any).rpc(
      "abd_dashboard_judgment_mix",
      {
        _batch_no: toArrOrNull(data.batch_no),
        _plots: toArrOrNull(data.plots),
      },
    );
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[]).map((r) => ({
      stage: r.stage,
      total: Number(r.total ?? 0),
      approved: Number(r.approved ?? 0),
      normal: Number(r.normal ?? 0),
      caution: Number(r.caution ?? 0),
      delayed: Number(r.delayed ?? 0),
      critical: Number(r.critical ?? 0),
    })) as AbdJudgmentMixRow[];
  });