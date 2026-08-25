/**
 * 안전 복원 (Holding Point 4) — 최소 서버 함수 노출.
 *
 * - HP2(사전검증·준비 영역)·HP3(지문·안전 스냅샷·원자적 반영) 엔진을 그대로 사용한다.
 * - 모든 함수는 인증 + System Administrator 단독 권한이다.
 * - 브라우저는 service-role 키를 취급하지 않는다. supabaseAdmin 은 핸들러 내부에서만 로드한다.
 * - 상태 판정은 항상 서버가 run 을 다시 조회해 수행한다.
 * - 레거시 복원 경로(restoreSnapshot / LEGACY_RESTORE_DISABLED)는 그대로 차단 상태다.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertApplyAllowed,
  assertSystemAdmin,
  buildRestoreConfirmation,
} from "./safe-restore-guards";

export { buildRestoreConfirmation };

async function loadRun(admin: any, runId: string) {
  const { data, error } = await admin
    .from("restore_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("RESTORE_RUN_NOT_FOUND");
  return data as any;
}


/** 3.1 준비 영역 지문 고정 — 운영 표 미변경. */
export const pinRestoreStagingDigest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string }) => {
    if (!input?.run_id) throw new Error("복원 준비 작업을 지정하십시오.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const run = await loadRun(supabaseAdmin, data.run_id);
    if (run.status !== "staging_verified") {
      throw new Error(`RESTORE_STAGING_NOT_VERIFIED: status=${run.status}`);
    }
    const apply = await import("./restore-apply.server");
    const digest = await apply.pinStagingDigest(supabaseAdmin as any, data.run_id);
    return {
      run_id: data.run_id,
      overall_digest: digest.overall,
      tables: digest.tables.map((t) => ({ table: t.table, rows: t.rows })),
    };
  });

/** 3.2 안전 스냅샷 생성 및 결속. 실패 시 반영 단계로 넘어가지 않는다. */
export const createRestoreSafetySnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string; expected_overall_digest: string }) => {
    if (!input?.run_id) throw new Error("복원 준비 작업을 지정하십시오.");
    if (!input?.expected_overall_digest) throw new Error("고정된 준비 영역 지문이 필요합니다.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const run = await loadRun(supabaseAdmin, data.run_id);
    if (run.status !== "staging_verified") {
      throw new Error(`RESTORE_STAGING_NOT_VERIFIED: status=${run.status}`);
    }
    if (run.staging_verify?.ok !== true) throw new Error("RESTORE_STAGING_VERIFY_NOT_CLEAN");
    if (!run.staging_overall_digest) throw new Error("RESTORE_STAGING_DIGEST_MISSING");
    if (run.staging_overall_digest !== data.expected_overall_digest) {
      throw new Error("RESTORE_STAGING_DIGEST_MISMATCH");
    }
    if (run.safety_snapshot_id) {
      throw new Error("RESTORE_SAFETY_SNAPSHOT_ALREADY_BOUND");
    }

    const apply = await import("./restore-apply.server");
    const bound = await apply.createAndBindSafetySnapshot(supabaseAdmin as any, {
      runId: data.run_id,
      userId: context.userId,
    });

    const { data: snap, error } = await supabaseAdmin
      .from("database_snapshots")
      .select("id, created_at, is_locked")
      .eq("id", bound.snapshot_id)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return {
      run_id: data.run_id,
      safety_snapshot_id: bound.snapshot_id,
      created_at: (snap as any)?.created_at ?? null,
      is_locked: (snap as any)?.is_locked ?? null,
      bound: true,
    };
  });

/** 3.3 원자적 반영. applyRestoreAtomic 외 다른 반영 경로는 없다. */
export const applySafeRestore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string; expected_overall_digest: string; confirmation: string }) => {
    if (!input?.run_id) throw new Error("복원 준비 작업을 지정하십시오.");
    if (!input?.expected_overall_digest) throw new Error("고정된 준비 영역 지문이 필요합니다.");
    if (typeof input?.confirmation !== "string") throw new Error("RESTORE_CONFIRMATION_MISMATCH");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 서버가 run 을 다시 조회해 상태·확인문자열·지문을 판정한다(브라우저 값 불신).
    const run = await loadRun(supabaseAdmin, data.run_id);
    assertApplyAllowed(run, {
      confirmation: data.confirmation,
      expected_overall_digest: data.expected_overall_digest,
    });

    // 반영 시도 사실을 DB 에 먼저 영구 기록한다(원자적 claim, 1회만 성공).
    const { data: claimed, error: claimError } = await (supabaseAdmin as any).rpc("restore_claim_apply", {
      _run_id: data.run_id,
      _actor: context.userId,
    });
    if (claimError) throw new Error(claimError.message);
    if (claimed !== true) throw new Error("RESTORE_APPLY_ALREADY_REQUESTED");

    const apply = await import("./restore-apply.server");
    return await apply.applyRestoreAtomic(supabaseAdmin as any, {
      runId: data.run_id,
      expectedOverallDigest: data.expected_overall_digest,
      actorId: context.userId,
    });
  });


/** 3.4 상태 재확인 — 읽기 전용. */
export const getRestoreRunStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string }) => {
    if (!input?.run_id) throw new Error("복원 준비 작업을 지정하십시오.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const run = await loadRun(supabaseAdmin, data.run_id);
    const status = String(run.status ?? "");
    const unresolved = status === "applying";
    /** 반영을 한 번이라도 시도했는지 — 서버 기록만 근거로 판정한다. */
    const applyAttempted =
      ["applying", "success", "apply_failed"].includes(status) ||
      !!run.applied_at ||
      !!run.apply_result;
    return {
      apply_attempted: applyAttempted,
      run_id: run.id as string,

      status,
      requested_scope: run.requested_scope as string,
      confirmation_phrase: buildRestoreConfirmation(String(run.requested_scope ?? ""), String(run.id)),
      snapshot_id: run.snapshot_id as string | null,
      safety_snapshot_id: (run.safety_snapshot_id ?? null) as string | null,
      final_restore_tables: (run.final_restore_tables ?? []) as string[],
      expected_rows: (run.expected_rows ?? {}) as Record<string, number>,
      staged_rows: (run.staged_rows ?? {}) as Record<string, number>,
      preflight_summary: {
        blockers: (run.preflight_result?.blockers ?? []) as any[],
        warnings: (run.preflight_result?.warnings ?? []) as any[],
        manifest_sha256: (run.manifest_sha256 ?? null) as string | null,
      },
      staging_verify: (run.staging_verify ?? null) as any,
      staging_overall_digest: (run.staging_overall_digest ?? null) as string | null,
      apply_result: (run.apply_result ?? null) as any,
      error_code: (run.error_code ?? null) as string | null,
      error_message: (run.error_message ?? null) as string | null,
      started_at: (run.started_at ?? null) as string | null,
      applied_at: (run.applied_at ?? null) as string | null,
      finished_at: (run.finished_at ?? null) as string | null,
      /** applying 상태는 결과 미확정이므로 새 복원 실행을 금지한다. */
      rerun_blocked: unresolved,
    };
  });
