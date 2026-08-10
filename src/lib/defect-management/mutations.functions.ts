import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFECT_AUTO_FILLED_FIELDS } from "./columns";

const UpdateFieldSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value: z.any().nullable(),
});

const ALLOWED_FIELDS = new Set<string>([
  "source_issue_no", "team",
  "status_raw", "rectified_status", "closure_status",
  "updated_status", "updated_description", "updated_by_name", "updated_date_raw",
  "priority", "hdec_verification", "hdec_reason",
  "description",
  "classification", "classification_source", "category", "defect_type", "item",
  "location_raw", "defect_location", "location_reference", "podium_area",
  "building", "room", "level_name",
  "area_type", "area_level", "area_location",
  "room_group",
  "plan_title", "plan_group",
  "main_trade", "sub_trade", "trade_detail", "work_type",
  "assigned_to", "captured_by_name",
  "subcontractor_name", "subsub_name", "hdec_pic_name", "hdec_eng_name",
  "created_by_name", "created_by_team_name", "created_date",
  "last_updated_at", "data_date",
  "due_by",
  "planned_start_date", "planned_rectified_date", "planned_closure_date",
  "actual_start_date", "actual_rectified_date", "actual_closure_date",
  "planned_progress_pct", "actual_progress_pct",
  "remarks", "hdec_comments",
  "ir", "forms", "subcontractor_issue_no", "review_flag",
  "is_critical",
  "priority_locked", "hdec_verification_locked",
]);

/**
 * SM 모듈 쓰기 권한(격자 정본) — 역할 × 범위 격자에서 SM/write 가
 * 한 범위라도 열려 있어야 한다. 행 단위 판정은 `can_edit_row` 가 정본.
 */
async function assertSmWrite(ctx: any) {
  const { data, error } = await ctx.supabase.rpc("rcl_grants", { _module: "SM", _action: "write" });
  if (error) throw new Error(`권한 조회 실패: ${error.message}`);
  const g = data as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
  if (!g?.role || !(g.own || g.own_team || g.other_team)) {
    throw new Error("권한 없음: SM 편집 권한이 없습니다");
  }
}

/**
 * 행 단위 편집 권한 — 판정 정본은 DB `rcl_can`(can_edit_row 가 위임).
 * 정본 = public.can_edit_row(user, table, row): admin/superuser 전체,
 * QAQC HDEC PIC/ENG 읽기전용, senior_user 전체, d_superuser 팀 일치, user 본인 PIC 행.
 */
async function assertCanEditRow(ctx: any, rowId: string) {
  const { data, error } = await ctx.supabase.rpc("can_edit_row", {
    _user_id: ctx.userId,
    _table_name: "defect_items_raw",
    _row_id: rowId,
  });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error("권한 없음: 이 행을 편집할 수 없습니다");
}

async function assertCanEditRows(ctx: any, ids: string[]) {
  const results = await Promise.all(
    ids.map((id) =>
      ctx.supabase.rpc("can_edit_row", {
        _user_id: ctx.userId,
        _table_name: "defect_items_raw",
        _row_id: id,
      }),
    ),
  );
  const denied = results.filter((r: any) => r.data !== true).length;
  if (denied > 0) {
    throw new Error(`권한 없음: 선택 항목 중 ${denied}건은 편집할 수 없습니다`);
  }
}

/** 자동채움 필드를 수동 수정하면 잠금 목록에 등록해 이후 임포트에서 보존한다. */
function withManualLock(
  patch: Record<string, any>,
  existingLocks: string[] | null | undefined,
  fields: string[],
) {
  const locks = new Set<string>(existingLocks ?? []);
  for (const f of fields) if (DEFECT_AUTO_FILLED_FIELDS.has(f)) locks.add(f);
  patch.manual_locked_fields = Array.from(locks);
  // 트리거(a_defect_manual_lock_guard)는 이 값 변화를 "수동 편집"으로 인식한다.
  patch.manual_locked_at = new Date().toISOString();
  return patch;
}

export const updateDefectField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpdateFieldSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanEditRow(context, data.id);
    if (!ALLOWED_FIELDS.has(data.field)) {
      throw new Error(`Field '${data.field}' 은 인라인 편집 대상이 아닙니다.`);
    }
    // Fetch existing row to check locks + old value
    const { data: existing, error: fetchErr } = await context.supabase
      .from("defect_items_raw")
      .select("id, priority_locked, hdec_verification_locked, manual_locked_fields")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing) throw new Error("Snag not found");
    const row = existing as any;
    if (data.field === "priority" && row.priority_locked) throw new Error("Priority is locked");
    if (data.field === "hdec_verification" && row.hdec_verification_locked) throw new Error("HDEC Verification is locked");
    const patch: Record<string, any> = withManualLock(
      { [data.field]: data.value, updated_at: new Date().toISOString() },
      row.manual_locked_fields,
      [data.field],
    );
    const { error } = await (context.supabase as any).from("defect_items_raw").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ClearLockSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
});

