// ABD OCS 정규 증분 Import — 서버 wrapper.
// 판정식은 DB 함수(abd_ocs_inc_scope / _dryrun / _import) 하나에만 존재한다. 여기서 재구현하지 않는다.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeBaselineIdCandidates } from "@/lib/abd/ocs-baseline-shared";
import { assertBaselineGate } from "@/lib/abd/ocs-increment-gate";
import { recheckCollisionsServerSide, verifiedKey } from "@/lib/abd/ocs-increment-collision";
import { assertAbdOcsAccess } from "@/lib/abd/ocs-access";
import {
  assetList,
  imageMetaList,
  receiptList,
  sourceFileList,
  sourceMetaList,
} from "@/lib/abd/ocs-increment-normalize";
import type { SourceFileRef } from "@/lib/abd/ocs-increment-types";

export type { AssetRef, SourceFileMeta, SourceFileRef } from "@/lib/abd/ocs-increment-types";

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

    // 동일 패키지가 이미 반영된 경우, 그 run 을 대상으로 한 복구 run 이 있는지도 함께 조회한다.
    let recoveryLog: { id: string; started_at: string; status: string } | null = null;
    const dupId = (dup ?? [])[0]?.id ?? null;
    if (dupId) {
      const { data: rec, error: recErr } = await context.supabase
        .from("abd_ocs_import_logs")
        .select("id, started_at, status, result")
        .eq("status", "success")
        .filter("result->>recovery_of_import_log_id", "eq", dupId)
        .order("started_at", { ascending: false })
        .limit(1);
      if (recErr) throw new Error(recErr.message);
      const r = (rec ?? [])[0];
      if (r) recoveryLog = { id: r.id, started_at: r.started_at as string, status: r.status };
    }

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
    const baselineCandidates = await computeBaselineIdCandidates(
      data.base_core_hash || currentCoreHash,
      data.base_import_run_id || latestRunId,
    );
    const expectedBaselineId = baselineCandidates.v2;
    const mismatchedTables = Object.keys(currentTableHashes).filter(
      (t) =>
        data.base_core_table_hashes[t] !== undefined &&
        data.base_core_table_hashes[t] !== currentTableHashes[t],
    );

    return {
      duplicate_package: (dup ?? []).length > 0,
      duplicate_log: (dup ?? [])[0] ?? null,
      duplicate_recovered: recoveryLog !== null,
      duplicate_recovery_log: recoveryLog as unknown as Json,
      baseline,
      core_hash_current: currentCoreHash,
      core_table_hashes_current: currentTableHashes,
      base_core_hash_match: data.base_core_hash ? data.base_core_hash === currentCoreHash : null,
      baseline_id_match: data.base_baseline_id
        ? baselineCandidates.all.includes(data.base_baseline_id)
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
    const base = (await rpc(context.supabase, "abd_ocs_inc_dryrun", {
      p_run: data.run_id,
      p_source_files: data.source_files,
    })) as Record<string, Json>;
    const att = (await rpc(context.supabase, "abd_ocs_inc_attachment_stats", {
      p_run: data.run_id,
    })) as Record<string, Json>;
    return { ...base, ...att } as Json;
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
      package_id: string;
      manifest_name: string;
      manifest_hash: string;
      data_date: string;
      base_import_run_id: string;
      base_baseline_id: string;
      base_core_hash: string;
      base_core_table_hashes: Record<string, string>;
      base_generated_at: string;
      allow_retire?: boolean;
      source_files?: SourceFileRef[];
      source_meta?: unknown;
      assets?: unknown;
      image_meta?: unknown;
      upload_receipts?: unknown;
    }) => {
      const need = [
        "run_id",
        "snapshot_id",
        "package_name",
        "package_sha256",
        "package_id",
        "data_date",
        "base_import_run_id",
        "base_baseline_id",
        "base_core_hash",
        "base_generated_at",
      ] as const;
      for (const k of need) {
        if (!String(input?.[k] ?? "").trim()) throw new Error(`${k} 가 필요합니다.`);
      }
      return {
        ...input,
        package_id: String(input.package_id).trim(),
        base_core_hash: String(input.base_core_hash).toLowerCase(),
        base_core_table_hashes: input.base_core_table_hashes ?? {},
        allow_retire: input.allow_retire === true,
        source_files: sourceFileList(input.source_files),
        source_meta: sourceMetaList(input.source_meta),
        assets: assetList(input.assets),
        image_meta: imageMetaList(input.image_meta),
        upload_receipts: receiptList(input.upload_receipts),
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

    // Baseline 최종 관문 — 시간 비교가 아니라 서버 실측 core hash 일치를 정본으로 사용한다.
    const gate = await assertBaselineGate((fn, args) => rpc(context.supabase, fn, args), {
      base_baseline_id: data.base_baseline_id,
      base_core_hash: data.base_core_hash,
      base_core_table_hashes: data.base_core_table_hashes,
      base_import_run_id: data.base_import_run_id,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 업로드 영수증의 run/package 는 이번 실행과 반드시 일치해야 한다.
    const badReceipt = data.upload_receipts.find(
      (r) => r.run_id !== data.run_id || r.package_id !== data.package_id,
    );
    if (badReceipt) {
      throw new Error(
        `RECEIPT_FOREIGN_RUN: 다른 run/package 영수증 (${badReceipt.run_id}/${badReceipt.package_id})`,
      );
    }

    // 서버 실측 검증 영수증 — 신규 object 판정의 유일한 정본 (클라이언트 receipt 는 보조).
    const { data: verifyRows, error: verifyErr } = await context.supabase
      .from("abd_ocs_inc_verify_receipts")
      .select(
        "bucket, path, expected_sha256, expected_byte_size, actual_sha256, actual_byte_size, ok, package_id",
      )
      .eq("run_id", data.run_id)
      .eq("package_id", data.package_id)
      .eq("ok", true);
    if (verifyErr) throw new Error(`verify receipt 조회 실패: ${verifyErr.message}`);
    const verified = new Set(
      (verifyRows ?? []).map((r) =>
        verifiedKey(
          r.bucket,
          r.path,
          String(r.actual_sha256 ?? r.expected_sha256),
          Number(r.actual_byte_size ?? r.expected_byte_size ?? 0),
        ),
      ),
    );

    // Storage 충돌 최종 재검증 (실행 직전, 서버 기준)
    const collision = await recheckCollisionsServerSide(
      data.assets,
      data.source_meta,
      async (table, paths) => {
        const { data: rows, error } = await context.supabase
          .from(table)
          .select("storage_path, content_hash")
          .in("storage_path", paths);
        if (error) throw new Error(`${table}: ${error.message}`);
        return (rows ?? []) as { storage_path: string; content_hash: string | null }[];
      },
      async (bucket, dir) => {
        const names: string[] = [];
        let offset = 0;
        for (;;) {
          const { data: list, error } = await supabaseAdmin.storage
            .from(bucket)
            .list(dir, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
          if (error) throw new Error(`${bucket}/${dir}: ${error.message}`);
          const page = list ?? [];
          for (const it of page) {
            if ((it as { id?: string | null }).id) names.push(it.name);
          }
          if (page.length < 1000) break;
          offset += page.length;
        }
        return names;
      },
      data.image_meta,
      data.upload_receipts,
      { run_id: data.run_id, package_id: data.package_id },
      verified,
      { requireStorageExists: true },
    );
    if (collision.blockers.length > 0) throw new Error(collision.blockers.join(" / "));

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
      let result: Json;
      try {
        // 명시적 DB 오류 응답(error 객체)만 롤백 확정으로 본다.
        // 예외 throw(fetch 실패·timeout·응답 유실)는 반영 여부 미확인이다.
        const { data: rpcData, error: rpcError } = await (
          context.supabase as unknown as LooseClient
        ).rpc("abd_ocs_inc_import", {
          p_run: data.run_id,
          p_import_log_id: importLogId,
          p_allow_retire: data.allow_retire,
          p_source_files: data.source_files,
          p_source_meta: data.source_meta,
          p_image_meta: data.image_meta,
        });
        if (rpcError) {
          const code = String((rpcError as { code?: string }).code ?? "");
          // PostgREST/PostgreSQL 이 구조화된 DB 오류를 반환한 경우에만 커밋 실패가 확정된다.
          const isDbError = code.length > 0;
          const stage = isDbError ? "transactional_import" : "import_unconfirmed";
          throw new Error(`OCS_IMPORT_STAGE[${stage}]: abd_ocs_inc_import: ${rpcError.message}`);
        }
        result = (rpcData ?? {}) as Json;
      } catch (e) {
        const msg = (e as Error).message;
        if (/OCS_IMPORT_STAGE\[/.test(msg)) throw e;
        // 네트워크 단절·timeout·응답 유실 — 반영 여부를 확정할 수 없다.
        throw new Error(`OCS_IMPORT_STAGE[import_unconfirmed]: ${msg}`);
      }
      let verify: Json;
      try {
        // post-import verify 는 사용자 권한과 무관한 서버 검증 단계다.
        // service-role 로 내부 함수(abd_ocs_v3_verify_internal)를 호출한다.
        verify = await rpc(supabaseAdmin, "abd_ocs_v3_verify_internal", {});
      } catch (e) {
        // 본체 반영 이후 단계 — 부분 반영 가능성이 있으므로 재시도 금지 대상이다.
        throw new Error(`OCS_IMPORT_STAGE[post_import_verify]: ${(e as Error).message}`);
      }
      const { error: finErr } = await supabaseAdmin
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
            base_core_hash: gate.core_hash_current,
            base_generated_at: data.base_generated_at,
            storage_skipped: collision.skip_paths.length,
            storage_declared_new: collision.declared_new_paths.length,
            server_verified_objects: verified.size,
            package_id: data.package_id,
            upload_receipts: data.upload_receipts as never,
            allow_retire: data.allow_retire,
          } as never,
        })
        .eq("id", importLogId);
      if (finErr) {
        throw new Error(`OCS_IMPORT_STAGE[import_log_finalize]: ${finErr.message}`);
      }
      const { data: logRow } = await context.supabase
        .from("abd_ocs_import_logs")
        .select("status")
        .eq("id", importLogId)
        .maybeSingle();
      return {
        import_log_id: importLogId,
        import_log_status: logRow?.status ?? null,
        result,
        verify,
      } as unknown as Json;
    } catch (err) {
      // 본체 반영 이후(post_import_verify / import_log_finalize) 실패는 failed 로 마감하지 않는다.
      // failed 로 두면 동일 패키지 중복 판정에서 제외되어 재실행이 허용되기 때문이다.
      const msg = (err as Error).message;
      const postApply = /OCS_IMPORT_STAGE\[(post_import_verify|import_log_finalize)\]/.test(msg);
      const unconfirmed = /OCS_IMPORT_STAGE\[import_unconfirmed\]/.test(msg);
      // 미확인(unknown) 은 failed 로 마감하지 않는다. 단일 테이블 0건은 롤백 증거가 아니며,
      // 관리자 확인 전 자동 강등하지 않는다.
      const status = postApply ? "partial" : unconfirmed ? "unknown" : "failed";
      const finalMsg = msg;
      await supabaseAdmin
        .from("abd_ocs_import_logs")
        .update({
          status,
          finished_at: new Date().toISOString(),
          errors: [{ message: finalMsg }] as never,
          result: { upload_receipts: data.upload_receipts } as never,
        })
        .eq("id", importLogId);
      throw finalMsg === msg ? err : new Error(finalMsg);
    }
  });
