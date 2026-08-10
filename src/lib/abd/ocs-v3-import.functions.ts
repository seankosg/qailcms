import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAbdOcsAccess } from "@/lib/abd/ocs-access";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function assertAdmin(supabase: unknown, userId: string) {
  await assertAbdOcsAccess(supabase, userId);
}

async function rpc(supabase: unknown, fn: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? {}) as Json;
}

/** V3 dry-run — 읽기 전용. 부모 단위 배치로 호출한다. */
export const ocsV3DryRunParents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rows: unknown[] }) => {
    if (!Array.isArray(input?.rows)) throw new Error("rows 배열이 필요합니다.");
    if (input.rows.length > 200) throw new Error("배치가 너무 큽니다(최대 200).");
    return { rows: input.rows };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return rpc(context.supabase, "abd_ocs_v3_dryrun_parents", { p_rows: data.rows });
  });

/** 스테이징 초기화 — 새 run 시작 */
export const ocsV3StageReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string }) => {
    if (!input?.run_id) throw new Error("run_id 가 필요합니다.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return rpc(context.supabase, "abd_ocs_v3_stage_reset", { p_run: data.run_id });
  });

const LOADERS = {
  groups: "abd_ocs_v3_stage_load_groups",
  comments: "abd_ocs_v3_stage_load_comments",
  attachments: "abd_ocs_v3_stage_load_attachments",
  response: "abd_ocs_v3_stage_load_response",
} as const;

export type V3StageKind = keyof typeof LOADERS;

/** 스테이징 적재 — 청크 단위 (DB 변경은 스테이징 테이블에 한정) */
export const ocsV3StageLoad = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string; kind: V3StageKind; rows: unknown[] }) => {
    if (!input?.run_id) throw new Error("run_id 가 필요합니다.");
    if (!(input.kind in LOADERS)) throw new Error(`알 수 없는 kind: ${String(input.kind)}`);
    if (!Array.isArray(input.rows)) throw new Error("rows 배열이 필요합니다.");
    if (input.rows.length > 1000) throw new Error("배치가 너무 큽니다(최대 1,000).");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return rpc(context.supabase, LOADERS[data.kind], {
      p_run: data.run_id,
      p_rows: data.rows,
    });
  });

/** 최종 dry-run — 스테이징 × 운영 DB 대조, 읽기 전용 */
export const ocsV3DryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string }) => {
    if (!input?.run_id) throw new Error("run_id 가 필요합니다.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return rpc(context.supabase, "abd_ocs_v3_dryrun", { p_run: data.run_id });
  });

/** V3 본체 Import — 사전 스냅샷 성공 검증 후에만 실행. 멱등. */
export const ocsV3Import = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string; snapshot_id: string }) => {
    if (!input?.run_id) throw new Error("run_id 가 필요합니다.");
    if (!input?.snapshot_id) throw new Error("사전 백업 스냅샷 ID 가 필요합니다.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: run, error: runErr } = await context.supabase
      .from("backup_run_log")
      .select("id, status, snapshot_id")
      .eq("snapshot_id", data.snapshot_id)
      .eq("status", "success")
      .maybeSingle();
    if (runErr) throw new Error(runErr.message);
    if (!run) throw new Error("사전 백업 스냅샷이 success 상태로 확인되지 않았습니다.");

    const { data: snap, error: snapErr } = await context.supabase
      .from("database_snapshots")
      .select("id, name, created_at, triggered_by")
      .eq("id", data.snapshot_id)
      .maybeSingle();
    if (snapErr) throw new Error(snapErr.message);
    if (!snap) throw new Error("스냅샷 레코드를 찾을 수 없습니다.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const importLogId = crypto.randomUUID();
    const { error: logErr } = await supabaseAdmin.from("abd_ocs_import_logs").insert({
      id: importLogId,
      status: "running",
      manifest_name: "OCS_V3_Final_Import_Policy.json",
      data_file_name: "OCS_Atomic_V3_Corrected_DB.json",
      imported_by: context.userId,
      snapshot_id: data.snapshot_id,
    });
    if (logErr) throw new Error(logErr.message);

    try {
      const result = await rpc(context.supabase, "abd_ocs_v3_import", {
        p_run: data.run_id,
        p_import_log_id: importLogId,
      });
      const verify = await rpc(context.supabase, "abd_ocs_v3_verify", {});
      await supabaseAdmin
        .from("abd_ocs_import_logs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          result: { import: result, verify } as never,
        })
        .eq("id", importLogId);
      return { import_log_id: importLogId, result, verify } as unknown as Json;
    } catch (err) {
      await supabaseAdmin
        .from("abd_ocs_import_logs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          errors: [{ message: (err as Error).message }] as never,
        })
        .eq("id", importLogId);
      throw err;
    }
  });

/** Import 후 검증 — 읽기 전용 */
export const ocsV3Verify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return rpc(context.supabase, "abd_ocs_v3_verify", {});
  });
