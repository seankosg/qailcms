/**
 * Holding Point 2 — 복원 사전검증(Preflight) · Staging 정본.
 *
 * 이 모듈은 **운영 테이블을 절대 변경하지 않는다.**
 * - 읽기: 스냅샷 매니페스트, Storage 파트 파일, 스키마 계약/의존관계(읽기 전용 RPC)
 * - 쓰기: restore_runs / restore_staging_rows (준비 영역) 뿐
 *
 * TRUNCATE / INSERT INTO 운영테이블 / 트리거 비활성화는 이 파일에 존재하지 않으며,
 * 다음 단계(Holding Point 3)에서 별도 승인 후 추가한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  BUCKET,
  resolveTablePartPaths,
  sha256Hex,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotManifest,
} from "./backup-core.server";
import { resolveRestoreScope, type BackupTableName, type RestoreScope } from "./backup-shared";

const STAGING_INSERT_CHUNK = 500;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type PreflightIssue = {
  code: string;
  message: string;
  table?: string;
  detail?: { [key: string]: JsonValue };
};

export type RestoreDependency = {
  requested_tables: string[];
  dependent_tables: string[];
  required_parent_tables: string[];
  auto_included_tables: string[];
  keep_current_parent_tables: string[];
  final_restore_tables: string[];
  insert_order: string[];
  remove_order: string[];
  missing_in_snapshot: string[];
  self_reference_tables: string[];
  cycle_groups: { tables: string[] }[];
  blockers: PreflightIssue[];
};

export type PreflightResult = {
  snapshot: {
    id: string;
    name: string | null;
    created_at: string | null;
    schema_version: string | null;
    is_legacy: boolean;
    tables_in_snapshot: string[];
  };
  scope: string;
  dependency: RestoreDependency;
  expected_rows: Record<string, number>;
  parts: { table: string; path: string; rows: number; manifest_sha256: string; actual_sha256: string }[];
  schema: {
    snapshot_fingerprint: string | null;
    current_fingerprint: string | null;
    matches: boolean | null;
    changed_tables: string[];
  };
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
  ok: boolean;
};

async function loadSnapshot(admin: SupabaseClient<Database>, snapshotId: string) {
  const { data, error } = await admin
    .from("database_snapshots")
    .select("id, name, created_at, storage_path, sha256_hash, tables_included, metadata")
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("백업을 찾을 수 없습니다.");
  return data;
}

/**
 * 복원 사전검증 정본. 읽기만 수행하고 결과를 그대로 돌려준다.
 * blockers 가 하나라도 있으면 어떤 다음 단계도 진행할 수 없다.
 */
