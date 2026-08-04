import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function assertAdmin(supabase: unknown, userId: string) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자(admin) 권한이 필요합니다.");
}

async function callRpc(supabase: unknown, fn: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? {}) as Json;
}

function assertBatch(rows: unknown): unknown[] {
  if (!Array.isArray(rows)) throw new Error("rows 배열이 필요합니다.");
  if (rows.length > 400) throw new Error("배치가 너무 큽니다(최대 400).");
  return rows;
}

/** V2 dry-run — DB 변경 없음 */
export const ocsV2DryRunComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rows: unknown[] }) => ({ rows: assertBatch(input?.rows) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_v2_dryrun_comments", { p_rows: data.rows });
  });

export const ocsV2DryRunAttachments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) => ({ ids: assertBatch(input?.ids) as string[] }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_v2_dryrun_attachments", { p_ids: data.ids });
  });

export const ocsV2ImportGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { import_log_id: string; rows: unknown[] }) => ({
    import_log_id: input.import_log_id,
    rows: assertBatch(input?.rows),
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_v2_import_groups", {
      p_import_log_id: data.import_log_id,
      p_rows: data.rows,
    });
  });

export const ocsV2ImportComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { import_log_id: string; rows: unknown[] }) => ({
    import_log_id: input.import_log_id,
    rows: assertBatch(input?.rows),
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_v2_import_comments", {
      p_import_log_id: data.import_log_id,
      p_rows: data.rows,
    });
  });

export const ocsV2ImportLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { import_log_id: string; rows: unknown[] }) => ({
    import_log_id: input.import_log_id,
    rows: assertBatch(input?.rows),
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_v2_import_links", {
      p_import_log_id: data.import_log_id,
      p_rows: data.rows,
    });
  });

export const ocsV2FinalizeParents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { import_log_id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_v2_finalize_parents", {
      p_import_log_id: data.import_log_id,
    });
  });

export const ocsV2Verify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_v2_verify", {});
  });

export const ocsRecountAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_recount_all", {});
  });
