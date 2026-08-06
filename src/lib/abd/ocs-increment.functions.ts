// ABD OCS 정규 증분 Import — 서버 wrapper.
// 판정식은 DB 함수(abd_ocs_inc_scope / _dryrun / _import) 하나에만 존재한다. 여기서 재구현하지 않는다.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BASELINE_CORE_TABLES,
  BASELINE_SCHEMA_VERSION,
  computeBaselineId,
} from "@/lib/abd/ocs-baseline-shared";
import { assertBaselineGate } from "@/lib/abd/ocs-increment-gate";
import { recheckCollisionsServerSide } from "@/lib/abd/ocs-increment-collision";
import {
  assetList,
  sourceFileList,
  sourceMetaList,
} from "@/lib/abd/ocs-increment-normalize";
import type { SourceFileRef } from "@/lib/abd/ocs-increment-types";

export type {
  AssetRef,
  SourceFileMeta,
  SourceFileRef,
} from "@/lib/abd/ocs-increment-types";

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

async function rpc(supabase: unknown, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? {}) as Json;
}

/** 패키지 사전 관문 — 중복 패키지 해시 · Baseline 최신성 (읽기 전용) */
export const ocsIncPrecheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      package_sha256: string;
      base_import_run_id: string;
      base_baseline_id?: string;
      base_core_hash?: string;
      base_core_table_hashes?: Record<string, string>;
    }) => {
    if (!input?.package_sha256) throw new Error("package_sha256 이 필요합니다.");
    return {
      package_sha256: input.package_sha256,
      base_import_run_id: input.base_import_run_id ?? "",
      base_baseline_id: input.base_baseline_id ?? "",
      base_core_hash: (input.base_core_hash ?? "").toLowerCase(),
      base_core_table_hashes: input.base_core_table_hashes ?? {},
    };
  },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: dup, error: dupErr } = await context.supabase
      .from("abd_ocs_import_logs")
      .select("id, data_file_name, status, started_at")
      .eq("data_file_hash", data.package_sha256)
      .neq("status", "failed")
      .limit(1);
    if (dupErr) throw new Error(dupErr.message);

    const baseline = await rpc(context.supabase, "abd_ocs_inc_baseline", {
      p_base_import_run_id: data.base_import_run_id || null,
    });

    // Baseline manifest 대조 — core hash 재계산 + baseline_id 동일 산식 재계산
    const core = (await rpc(context.supabase, "abd_ocs_baseline_core_hash")) as Record<
      string,
      unknown
    >;
    const currentCoreHash = String(core["core_hash"] ?? "");
    const currentTableHashes = (core["core_table_hashes"] ?? {}) as Record<string, string>;
    const latestRunId = String(
      (baseline as Record<string, unknown>)["latest_success_import_run_id"] ?? "",
    );
    const expectedBaselineId = await computeBaselineId(
      BASELINE_SCHEMA_VERSION,
      data.base_core_hash || currentCoreHash,
      data.base_import_run_id || latestRunId,
    );
    const mismatchedTables = Object.keys(currentTableHashes).filter(
      (t) =>
        data.base_core_table_hashes[t] !== undefined &&
        data.base_core_table_hashes[t] !== currentTableHashes[t],
    );

    return {
      duplicate_package: (dup ?? []).length > 0,
      duplicate_log: (dup ?? [])[0] ?? null,
      baseline,
      core_hash_current: currentCoreHash,
      core_table_hashes_current: currentTableHashes,
      base_core_hash_match: data.base_core_hash ? data.base_core_hash === currentCoreHash : null,
      baseline_id_match: data.base_baseline_id
        ? data.base_baseline_id === expectedBaselineId
        : null,
      baseline_id_expected: expectedBaselineId,
      mismatched_core_tables: mismatchedTables,
    } as unknown as Json;
  });

