/**
 * 안전 복원 Holding Point 3 — 내부 반영 엔진 (실행/UI 활성화 없음)
 *
 * 이 모듈은 준비 영역(restore_staging_rows)에 적재·검산된 데이터를 운영 표에
 * **단일 DB 트랜잭션**으로 반영하는 엔진 래퍼다. 실제 트랜잭션 본체는
 * `public.restore_apply_atomic` RPC 안에 있으며, 한 건이라도 실패하면 전체 롤백된다.
 *
 * 이 파일은 다음을 보장한다.
 *  - 반영 직전 안전 스냅샷(kind=pre-safe-restore)이 없으면 반영 자체를 시도하지 않는다.
 *  - 준비 영역 지문(overall digest)이 고정되고, 호출자가 같은 값을 제시할 때만 반영한다.
 *  - 실패 시 트랜잭션은 롤백되므로, 감사 기록은 **별도 문장**으로 남긴다.
 *  - 호출자는 service_role 관리 클라이언트뿐이며 브라우저에서 직접 호출할 수 없다.
 *
 * 이 파일에는 운영 복원을 자동으로 시작하는 경로가 없다. 노출 서버 함수는
 * Holding Point 4 에서 승인 후 추가한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const APPLY_STATUS = {
  READY: "staging_verified",
  APPLYING: "applying",
  SUCCESS: "success",
  FAILED: "apply_failed",
} as const;

export interface StagingDigest {
  run_id: string;
  tables: { table: string; source: string; rows: number; digest: string }[];
  overall: string;
}

export interface ApplyResult {
  ok: true;
  run_id: string;
  tables: { table: string; rows?: number; digest?: string; deleted?: number }[];
  sequences: { table: string; column: string; sequence: string }[];
  guard_tables: string[];
  overall_digest: string;
}

/**
 * 결과 미확정(unknown): 통신 오류·타임아웃·응답 유실 등으로 롤백 여부를 단정할 수 없는 경우.
 * 이 결과를 받으면 재실행하지 않고 run_id 로 실제 반영 결과를 확인해야 한다.
 */
export interface ApplyUnknownOutcome {
  ok: false;
  state: "unknown";
  run_id: string;
  code: string;
  message: string;
  recheck_required: true;
}

export type ApplyOutcome = ApplyResult | ApplyUnknownOutcome;

type Admin = SupabaseClient<Database>;

function rpcError(prefix: string, message: string): Error {
  return new Error(`${prefix}: ${message}`);
}

const TRANSPORT_PATTERNS = [
  /failed to fetch/i,
  /network/i,
  /fetch failed/i,
  /timeout/i,
  /timed out/i,
  /aborted/i,
  /abort/i,
  /connection (reset|closed|refused|terminated)/i,
  /econn/i,
  /socket hang up/i,
  /unexpected (end of json|token)/i,
  /gateway/i,
  /service unavailable/i,
];

/**
 * DB 가 명시적으로 반환한 오류(confirmed_rollback)와 통신 계열 미확정(unknown)을 구분한다.
 * SQLSTATE 또는 구조화된 오류 코드가 있으면 DB 응답으로 본다.
 */
export function classifyRpcError(error: {
  message?: string;
  code?: string;
}): "confirmed_rollback" | "unknown" {
  const message = error?.message ?? "";
  const code = error?.code ?? "";
  if (/^[0-9A-Z]{5}$/.test(code)) return "confirmed_rollback";
  if (TRANSPORT_PATTERNS.some((re) => re.test(message))) return "unknown";
  if (/^[A-Z][A-Z0-9_]{3,}/.test(message)) return "confirmed_rollback";
  return "unknown";
}

function unknownOutcome(runId: string, code: string, message: string): ApplyUnknownOutcome {
  return {
    ok: false,
    state: "unknown",
    run_id: runId,
    code,
    message: `${code}: 반영 결과를 확인할 수 없습니다(run_id=${runId}). 재실행 금지, 결과 확인 필요. 원인: ${message}`,
    recheck_required: true,
  };
}


