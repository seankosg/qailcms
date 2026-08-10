import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAbdOcsAccess } from "@/lib/abd/ocs-access";

/** OCS 원본 JSON 보관함(비공개) */
export const OCS_IMPORT_BUCKET = "abd-ocs-imports";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    insert: (v: Record<string, unknown>) => {
      select: (c: string) => {
        single: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v2: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

async function assertAdmin(supabase: unknown, userId: string) {
  await assertAbdOcsAccess(supabase, userId);
}

async function callRpc(supabase: unknown, fn: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? {}) as Json;
}

/** dry-run — DB 변경 없음 */
export const ocsDryRunBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rows: unknown[] }) => {
    if (!Array.isArray(input?.rows)) throw new Error("rows 배열이 필요합니다.");
    if (input.rows.length > 400) throw new Error("배치가 너무 큽니다(최대 400).");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_dryrun_batch", { p_rows: data.rows });
  });

/** import run 정본 로그 생성 */
export const createOcsImportLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      data_file_name: string;
      data_file_hash: string;
      manifest_name: string;
      manifest_hash: string;
      total_count: number;
      attachment_total: number;
      snapshot_id: string | null;
      dryrun: Record<string, unknown>;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await (context.supabase as unknown as LooseClient)
      .from("abd_ocs_import_logs")
      .insert({
        status: "validating",
        data_file_name: data.data_file_name,
        data_file_hash: data.data_file_hash,
        source_file_name: data.data_file_name,
        source_file_hash: data.data_file_hash,
        manifest_name: data.manifest_name,
        manifest_hash: data.manifest_hash,
        total_count: data.total_count,
        attachment_total: data.attachment_total,
        snapshot_id: data.snapshot_id,
        dryrun: data.dryrun,
        imported_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as { id: string }).id };
  });

export const updateOcsImportLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: Record<string, unknown> }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await (context.supabase as unknown as LooseClient)
      .from("abd_ocs_import_logs")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const ocsImportCommentBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { import_log_id: string; rows: unknown[] }) => {
    if (!Array.isArray(input?.rows)) throw new Error("rows 배열이 필요합니다.");
    if (input.rows.length > 400) throw new Error("배치가 너무 큽니다(최대 400).");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_import_comments", {
      p_import_log_id: data.import_log_id,
      p_rows: data.rows,
    });
  });

export const ocsImportAttachmentBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rows: unknown[] }) => {
    if (!Array.isArray(input?.rows)) throw new Error("rows 배열이 필요합니다.");
    if (input.rows.length > 400) throw new Error("배치가 너무 큽니다(최대 400).");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_import_attachments", { p_rows: data.rows });
  });

export const ocsFinalizeComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { source_ids: string[] }) => {
    if (!Array.isArray(input?.source_ids) || input.source_ids.length === 0)
      throw new Error("source_ids 가 비어 있습니다.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_finalize_comments", {
      p_source_ids: data.source_ids,
    });
  });

export const ocsVerify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await callRpc(context.supabase, "abd_ocs_verify", {});
  });
