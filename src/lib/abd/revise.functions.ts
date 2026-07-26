import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AbdReviseDraft {
  id: string;
  source_round: 1 | 2;
  round_target: "r2" | "r3";
  current: {
    ds: string | null;
    df: string | null;
    sb: string | null;
    rs: string | null;
  };
  suggested: {
    ds: string | null;
    df: string | null;
    sb: string | null;
    rs: string | null;
  };
  response_actual: string | null;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}
function toISO(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
function diffDays(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function computeDraftFromRow(r: any): AbdReviseDraft | null {
  const src = r.revise_source_round === 2 ? 2 : r.revise_source_round === 1 ? 1 : null;
  if (!src) return null;
  const tgt = src === 1 ? "r2" : "r3";
  const respActual = toDate(src === 1 ? r.r1_dar_actual : r.r2_dar_actual);
  const oldDs = toDate(r[`${tgt}_draft_start_plan`]);
  const oldDf = toDate(r[`${tgt}_draft_finish_plan`]);
  const oldSb = toDate(r[`${tgt}_submission_plan`]);
  const oldRs = toDate(r[`${tgt}_dar_plan`]);

  const gapDf = diffDays(oldDf, oldDs);
  const gapSb = diffDays(oldSb, oldDs);
  const gapRs = diffDays(oldRs, oldDs);

  const newDs = respActual ? addDays(respActual, 1) : null;
  const newDf = newDs && gapDf != null ? addDays(newDs, gapDf) : null;
  const newSb = newDs && gapSb != null ? addDays(newDs, gapSb) : null;
  const newRs = newDs && gapRs != null ? addDays(newDs, gapRs) : null;

  return {
    id: r.id,
    source_round: src as 1 | 2,
    round_target: tgt,
    current: {
      ds: toISO(oldDs),
      df: toISO(oldDf),
      sb: toISO(oldSb),
      rs: toISO(oldRs),
    },
    suggested: {
      ds: toISO(newDs),
      df: toISO(newDf),
      sb: toISO(newSb),
      rs: toISO(newRs),
    },
    response_actual: toISO(respActual),
  };
}

const REVISE_COLS = [
  "id",
  "revise_source_round",
  "r1_dar_actual",
  "r2_dar_actual",
  "r2_draft_start_plan",
  "r2_draft_finish_plan",
  "r2_submission_plan",
  "r2_dar_plan",
  "r3_draft_start_plan",
  "r3_draft_finish_plan",
  "r3_submission_plan",
  "r3_dar_plan",
].join(",");

export const computeReviseDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any)
      .from("abd_items_raw")
      .select(REVISE_COLS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("항목을 찾을 수 없습니다.");
    const draft = computeDraftFromRow(row);
    if (!draft) throw new Error("Revise 대상이 아닙니다.");
    return draft;
  });

const ApplySchema = z.object({
  id: z.string().uuid(),
  round_target: z.enum(["r2", "r3"]),
  ds: z.string().nullable(),
  df: z.string().nullable(),
  sb: z.string().nullable(),
  rs: z.string().nullable(),
});

export const applyReviseDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ApplySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: canEdit, error: permErr } = await (context.supabase as any).rpc("can_edit_row", {
      _user_id: context.userId,
      _table_name: "abd_items_raw",
      _row_id: data.id,
    });
    if (permErr) throw new Error(permErr.message);
    if (!canEdit) throw new Error("권한 없음: 이 행을 편집할 수 없습니다");

    await (context.supabase as any)
      .rpc("set_config", { setting_name: "app.change_source", new_value: "revise", is_local: true })
      .catch(() => {});

    const tgt = data.round_target;
    const patch: Record<string, any> = {
      [`${tgt}_draft_start_plan`]: data.ds,
      [`${tgt}_draft_finish_plan`]: data.df,
      [`${tgt}_submission_plan`]: data.sb,
      [`${tgt}_dar_plan`]: data.rs,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    };
    const { error } = await (context.supabase as any)
      .from("abd_items_raw")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const BulkSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

export const bulkApplyReviseDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => BulkSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("abd_items_raw")
      .select(REVISE_COLS)
      .in("id", data.ids);
    if (error) throw new Error(error.message);

    await (context.supabase as any)
      .rpc("set_config", { setting_name: "app.change_source", new_value: "revise-bulk", is_local: true })
      .catch(() => {});

    let applied = 0;
    let skipped = 0;
    for (const r of rows ?? []) {
      const draft = computeDraftFromRow(r);
      if (!draft || !draft.suggested.ds) { skipped++; continue; }
      const tgt = draft.round_target;
      const patch: Record<string, any> = {
        [`${tgt}_draft_start_plan`]: draft.suggested.ds,
        [`${tgt}_draft_finish_plan`]: draft.suggested.df,
        [`${tgt}_submission_plan`]: draft.suggested.sb,
        [`${tgt}_dar_plan`]: draft.suggested.rs,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      };
      const { error: upErr } = await (context.supabase as any)
        .from("abd_items_raw")
        .update(patch)
        .eq("id", r.id);
      if (upErr) { skipped++; continue; }
      applied++;
    }
    return { applied, skipped };
  });