/** 수동 잠금 해제 — 이후 임포트/자동 분류가 다시 이 필드를 갱신할 수 있게 한다. */
export const clearDefectFieldLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ClearLockSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanEditRow(context, data.id);
    const { data: existing, error: fetchErr } = await context.supabase
      .from("defect_items_raw")
      .select("id, manual_locked_fields")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!existing) throw new Error("Snag not found");
    const locks = (((existing as any).manual_locked_fields ?? []) as string[]).filter(
      (f) => f !== data.field,
    );
    const { error } = await (context.supabase as any)
      .from("defect_items_raw")
      .update({
        manual_locked_fields: locks,
        manual_locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, manual_locked_fields: locks };
  });

const ToggleCriticalSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  value: z.boolean(),
});

export const bulkToggleCritical = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ToggleCriticalSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertSmWrite(context);
    // RLS 로 막힌 행은 에러가 아니라 0행으로 돌아온다 → 실제 바뀐 id 만 돌려준다.
    const { data: updatedRows, error } = await (context.supabase as any)
      .from("defect_items_raw")
      .update({ is_critical: data.value, updated_at: new Date().toISOString() })
      .in("id", data.ids)
      .select("id");
    if (error) throw new Error(error.message);
    const updatedIds = ((updatedRows ?? []) as Array<{ id: string }>).map((r) => r.id);
    return {
      ok: true,
      requested: data.ids.length,
      count: updatedIds.length,
      ids: updatedIds,
      blocked: Math.max(0, data.ids.length - updatedIds.length),
    };
  });

const BulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  patch: z.record(z.string(), z.any()),
});

export const bulkUpdateDefects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => BulkUpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanEditRows(context, data.ids);
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (ALLOWED_FIELDS.has(k)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) throw new Error("허용된 편집 필드가 없습니다.");
    patch.updated_at = new Date().toISOString();
    const editedFields = Object.keys(patch).filter((k) => DEFECT_AUTO_FILLED_FIELDS.has(k));
    if (editedFields.length === 0) {
      const { error } = await (context.supabase as any)
        .from("defect_items_raw")
        .update(patch)
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      return { ok: true, count: data.ids.length, fields: Object.keys(patch) };
    }
    // 자동채움 필드를 포함한 일괄 수정 → 행별 기존 잠금 목록에 병합해야 하므로
    // 동일한 잠금 조합끼리 묶어 최소 횟수로 업데이트한다.
    const { data: rows, error: fetchErr } = await context.supabase
      .from("defect_items_raw")
      .select("id, manual_locked_fields")
      .in("id", data.ids);
    if (fetchErr) throw new Error(fetchErr.message);
    const groups = new Map<string, { ids: string[]; locks: string[] }>();
    for (const r of (rows ?? []) as any[]) {
      const locks = Array.from(
        new Set<string>([...(((r.manual_locked_fields ?? []) as string[])), ...editedFields]),
      ).sort();
      const key = locks.join("|");
      const g = groups.get(key) ?? { ids: [], locks };
      g.ids.push(r.id as string);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const { error } = await (context.supabase as any)
        .from("defect_items_raw")
        .update({
          ...patch,
          manual_locked_fields: g.locks,
          manual_locked_at: new Date().toISOString(),
        })
        .in("id", g.ids);
      if (error) throw new Error(error.message);
    }
    return { ok: true, count: data.ids.length, fields: Object.keys(patch) };
  });

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
});

export const bulkDeleteDefects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => BulkDeleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    // 순서 고정: 허용 id 선판정 → 이력(defect_status_history) → 부모(defect_items_raw).
    // 부모를 먼저 지우면 이력 정책(dsh_delete)이 이미 사라진 부모를 조회하지 못해
    // 이력이 고아로 남는다. 그래서 rcl_can_rows 로 허용 id 를 먼저 받는다.
    const allowedIds: string[] = [];
    for (let i = 0; i < data.ids.length; i += 2000) {
      const chunk = data.ids.slice(i, i + 2000);
      const { data: canRes, error: canErr } = await (context.supabase as any).rpc("rcl_can_rows", {
        _module: "SM",
        _row_ids: chunk,
        _action: "delete",
      });
      if (canErr) throw new Error(`권한 일괄 판정 실패(SM): ${canErr.message}`);
      for (const id of ((canRes as any)?.allowed ?? []) as string[]) allowedIds.push(id);
    }
    if (allowedIds.length === 0) {
      return { ok: true, requested: data.ids.length, count: 0, blocked: data.ids.length };
    }
    // 1) 허용 id 의 이력 먼저 삭제 (부모가 아직 살아 있어야 정책이 판정할 수 있다)
    const { error: histErr } = await (context.supabase as any)
      .from("defect_status_history")
      .delete()
      .in("defect_raw_id", allowedIds);
    if (histErr) throw new Error(histErr.message);
    // 2) 그 id 로 부모 삭제
    const { data: deletedRows, error } = await (context.supabase as any)
      .from("defect_items_raw")
      .delete()
      .in("id", allowedIds)
      .select("id");
    if (error) throw new Error(error.message);
    const deletedIds = ((deletedRows ?? []) as Array<{ id: string }>).map((r) => r.id);
    return {
      ok: true,
      requested: data.ids.length,
      count: deletedIds.length,
      blocked: Math.max(0, data.ids.length - deletedIds.length),
    };
  });