export async function runRestorePreflight(
  admin: SupabaseClient<Database>,
  opts: { snapshotId: string; scope: RestoreScope | string },
): Promise<PreflightResult> {
  const requested = resolveRestoreScope(String(opts.scope));
  const snapshot = await loadSnapshot(admin, opts.snapshotId);
  const manifest = (snapshot.metadata ?? null) as SnapshotManifest | null;

  const blockers: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  const tablesInSnapshot: string[] = Array.isArray(manifest?.tables)
    ? manifest!.tables.map((t) => String(t.name))
    : Array.isArray(snapshot.tables_included)
      ? (snapshot.tables_included as unknown[]).map((t) => String(t))
      : [];

  if (!manifest || !Array.isArray(manifest.tables) || manifest.tables.length === 0) {
    blockers.push({
      code: "MANIFEST_MISSING",
      message: "이 백업에는 검증 가능한 목록(매니페스트)이 없어 안전하게 복원할 수 없습니다.",
    });
  }

  const schemaVersion = manifest?.schema_version ?? null;
  const isLegacy = schemaVersion !== SNAPSHOT_SCHEMA_VERSION;
  if (isLegacy) {
    blockers.push({
      code: "SNAPSHOT_SCHEMA_VERSION_UNSUPPORTED",
      message:
        "이 백업은 새 안전 복원 규격 이전에 생성되어 스키마 검증 정보가 없습니다. 새 규격으로 백업을 한 번 생성한 뒤 복원하십시오.",
      detail: { schema_version: schemaVersion, required: SNAPSHOT_SCHEMA_VERSION },
    });
  }

  // 1) FK 의존관계 + 화이트리스트 + 스냅샷 포함 여부
  const { data: depRaw, error: depError } = await (admin as any).rpc("backup_dependency_closure", {
    _requested: requested,
    _snapshot_tables: tablesInSnapshot,
  });
  if (depError) throw new Error(`의존관계 계산 실패: ${depError.message}`);
  const dependency = depRaw as RestoreDependency;
  for (const b of dependency.blockers ?? []) blockers.push(b);

  const finalTables = (dependency.final_restore_tables ?? []) as string[];

  // 2) 스키마 지문 대조 (스냅샷 시점 vs 현재)
  const { data: currentFp, error: fpError } = await (admin as any).rpc("backup_schema_fingerprint", {
    _tables: finalTables,
  });
  if (fpError) throw new Error(`스키마 지문 산출 실패: ${fpError.message}`);

  const snapshotContract = Array.isArray(manifest?.schema_contract)
    ? (manifest!.schema_contract as { name: string; schema_digest: string | null }[])
    : [];
  const { data: currentContract, error: ccError } = await (admin as any).rpc(
    "backup_table_schema_contract",
    { _tables: finalTables },
  );
  if (ccError) throw new Error(`스키마 계약 산출 실패: ${ccError.message}`);
  const currentByName = new Map<string, string | null>(
    ((currentContract ?? []) as { name: string; schema_digest: string | null }[]).map((c) => [
      c.name,
      c.schema_digest,
    ]),
  );
  const changedTables: string[] = [];
  for (const t of finalTables) {
    const before = snapshotContract.find((c) => c.name === t)?.schema_digest ?? null;
    const after = currentByName.get(t) ?? null;
    if (before !== null && after !== null && before !== after) changedTables.push(t);
  }
  if (changedTables.length > 0) {
    blockers.push({
      code: "SCHEMA_CHANGED_SINCE_SNAPSHOT",
      message: "백업 이후 표 구조가 바뀐 항목이 있어 그대로 복원할 수 없습니다.",
      detail: { tables: changedTables },
    });
  }

  // 스냅샷 전체 지문은 백업 대상 전체 기준이라 부분 범위와 직접 비교할 수 없다.
  // 따라서 테이블 단위 digest 대조(위)를 정본으로 쓰고, 전체 지문은 참고값으로만 남긴다.
  const snapshotFingerprint = manifest?.schema_fingerprint ?? null;

  // 3) 파트 파일 존재 + 해시 검증 + 행수 집계
  const folder = snapshot.storage_path ?? `snapshots/${snapshot.id}/`;
  const expectedRows: Record<string, number> = {};
  const parts: PreflightResult["parts"] = [];

  for (const table of finalTables) {
    const entry = manifest?.tables?.find((t) => String(t.name) === table) ?? null;
    if (!entry) {
      blockers.push({
        code: "TABLE_MISSING_IN_MANIFEST",
        message: "복원 대상 표가 백업 목록에 없습니다.",
        table,
      });
      continue;
    }
    if (!Array.isArray(entry.parts) || entry.parts.length === 0) {
      blockers.push({
        code: "PART_HASH_UNAVAILABLE",
        message: "이 표의 백업 파일에는 검증용 해시가 없어 복원할 수 없습니다.",
        table,
      });
      continue;
    }

    let rowsFromParts = 0;
    for (const part of entry.parts) {
      const path = `${folder}${part.path}`;
      const { data: blob, error: dlError } = await admin.storage.from(BUCKET).download(path);
      if (dlError || !blob) {
        blockers.push({
          code: "PART_FILE_MISSING",
          message: "백업 파일 일부를 읽을 수 없습니다.",
          table,
          detail: { path: part.path, error: dlError?.message ?? null },
        });
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const actual = await sha256Hex(bytes);
      if (actual !== part.sha256) {
        blockers.push({
          code: "PART_HASH_MISMATCH",
          message: "백업 파일이 손상되었거나 변경되었습니다(무결성 검증 실패).",
          table,
          detail: { path: part.path, expected: part.sha256, actual },
        });
      }
      let rowCount = part.rows;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (!Array.isArray(parsed)) throw new Error("배열이 아님");
        rowCount = parsed.length;
        if (rowCount !== part.rows) {
          blockers.push({
            code: "PART_ROW_COUNT_MISMATCH",
            message: "백업 파일의 실제 행 수가 기록된 행 수와 다릅니다.",
            table,
            detail: { path: part.path, manifest_rows: part.rows, actual_rows: rowCount },
          });
        }
      } catch (err) {
        blockers.push({
          code: "PART_PARSE_FAILED",
          message: "백업 파일을 해석할 수 없습니다.",
          table,
          detail: { path: part.path, error: (err as Error).message },
        });
      }
      rowsFromParts += rowCount;
      parts.push({
        table,
        path: part.path,
        rows: rowCount,
        manifest_sha256: part.sha256,
        actual_sha256: actual,
      });
    }

    if (rowsFromParts !== entry.rows) {
      blockers.push({
        code: "TABLE_ROW_COUNT_MISMATCH",
        message: "표 단위 행 수 합계가 백업 기록과 다릅니다.",
        table,
        detail: { manifest_rows: entry.rows, parts_rows: rowsFromParts },
      });
    }
    expectedRows[table] = rowsFromParts;
  }

  if ((dependency.auto_included_tables ?? []).length > 0) {
    warnings.push({
      code: "AUTO_INCLUDED_DEPENDENTS",
      message: "요청 범위와 연결된 표가 자동으로 복원 대상에 포함됩니다.",
      detail: { tables: dependency.auto_included_tables },
    });
  }
  if ((dependency.keep_current_parent_tables ?? []).length > 0) {
    warnings.push({
      code: "PARENT_TABLES_KEPT_AS_IS",
      message: "다음 표는 복원하지 않고 현재 값을 그대로 유지합니다.",
      detail: { tables: dependency.keep_current_parent_tables },
    });
  }
  if ((dependency.self_reference_tables ?? []).length > 0) {
    warnings.push({
      code: "SELF_REFERENCE_TABLES",
      message: "표 자체를 참조하는 항목이 있어 같은 표 안에서 순서가 필요합니다.",
      detail: { tables: dependency.self_reference_tables },
    });
  }

  return {
    snapshot: {
      id: snapshot.id,
      name: snapshot.name ?? null,
      created_at: snapshot.created_at ?? null,
      schema_version: schemaVersion,
      is_legacy: isLegacy,
      tables_in_snapshot: tablesInSnapshot,
    },
    scope: String(opts.scope),
    dependency,
    expected_rows: expectedRows,
    parts,
    schema: {
      snapshot_fingerprint: snapshotFingerprint,
      current_fingerprint: (currentFp as string | null) ?? null,
      matches: changedTables.length === 0 ? true : false,
      changed_tables: changedTables,
    },
    blockers,
    warnings,
    ok: blockers.length === 0,
  };
}

