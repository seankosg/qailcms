import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AUDIT_STATUSES, MF_TYPES } from "@/lib/abd/mf-ds-guard";

export interface AbdMfSnapshot {
  mf_check?: boolean | null;
  mf_types?: string[] | null;
  mf_reference?: string | null;
  mf_revision?: string | null;
}

export interface AbdMfChangeRow {
  id: string;
  before_value: AbdMfSnapshot | null;
  after_value: AbdMfSnapshot | null;
  reason: string | null;
  after_ds: boolean;
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export interface AbdAuditLogRow {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  reason: string | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}

async function assertCanEditRow(ctx: any, rowId: string) {
  const { data: ok, error } = await ctx.supabase.rpc("can_edit_row", {
    _user_id: ctx.userId,
    _table_name: "abd_items_raw",
    _row_id: rowId,
  });
  if (error) throw new Error(error.message);
  if (!ok) throw new Error("권한 없음: 이 행을 편집할 수 없습니다");
}

async function nameMap(ctx: any, ids: (string | null)[]): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (uniq.length === 0) return {};
  const { data } = await (ctx.supabase as any).from("profiles").select("id, name").in("id", uniq);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { id: string; name: string | null }[]) out[r.id] = r.name ?? "";
  return out;
}

// ---------------- Gate 1: MF 확인 저장 ----------------
const SetMfSchema = z.object({
  id: z.string().uuid(),
  mf_check: z.boolean(),
  mf_types: z.array(z.enum(MF_TYPES)).default([]),
  mf_reference: z.string().nullable().default(null),
  mf_revision: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
});

export const setAbdMf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => SetMfSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertCanEditRow(context, data.id);
    const ref = (data.mf_reference ?? "").trim();
    if (data.mf_check && (data.mf_types.length === 0 || ref === "")) {
      throw new Error("MF Check = Yes 로 저장하려면 MF 종류와 Reference 를 모두 입력해야 합니다.");
    }
    const patch = {
      mf_check: data.mf_check,
      mf_types: data.mf_types,
      mf_reference: ref === "" ? null : ref,
      mf_revision: (data.mf_revision ?? "").trim() || null,
      mf_checked_by: data.mf_check ? context.userId : null,
      mf_checked_at: data.mf_check ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    };
    const { error } = await (context.supabase as any).from("abd_items_raw").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    if (data.reason && data.reason.trim()) {
      // 트리거가 남긴 최신 변경 이력에 사유를 부착
      const { data: last } = await (context.supabase as any)
        .from("abd_mf_change_log")
        .select("id")
        .eq("item_id", data.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.id) {
        await (context.supabase as any)
          .from("abd_mf_change_log")
          .update({ reason: data.reason.trim() })
          .eq("id", last.id);
      }
    }
    return { ok: true };
  });

export const getAbdMfHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ itemId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("abd_mf_change_log")
      .select("id, before_value, after_value, reason, after_ds, changed_by, created_at")
      .eq("item_id", data.itemId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const names = await nameMap(context, (rows ?? []).map((r: any) => r.changed_by));
    return ((rows ?? []) as any[]).map((r) => ({
      ...r,
      changed_by_name: r.changed_by ? (names[r.changed_by] ?? null) : null,
    })) as AbdMfChangeRow[];
  });

// ---------------- §6 표본감사 ----------------
const SetAuditSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(AUDIT_STATUSES),
  note: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
});

async function assertAuditor(ctx: any) {
  const { data: ok } = await ctx.supabase.rpc("has_any_role", {
    _user_id: ctx.userId,
    _roles: ["admin", "superuser", "d_superuser", "senior_user"],
  });
  if (!ok) throw new Error("권한 없음: 표본감사 권한이 없습니다");
}