/** 준비 영역 지문을 계산해 restore_runs 에 고정한다(운영 표 미변경). */
export async function pinStagingDigest(admin: Admin, runId: string): Promise<StagingDigest> {
  const { data, error } = await (admin as any).rpc("restore_pin_staging_digest", { _run_id: runId });
  if (error) throw rpcError("RESTORE_STAGING_DIGEST_PIN_FAILED", error.message);
  const digest = data as StagingDigest;
  if (!digest?.overall) throw new Error("RESTORE_STAGING_DIGEST_EMPTY");
  return digest;
}

/** 준비 영역 지문을 다시 계산한다(고정값과 대조용, 읽기 전용). */
export async function readStagingDigest(admin: Admin, runId: string): Promise<StagingDigest> {
  const { data, error } = await (admin as any).rpc("restore_staging_digest", { _run_id: runId });
  if (error) throw rpcError("RESTORE_STAGING_DIGEST_FAILED", error.message);
  return data as StagingDigest;
}

/**
 * 복원 직전 안전 스냅샷을 생성하고 해당 복원 작업에 결속한다.
 * 스냅샷이 성공적으로 기록되지 않으면 결속되지 않으므로 반영도 불가능하다.
 */
export async function createAndBindSafetySnapshot(
  admin: Admin,
  opts: { runId: string; userId?: string | null },
): Promise<{ snapshot_id: string; bound: true }> {
  const { data: run, error: runError } = await admin
    .from("restore_runs")
    .select("id, status, final_restore_tables, snapshot_id")
    .eq("id", opts.runId)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) throw new Error("RESTORE_RUN_NOT_FOUND");
  if ((run as any).status !== APPLY_STATUS.READY) {
    throw new Error(`RESTORE_STAGING_NOT_VERIFIED: status=${(run as any).status}`);
  }

  const core = await import("./backup-core.server");
  const logId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const startedAt = Date.now();

  const { error: logError } = await admin
    .from("backup_run_log")
    .insert({ id: logId, status: "running", snapshot_id: null } as any);
  if (logError) throw new Error(`SAFETY_SNAPSHOT_LOG_FAILED: ${logError.message}`);

  try {
    await core.createSnapshot(admin, {
      snapshotId,
      name: `pre-safe-restore-${opts.runId}`,
      triggeredBy: "manual" as any,
      triggerMetadata: {
        kind: "pre-safe-restore",
        restore_run_id: opts.runId,
        source_snapshot_id: (run as any).snapshot_id ?? null,
        requested_by: opts.userId ?? null,
      },
    });
    const { error: successLogError } = await admin
      .from("backup_run_log")
      .update({
        status: "success",
        snapshot_id: snapshotId,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      } as any)
      .eq("id", logId);
    // 성공 기록이 남지 않으면 결속 관문(성공 로그 확인)을 통과할 수 없으므로 즉시 실패시킨다.
    if (successLogError) {
      throw new Error(`SAFETY_SNAPSHOT_LOG_UPDATE_FAILED: ${successLogError.message}`);
    }

  } catch (err) {
    await admin
      .from("backup_run_log")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        error_message: (err as Error).message,
      } as any)
      .eq("id", logId);
    throw new Error(`SAFETY_SNAPSHOT_FAILED: ${(err as Error).message}`);
  }

  const { error: bindError } = await (admin as any).rpc("restore_bind_safety_snapshot", {
    _run_id: opts.runId,
    _snapshot_id: snapshotId,
  });
  if (bindError) throw rpcError("RESTORE_SAFETY_SNAPSHOT_BIND_FAILED", bindError.message);

  return { snapshot_id: snapshotId, bound: true };
}

/**
 * 준비 영역 → 운영 표 원자적 반영.
 *
 * 관문(모두 통과해야 시도):
 *  1) 상태가 staging_verified
 *  2) 준비 영역 검산 결과 ok
 *  3) 안전 스냅샷 결속됨
 *  4) 고정 지문 존재 + 호출자 제시 지문 일치
 * 실제 반영·사후 검산·순서·잠금·행수 대조는 DB 함수가 같은 트랜잭션에서 수행한다.
 */