/** Preflight 결과를 restore_runs 에 기록한다(운영 테이블 변경 없음). */
export async function createRestoreRun(
  admin: SupabaseClient<Database>,
  opts: { snapshotId: string; scope: string; userId: string | null; preflight: PreflightResult },
): Promise<{ run_id: string; status: string }> {
  const runId = crypto.randomUUID();
  const pf = opts.preflight;
  const { error } = await admin.from("restore_runs").insert({
    id: runId,
    snapshot_id: opts.snapshotId,
    requested_scope: opts.scope,
    requested_tables: resolveRestoreScope(opts.scope) as unknown as string[],
    final_restore_tables: (pf.dependency.final_restore_tables ?? []) as string[],
    dependency_result: pf.dependency as any,
    preflight_result: {
      blockers: pf.blockers,
      warnings: pf.warnings,
      schema: pf.schema,
      parts: pf.parts.map((p) => ({ table: p.table, path: p.path, rows: p.rows })),
    } as any,
    expected_rows: pf.expected_rows as any,
    schema_fingerprint: pf.schema.current_fingerprint,
    status: pf.ok ? "preflight_clean" : "preflight_blocked",
    initiated_by: opts.userId,
    finished_at: pf.ok ? null : new Date().toISOString(),
    error_code: pf.ok ? null : (pf.blockers[0]?.code ?? "PREFLIGHT_BLOCKED"),
    error_message: pf.ok ? null : (pf.blockers[0]?.message ?? null),
  } as any);
  if (error) throw new Error(error.message);
  return { run_id: runId, status: pf.ok ? "preflight_clean" : "preflight_blocked" };
}

/**
 * 백업 파일의 행을 준비 영역(restore_staging_rows)에만 적재한다.
 * 운영 테이블은 읽지도, 쓰지도 않는다.
 */
