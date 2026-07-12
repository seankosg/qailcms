import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UpdateFieldSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value: z.any().nullable(),
});

const ALLOWED_FIELDS = new Set<string>([
  "source_issue_no", "team",
  "status_raw", "completion_status", "closure_status",
  "priority", "hdec_verification", "hdec_reason",
  "description",
  "area_type", "area_level", "area_location",
  "main_trade", "sub_trade", "work_type",
  "subcontractor_name", "subsub_name", "hdec_pic_name", "hdec_eng_name",
  "due_by",
  "planned_start_date", "planned_completion_date", "planned_closure_date",
  "actual_start_date", "actual_completion_date", "actual_closure_date",
  "planned_progress_pct", "actual_progress_pct",
  "remarks", "hdec_comments",
  "is_critical",
  "priority_locked", "hdec_verification_locked",
]);

async function assertAdmin(ctx: any) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superuser" }),
  ]);
  if (!isAdmin && !isSuper) {
    throw new Error("권한 없음: 관리자만 편집할 수 있습니다");
  }
}

export const updateDefectField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpdateFieldSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!ALLOWED_FIELDS.has(data.field)) {
      throw new Error(`Field '${data.field}' 은 인라인 편집 대상이 아닙니다.`);
    }
    // Fetch existing row to check locks + old value
    const { data: existing, error: fetchErr } = await context.supabase
      .from("defect_items_raw")
      .select("id, priority_locked, hdec_verification_locked")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing) throw new Error("Defect not found");
    const row = existing as any;
    if (data.field === "priority" && row.priority_locked) throw new Error("Priority is locked");
    if (data.field === "hdec_verification" && row.hdec_verification_locked) throw new Error("HDEC Verification is locked");
    const patch: Record<string, any> = { [data.field]: data.value, updated_at: new Date().toISOString() };
    const { error } = await (context.supabase as any).from("defect_items_raw").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ToggleCriticalSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  value: z.boolean(),
});

export const bulkToggleCritical = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ToggleCriticalSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any)
      .from("defect_items_raw")
      .update({ is_critical: data.value, updated_at: new Date().toISOString() })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true, count: data.ids.length };
  });

const BulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  patch: z.record(z.string(), z.any()),
});

export const bulkUpdateDefects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => BulkUpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (ALLOWED_FIELDS.has(k)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) throw new Error("허용된 편집 필드가 없습니다.");
    patch.updated_at = new Date().toISOString();
    const { error } = await (context.supabase as any).from("defect_items_raw").update(patch).in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true, count: data.ids.length, fields: Object.keys(patch) };
  });