export async function applyRestoreAtomic(
  admin: Admin,
  opts: { runId: string; expectedOverallDigest: string; actorId?: string | null },
): Promise<ApplyResult> {
  if (!opts.expectedOverallDigest) throw new Error("RESTORE_STAGING_DIGEST_REQUIRED");

  const { data: run, error: runError } = await admin
    .from("restore_runs")
    .select("id, status, safety_snapshot_id, staging_overall_digest, staging_verify")
    .eq("id", opts.runId)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) throw new Error("RESTORE_RUN_NOT_FOUND");

  const r = run as any;
  if (r.status !== APPLY_STATUS.READY) {
    throw new Error(`RESTORE_APPLY_NOT_CLAIMABLE: status=${r.status}`);
  }
  if (r.staging_verify?.ok !== true) throw new Error("RESTORE_STAGING_VERIFY_NOT_CLEAN");
  if (!r.safety_snapshot_id) throw new Error("RESTORE_SAFETY_SNAPSHOT_MISSING");
  if (!r.staging_overall_digest) throw new Error("RESTORE_STAGING_DIGEST_MISSING");
  if (r.staging_overall_digest !== opts.expectedOverallDigest) {
    throw new Error("RESTORE_STAGING_DIGEST_MISMATCH");
  }

  let data: unknown = null;
  let error: { message?: string; code?: string } | null = null;
  try {
    const res = await (admin as any).rpc("restore_apply_atomic", {
      _run_id: opts.runId,
      _expected_overall_digest: opts.expectedOverallDigest,
      _actor: opts.actorId ?? null,
    });
    data = res?.data ?? null;
    error = res?.error ?? null;
    if (!res || (res.data === undefined && res.error === undefined)) {
      // 응답 자체가 유실/파싱 불가 → 결과 미확정
      return unknownOutcome(opts.runId, "RESTORE_APPLY_RESULT_UNKNOWN_NO_RESPONSE", "응답을 확인할 수 없습니다.");
    }
  } catch (err) {
    // 던져진 예외(fetch 실패·중단 등)는 롤백을 단정할 수 없다.
    return unknownOutcome(
      opts.runId,
      "RESTORE_APPLY_RESULT_UNKNOWN_TRANSPORT",
      (err as Error)?.message ?? "통신 오류",
    );
  }

  if (error) {
    if (classifyRpcError(error) === "unknown") {
      return unknownOutcome(
        opts.runId,
        "RESTORE_APPLY_RESULT_UNKNOWN_TRANSPORT",
        error.message ?? "통신 오류",
      );
    }

    // DB 가 명시적으로 반환한 오류 → 트랜잭션은 롤백되었다(운영 표 변경 0건).
    // 감사 기록은 별도 문장으로, 그리고 아직 점유되지 않은 상태에서만 남긴다.
    const code = /^[A-Z][A-Z0-9_]*/.exec(error.message ?? "")?.[0] ?? "RESTORE_APPLY_FAILED";
    const { error: auditError } = await (admin as any)
      .from("restore_runs")
      .update({
        status: APPLY_STATUS.FAILED,
        finished_at: new Date().toISOString(),
        error_code: code,
        error_message: error.message ?? "복원 반영이 실패했습니다.",
      } as any)
      .eq("id", opts.runId)
      .eq("status", APPLY_STATUS.READY);
    if (auditError) {
      const combined = new Error(
        `RESTORE_APPLY_FAILED_AND_AUDIT_UPDATE_FAILED: 반영 실패(${error.message}) / 실패 기록 갱신도 실패(${auditError.message})`,
      );
      (combined as Error & { cause?: unknown }).cause = error;
      throw combined;
    }
    throw rpcError("RESTORE_APPLY_FAILED", error.message ?? "");
  }

  const result = data as ApplyResult;
  if (!result?.ok) throw new Error("RESTORE_APPLY_RESULT_INVALID");
  return result;

}