export async function stageRestoreRun(
  admin: SupabaseClient<Database>,
  runId: string,
): Promise<{ run_id: string; staged_rows: Record<string, number>; status: string }> {
  const { data: run, error: runError } = await admin
    .from("restore_runs")
    .select("id, snapshot_id, final_restore_tables, expected_rows, status")
    .eq("id", runId)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) throw new Error("복원 준비 작업을 찾을 수 없습니다.");
  if (run.status !== "preflight_clean") {
    throw new Error(
      `사전검증을 통과한 작업만 준비 영역에 적재할 수 있습니다. 현재 상태: ${run.status}`,
    );
  }

  await admin.from("restore_runs").update({ status: "staging" }).eq("id", runId);
  // 재시도 안전성: 같은 작업의 기존 준비 데이터를 먼저 비운다(준비 영역 한정).
  await admin.from("restore_staging_rows").delete().eq("restore_run_id", runId);

  const snapshot = await loadSnapshot(admin, run.snapshot_id);
  const folder = snapshot.storage_path ?? `snapshots/${run.snapshot_id}/`;
  const staged: Record<string, number> = {};

  try {
    for (const table of (run.final_restore_tables ?? []) as string[]) {
      const partPaths = await resolveTablePartPaths(
        admin,
        snapshot as any,
        folder,
        table as BackupTableName,
      );
      let sequence = 0;
      let partIndex = 0;
      for (const partPath of partPaths) {
        const { data: blob, error: dlError } = await admin.storage
          .from(BUCKET)
          .download(`${folder}${partPath}`);
        if (dlError || !blob) throw new Error(`백업 파일 읽기 실패(${table} / ${partPath})`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const actual = await sha256Hex(bytes);
        const manifest = (snapshot.metadata ?? null) as SnapshotManifest | null;
        const expectedHash = manifest?.tables
          ?.find((t) => String(t.name) === table)
          ?.parts?.find((p) => p.path === partPath)?.sha256;
        if (expectedHash && expectedHash !== actual) {
          throw new Error(`무결성 검증 실패(${table} / ${partPath})`);
        }
        const rows = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>[];
        if (!Array.isArray(rows)) throw new Error(`백업 파일 형식 오류(${table} / ${partPath})`);

        for (let i = 0; i < rows.length; i += STAGING_INSERT_CHUNK) {
          const chunk = rows.slice(i, i + STAGING_INSERT_CHUNK);
          const payload = chunk.map((row) => ({
            restore_run_id: runId,
            table_name: table,
            part_index: partIndex,
            part_path: partPath,
            row_sequence: sequence++,
            row_data: row as any,
          }));
          const { error: insertError } = await admin.from("restore_staging_rows").insert(payload as any);
          if (insertError) throw new Error(`준비 영역 적재 실패(${table}): ${insertError.message}`);
        }
        partIndex++;
      }
      staged[table] = sequence;
    }

    const { data: verifyRaw, error: verifyError } = await (admin as any).rpc(
      "restore_staging_verify",
      { _run_id: runId },
    );
    if (verifyError) throw new Error(`준비 영역 검산 실패: ${verifyError.message}`);
    const verify = verifyRaw as { ok: boolean; issues: PreflightIssue[] };

    const status = verify.ok ? "staging_verified" : "failed";
    await admin
      .from("restore_runs")
      .update({
        staged_rows: staged as any,
        status,
        finished_at: new Date().toISOString(),
        preflight_result: { staging_verify: verify } as any,
        error_code: verify.ok ? null : (verify.issues?.[0]?.code ?? "STAGING_VERIFY_FAILED"),
        error_message: verify.ok ? null : "준비 영역 검산에서 불일치가 발견되었습니다.",
      } as any)
      .eq("id", runId);

    return { run_id: runId, staged_rows: staged, status };
  } catch (err) {
    await admin
      .from("restore_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_code: "STAGING_FAILED",
        error_message: (err as Error).message,
      } as any)
      .eq("id", runId);
    throw err;
  }
}

export async function verifyRestoreStaging(admin: SupabaseClient<Database>, runId: string) {
  const { data, error } = await (admin as any).rpc("restore_staging_verify", { _run_id: runId });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; run_id: string; tables: JsonValue[]; issues: PreflightIssue[] };
}