export const setAbdAuditStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => SetAuditSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertAuditor(context);
    if ((data.status === "audit_failed" || data.status === "correction_required") && !(data.note ?? "").trim()) {
      throw new Error("감사 실패 / 수정요청은 사유(감사 메모) 입력이 필수입니다.");
    }
    const { data: cur, error: e0 } = await (context.supabase as any)
      .from("abd_items_raw")
      .select("audit_status")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw new Error(e0.message);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      audit_status: data.status,
      audit_note: (data.note ?? "").trim() || null,
      audit_reason: (data.reason ?? "").trim() || null,
      updated_at: now,
      updated_by: context.userId,
    };
    if (data.status === "audit_selected") {
      patch.audit_selected_at = now;
    } else if (data.status !== "not_audited") {
      patch.audit_by = context.userId;
      patch.audit_at = now;
    }
    // 실패 → 수정요청 흐름은 도면을 Reopened 로 표시한다(실적일은 보존).
    if (data.status === "audit_failed" || data.status === "correction_required") patch.is_reopened = true;
    if (data.status === "audit_passed") patch.is_reopened = false;

    const { error } = await (context.supabase as any).from("abd_items_raw").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    await (context.supabase as any).from("abd_audit_log").insert({
      item_id: data.id,
      from_status: cur?.audit_status ?? null,
      to_status: data.status,
      note: (data.note ?? "").trim() || null,
      reason: (data.reason ?? "").trim() || null,
      actor_id: context.userId,
    });
    return { ok: true };
  });

export const getAbdAuditHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ itemId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("abd_audit_log")
      .select("id, from_status, to_status, note, reason, actor_id, created_at")
      .eq("item_id", data.itemId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const names = await nameMap(context, (rows ?? []).map((r: any) => r.actor_id));
    return ((rows ?? []) as any[]).map((r) => ({
      ...r,
      actor_name: r.actor_id ? (names[r.actor_id] ?? null) : null,
    })) as AbdAuditLogRow[];
  });

/**
 * 무작위 + 위험기반 표본선정 (문서 §6.3).
 * 위험조건 해당 도면을 우선 선정하고, 남은 수량을 일반 도면에서 무작위로 채운다.
 */
const PickSchema = z.object({
  team: z.string().optional(),
  ratio: z.number().min(0).max(100),
  saveRatio: z.boolean().default(true),
});

export const pickAbdAuditSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => PickSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertAuditor(context);

    let q = (context.supabase as any)
      .from("abd_items_raw")
      .select(
        "id, ocs_total, mf_changed_after_ds, mf_types, is_reopened, r1_response_result, r2_response_result, r3_response_result",
      )
      .eq("is_active", true)
      .eq("audit_status", "not_audited")
      .eq("mf_check", true);
    if (data.team) q = q.eq("team", data.team);
    const { data: rows, error } = await q.limit(5000);
    if (error) throw new Error(error.message);

    const pool = (rows ?? []) as any[];
    const riskOf = (r: any): string[] => {
      const out: string[] = [];
      if (Number(r.ocs_total ?? 0) >= 10) out.push("OCS 코멘트 다수");
      if ([1, 2, 3].some((n) => String(r[`r${n}_response_result`] ?? "").toUpperCase() === "C"))
        out.push("Code C 이력");
      if (r.mf_changed_after_ds) out.push("DS 이후 MF 변경");
      if (Array.isArray(r.mf_types) && r.mf_types.includes("Site Verification")) out.push("Site Verification 기준");
      if (r.is_reopened) out.push("재오픈 이력");
      return out;
    };

    const target = Math.max(0, Math.round((pool.length * data.ratio) / 100));
    const risky = pool.map((r) => ({ r, risk: riskOf(r) })).filter((x) => x.risk.length > 0);
    const normal = pool.filter((r) => riskOf(r).length === 0);
    for (let i = normal.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [normal[i], normal[j]] = [normal[j], normal[i]];
    }
    const picked = [
      ...risky.slice(0, target).map((x) => ({ id: x.r.id as string, reason: x.risk.join(", ") })),
      ...normal.slice(0, Math.max(0, target - risky.length)).map((r) => ({ id: r.id as string, reason: "무작위 표본" })),
    ];

    const now = new Date().toISOString();
    for (const p of picked) {
      await (context.supabase as any)
        .from("abd_items_raw")
        .update({ audit_status: "audit_selected", audit_selected_at: now, audit_reason: p.reason })
        .eq("id", p.id);
      await (context.supabase as any).from("abd_audit_log").insert({
        item_id: p.id,
        from_status: "not_audited",
        to_status: "audit_selected",
        reason: p.reason,
        actor_id: context.userId,
      });
    }

    if (data.saveRatio) {
      await (context.supabase as any)
        .from("abd_settings")
        .update({ audit_sample_ratio: data.ratio, updated_by: context.userId, updated_at: now })
        .eq("id", "default");
    }

    return {
      pool: pool.length,
      target,
      selected: picked.length,
      risk_selected: Math.min(risky.length, target),
    };
  });