/** 증분 Dry-run — 읽기 전용. staging 적재는 기존 ocsV3StageLoad 를 그대로 사용한다. */
export const ocsIncDryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string; source_files?: SourceFileRef[] }) => {
    if (!input?.run_id) throw new Error("run_id 가 필요합니다.");
    return { run_id: input.run_id, source_files: sourceFileList(input.source_files) };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return rpc(context.supabase, "abd_ocs_inc_dryrun", {
      p_run: data.run_id,
      p_source_files: data.source_files,
    });
  });

/** 증분 Import 본체 — 사전 스냅샷 성공 + 패키지 관문 통과 후에만 실행. */
export const ocsIncImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      run_id: string;
      snapshot_id: string;
      package_name: string;
      package_sha256: string;
      manifest_name: string;
      manifest_hash: string;
      data_date: string;
      base_import_run_id: string;
      base_baseline_id: string;
      allow_retire?: boolean;
      source_files?: SourceFileRef[];
    }) => {
      const need = [
        "run_id",
        "snapshot_id",
        "package_name",
        "package_sha256",
        "data_date",
        "base_import_run_id",
        "base_baseline_id",
      ] as const;
      for (const k of need) {
        if (!input?.[k]) throw new Error(`${k} 가 필요합니다.`);
      }
      return {
        ...input,
        allow_retire: input.allow_retire === true,
        source_files: sourceFileList(input.source_files),
      };
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    // 사전 백업 검증
    const { data: run, error: runErr } = await context.supabase
      .from("backup_run_log")
      .select("id, status, snapshot_id")
      .eq("snapshot_id", data.snapshot_id)
      .eq("status", "success")
      .maybeSingle();
    if (runErr) throw new Error(runErr.message);
    if (!run) throw new Error("사전 백업 스냅샷이 success 상태로 확인되지 않았습니다.");

    // 동일 패키지 재실행 차단 (DB partial unique index 와 이중 관문)
    const { data: dup, error: dupErr } = await context.supabase
      .from("abd_ocs_import_logs")
      .select("id")
      .eq("data_file_hash", data.package_sha256)
      .neq("status", "failed")
      .limit(1);
    if (dupErr) throw new Error(dupErr.message);
    if ((dup ?? []).length > 0) throw new Error("동일 패키지 해시가 이미 반영되었습니다.");

    // Baseline 최신성 관문
    const baseline = (await rpc(context.supabase, "abd_ocs_inc_baseline", {
      p_base_import_run_id: data.base_import_run_id,
    })) as Record<string, unknown>;
    if (baseline["base_import_run_found"] !== true) {
      throw new Error("패키지의 base_import_run_id 를 운영 정본에서 찾을 수 없습니다.");
    }
    if (baseline["is_latest"] !== true) {
      throw new Error("패키지 Baseline 이 최신 정본 Import 가 아닙니다.");
    }
    if (baseline["core_changed_since_base"] === true) {
      throw new Error("Baseline 이후 OCS 정본이 변경되었습니다. 최신 Baseline 으로 다시 생성하십시오.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const importLogId = crypto.randomUUID();
    const { error: logErr } = await supabaseAdmin.from("abd_ocs_import_logs").insert({
      id: importLogId,
      status: "running",
      manifest_name: data.manifest_name || "manifest.json",
      manifest_hash: data.manifest_hash || null,
      data_file_name: data.package_name,
      data_file_hash: data.package_sha256,
      imported_by: context.userId,
      snapshot_id: data.snapshot_id,
    });
    if (logErr) throw new Error(logErr.message);

    try {
      const result = await rpc(context.supabase, "abd_ocs_inc_import", {
        p_run: data.run_id,
        p_import_log_id: importLogId,
        p_allow_retire: data.allow_retire,
        p_source_files: data.source_files,
      });
      const verify = await rpc(context.supabase, "abd_ocs_v3_verify", {});
      await supabaseAdmin
        .from("abd_ocs_import_logs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          result: {
            increment: result,
            verify,
            data_date: data.data_date,
            base_baseline_id: data.base_baseline_id,
            base_import_run_id: data.base_import_run_id,
            allow_retire: data.allow_retire,
          } as never,
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
