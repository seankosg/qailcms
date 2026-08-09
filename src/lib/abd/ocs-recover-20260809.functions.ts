import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * 2026-08-09 ABD OCS 증분 Import 부분 반영(import_log b558b4bb…) 전용 일회성 복구.
 * 일반 증분 Import 경로(패키지 해시 중복 차단 · Baseline · Storage 충돌 · 승인 절차)는
 * 우회하지 않는다. 이 경로는 admin 전용이며 사전조건이 정확히 일치할 때만 동작한다.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const ORIGINAL_IMPORT_LOG_ID = "b558b4bb-69ad-46aa-990e-f55652d72888";
const STAGE_RUN_ID = "4900545d-f945-43e8-bcda-f78ba9a0f50e";

async function assertAdmin(supabase: unknown, userId: string) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자(admin) 권한이 필요합니다.");
}

async function rpc(supabase: unknown, fn: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? {}) as Json;
}

/** 복구 Dry-run — 읽기 전용. 아무것도 쓰지 않는다. */
export const ocsRecover20260809DryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return rpc(context.supabase, "abd_ocs_recover_20260809_dryrun", {});
  });

/** 복구 실행 — 단일 트랜잭션. 사전조건 불일치 시 DB 함수가 전체 롤백한다. */
export const ocsRecover20260809Run = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { snapshot_id: string }) => {
    if (!input?.snapshot_id) throw new Error("사전 백업 스냅샷 ID 가 필요합니다.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const recoveryLogId = crypto.randomUUID();

    // 감사용 별도 로그 행. data_file_hash 를 비워 일반 Import 중복 판정(unique index)에 참여시키지 않는다.
    const { error: logErr } = await supabaseAdmin.from("abd_ocs_import_logs").insert({
      id: recoveryLogId,
      status: "running",
      manifest_name: "OCS_V3_Recovery_20260809.json",
      data_file_name: `RECOVERY_of_${ORIGINAL_IMPORT_LOG_ID}`,
      imported_by: context.userId,
      snapshot_id: data.snapshot_id,
    });
    if (logErr) throw new Error(logErr.message);

    try {
      const result = await rpc(context.supabase, "abd_ocs_recover_20260809", {
        p_recovery_log_id: recoveryLogId,
        p_snapshot_id: data.snapshot_id,
      });
      await supabaseAdmin
        .from("abd_ocs_import_logs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          result: {
            recovery_of_import_log_id: ORIGINAL_IMPORT_LOG_ID,
            recovery_stage_run_id: STAGE_RUN_ID,
            ...(result as Record<string, unknown>),
          } as never,
        })
        .eq("id", recoveryLogId);
      return { recovery_log_id: recoveryLogId, result } as unknown as Json;
    } catch (err) {
      await supabaseAdmin
        .from("abd_ocs_import_logs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          errors: [
            {
              message: (err as Error).message,
              recovery_of_import_log_id: ORIGINAL_IMPORT_LOG_ID,
              recovery_stage_run_id: STAGE_RUN_ID,
            },
          ] as never,
        })
        .eq("id", recoveryLogId);
      throw err;
    }
  });
