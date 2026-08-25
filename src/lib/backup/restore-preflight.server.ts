/**
 * Holding Point 2 — 복원 사전검증(Preflight) · Staging 정본.
 *
 * 이 모듈은 **운영 테이블을 절대 변경하지 않는다.**
 * - 읽기: Storage manifest.json, 스냅샷 파트 파일, 스키마 계약/의존관계(읽기 전용 RPC)
 * - 쓰기: restore_runs / restore_staging_rows (준비 영역) 뿐
 *
 * TRUNCATE / INSERT INTO 운영테이블 / 트리거 비활성화는 이 파일에 존재하지 않으며,
 * 다음 단계(Holding Point 3)에서 별도 승인 후 추가한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  BUCKET,
  SNAPSHOT_SCHEMA_VERSION,
  type SnapshotManifest,
} from "./backup-core.server";
import { combineHashes, normalizePartPath, sha256Hex } from "./manifest-hash";
import { resolveRestoreScope, type RestoreScope } from "./backup-shared";

const STAGING_INSERT_CHUNK = 500;
/** Storage 파트 동시 다운로드 상한(3~5 범위). */
const DOWNLOAD_CONCURRENCY = 4;

/** 입력 순서를 보존하면서 동시 실행 수를 제한하는 map. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}



export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type PreflightIssue = {
  code: string;
  message: string;
  table?: string;
  detail?: { [key: string]: JsonValue };
};

/**
 * 사전검증이 실측으로 확정한 파트 계약.
 * staging 은 재다운로드한 manifest 가 아니라 이 계약만을 기준으로 검증·적재한다.
 */
export type PartContract = {
  table: string;
  part_index: number;
  /** manifest 원문 상대경로 */
  path: string;
  /** 검증된 정규 전체 경로(Storage 호출에 사용) */
  full_path: string;
  rows: number;
  size_bytes: number;
  sha256: string;
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
    /** Storage manifest.json 을 정본으로 사용했는지 여부 */
    manifest_source: "storage" | "none";
  };
  scope: string;
  dependency: RestoreDependency;
  expected_rows: Record<string, number>;
  /** Storage manifest.json 원본 bytes 의 SHA-256(사전검증 시점 고정값). */
  manifest_sha256: string | null;
  /** 사전검증이 실측으로 확정한 복원 대상 파트 계약. staging 은 이 계약에만 고정된다. */
  part_contract: PartContract[];
  parts: {
    table: string;
    path: string;
    rows: number;
    bytes: number;
    manifest_sha256: string;
    actual_sha256: string;
  }[];

  hashes: {
    manifest_overall: string | null;
    recomputed_overall: string | null;
    db_recorded_overall: string | null;
    overall_matches: boolean;
    table_hash_mismatches: string[];
  };
  schema: {
    snapshot_fingerprint: string | null;
    current_fingerprint: string | null;
    matches: boolean;
    changed_tables: string[];
    missing_digest_tables: string[];
    missing_current_tables: string[];
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

type ManifestTable = NonNullable<SnapshotManifest["tables"]>[number];

function tableContractKey(t: ManifestTable | undefined | null): string {
  if (!t) return "";
  const parts = (t.parts ?? [])
    .map((p) => `${p.path}:${p.rows}:${p.size_bytes}:${p.sha256}`)
    .join("|");
  return `${t.rows}:${t.size_bytes}:${t.sha256}:${parts}`;
}

/** DB metadata 와 Storage manifest 의 핵심 계약이 완전히 같은지 대조한다. */
function diffManifests(db: SnapshotManifest | null, storage: SnapshotManifest): string[] {
  const diffs: string[] = [];
  if (!db) return ["db_metadata_missing"];
  if (String(db.id) !== String(storage.id)) diffs.push("id");
  if ((db.total_rows ?? null) !== (storage.total_rows ?? null)) diffs.push("total_rows");
  if ((db.sha256 ?? null) !== (storage.sha256 ?? null)) diffs.push("sha256");
  if ((db.schema_version ?? null) !== (storage.schema_version ?? null)) diffs.push("schema_version");
  if ((db.schema_fingerprint ?? null) !== (storage.schema_fingerprint ?? null))
    diffs.push("schema_fingerprint");
  if (JSON.stringify(db.schema_contract ?? null) !== JSON.stringify(storage.schema_contract ?? null))
    diffs.push("schema_contract");

  const dbTables = new Map((db.tables ?? []).map((t) => [String(t.name), t]));
  const stTables = new Map((storage.tables ?? []).map((t) => [String(t.name), t]));
  for (const name of new Set([...dbTables.keys(), ...stTables.keys()])) {
    if (!dbTables.has(name) || !stTables.has(name)) {
      diffs.push(`tables:${name}`);
      continue;
    }
    if (tableContractKey(dbTables.get(name)) !== tableContractKey(stTables.get(name))) {
      diffs.push(`tables:${name}`);
    }
  }
  return diffs;
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
  const dbManifest = (snapshot.metadata ?? null) as SnapshotManifest | null;
  const folder = snapshot.storage_path ?? `snapshots/${snapshot.id}/`;

  const blockers: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  // ── 1) Storage manifest.json 을 사전검증 정본으로 로드 ────────────────────
  let manifest: SnapshotManifest | null = null;
  let manifestSource: "storage" | "none" = "none";
  let manifestSha256: string | null = null;
  const manifestPath = `${folder.endsWith("/") ? folder : `${folder}/`}manifest.json`;
  const { data: mBlob, error: mErr } = await admin.storage.from(BUCKET).download(manifestPath);
  if (mErr || !mBlob) {
    blockers.push({
      code: "STORAGE_MANIFEST_MISSING",
      message: "백업 폴더에 목록 파일(manifest.json)이 없어 안전하게 복원할 수 없습니다.",
      detail: { path: manifestPath, error: mErr?.message ?? null },
    });
  } else {
    const manifestBytes = new Uint8Array(await mBlob.arrayBuffer());
    manifestSha256 = await sha256Hex(manifestBytes);
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SnapshotManifest;
      manifestSource = "storage";
    } catch (err) {
      blockers.push({
        code: "STORAGE_MANIFEST_PARSE_FAILED",
        message: "백업 목록 파일을 해석할 수 없습니다.",
        detail: { path: manifestPath, error: (err as Error).message },
      });
    }
  }


  if (manifest) {
    if (String(manifest.id ?? "") !== String(snapshot.id)) {
      blockers.push({
        code: "SNAPSHOT_ID_MISMATCH",
        message: "백업 목록 파일이 선택한 백업의 것이 아닙니다.",
        detail: { manifest_id: String(manifest.id ?? ""), snapshot_id: String(snapshot.id) },
      });
    }
    const diffs = diffManifests(dbManifest, manifest);
    if (diffs.length > 0) {
      blockers.push({
        code: "DB_STORAGE_MANIFEST_MISMATCH",
        message: "저장된 백업 기록과 실제 백업 파일 목록이 서로 다릅니다.",
        detail: { fields: diffs },
      });
    }
    if ((snapshot.sha256_hash ?? null) !== (manifest.sha256 ?? null)) {
      blockers.push({
        code: "SNAPSHOT_OVERALL_HASH_MISMATCH",
        message: "백업 전체 검증값이 기록과 다릅니다.",
        detail: { db: snapshot.sha256_hash ?? null, manifest: manifest.sha256 ?? null },
      });
    }
    if (!Array.isArray(manifest.tables) || manifest.tables.length === 0) {
      blockers.push({
        code: "MANIFEST_MISSING",
        message: "이 백업에는 검증 가능한 표 목록이 없어 안전하게 복원할 수 없습니다.",
      });
    }
  }

  const tablesInSnapshot: string[] = Array.isArray(manifest?.tables)
    ? manifest!.tables.map((t) => String(t.name))
    : Array.isArray(snapshot.tables_included)
      ? (snapshot.tables_included as unknown[]).map((t) => String(t))
      : [];

  const schemaVersion = manifest?.schema_version ?? dbManifest?.schema_version ?? null;
  const isLegacy = schemaVersion !== SNAPSHOT_SCHEMA_VERSION;
  if (isLegacy) {
    blockers.push({
      code: "SNAPSHOT_SCHEMA_VERSION_UNSUPPORTED",
      message:
        "이 백업은 새 안전 복원 규격 이전에 생성되어 스키마 검증 정보가 없습니다. 새 규격으로 백업을 한 번 생성한 뒤 복원하십시오.",
      detail: { schema_version: schemaVersion, required: SNAPSHOT_SCHEMA_VERSION },
    });
  }

  // ── 2) FK 의존관계 + 화이트리스트 + 스냅샷 포함 여부 ─────────────────────
  const { data: depRaw, error: depError } = await (admin as any).rpc("backup_dependency_closure", {
    _requested: requested,
    _snapshot_tables: tablesInSnapshot,
  });
  if (depError) throw new Error(`의존관계 계산 실패: ${depError.message}`);
  const dependency = depRaw as RestoreDependency;
  for (const b of dependency.blockers ?? []) blockers.push(b);

  const finalTables = (dependency.final_restore_tables ?? []) as string[];

  // ── 3) 스키마 계약 완결성 + 변경 감지 ───────────────────────────────────
  const { data: currentFp, error: fpError } = await (admin as any).rpc("backup_schema_fingerprint", {
    _tables: finalTables,
  });
  if (fpError) throw new Error(`스키마 지문 산출 실패: ${fpError.message}`);

  const snapshotFingerprint = manifest?.schema_fingerprint ?? null;
  const snapshotContract = Array.isArray(manifest?.schema_contract)
    ? (manifest!.schema_contract as { name: string; schema_digest: string | null }[])
    : null;

  if (!isLegacy && !snapshotFingerprint) {
    blockers.push({
      code: "SCHEMA_CONTRACT_MISSING",
      message: "백업에 스키마 지문이 없어 구조 변경 여부를 확인할 수 없습니다.",
    });
  }
  if (!isLegacy && (!snapshotContract || snapshotContract.length === 0)) {
    blockers.push({
      code: "SCHEMA_CONTRACT_MISSING",
      message: "백업에 표 구조 계약 정보가 없어 안전하게 복원할 수 없습니다.",
    });
  }

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
  const missingDigestTables: string[] = [];
  const missingCurrentTables: string[] = [];
  for (const t of finalTables) {
    const before = snapshotContract?.find((c) => c.name === t)?.schema_digest ?? null;
    const after = currentByName.get(t) ?? null;
    if (!before) missingDigestTables.push(t);
    if (!after) missingCurrentTables.push(t);
    if (before && after && before !== after) changedTables.push(t);
  }
  if (!isLegacy && missingDigestTables.length > 0) {
    blockers.push({
      code: "TABLE_SCHEMA_DIGEST_MISSING",
      message: "백업에 일부 표의 구조 정보가 없어 복원할 수 없습니다.",
      detail: { tables: missingDigestTables },
    });
  }
  if (missingCurrentTables.length > 0) {
    blockers.push({
      code: "CURRENT_TABLE_SCHEMA_MISSING",
      message: "현재 데이터베이스에 없는 표가 복원 대상에 포함되어 있습니다.",
      detail: { tables: missingCurrentTables },
    });
  }
  if (changedTables.length > 0) {
    blockers.push({
      code: "SCHEMA_CHANGED_SINCE_SNAPSHOT",
      message: "백업 이후 표 구조가 바뀐 항목이 있어 그대로 복원할 수 없습니다.",
      detail: { tables: changedTables },
    });
  }

  // ── 4) 경로 검증 + 전체 파트 실측(size/hash/rows) + 계층 해시 재계산 ─────
  //
  // 복원 대상이 아닌 표도 **모두 다운로드**하여 실제 bytes 로 해시를 재계산한다.
  // 그래야 overall hash 가 "manifest 선언값 재조합"이 아닌 실제 무결성 검증이 된다.
  const expectedRows: Record<string, number> = {};
  const parts: PreflightResult["parts"] = [];
  const partContract: PartContract[] = [];
  const tableHashMismatches: string[] = [];
  const seenPaths = new Set<string>();
  const recomputedTableHashes: string[] = [];

  for (const entry of manifest?.tables ?? []) {
    const table = String(entry.name);
    const isTarget = finalTables.includes(table);
    let rowsFromParts = 0;
    let bytesFromParts = 0;
    let tableUsable = true;

    if (!Array.isArray(entry.parts) || entry.parts.length === 0) {
      if (isTarget) {
        blockers.push({
          code: "PART_HASH_UNAVAILABLE",
          message: "이 표의 백업 파일에는 검증용 해시가 없어 복원할 수 없습니다.",
          table,
        });
      }
      recomputedTableHashes.push(entry.sha256);
      continue;
    }

    // 4-1) 경로 검증(다운로드 전)
    type Planned = { index: number; part: (typeof entry.parts)[number]; fullPath: string };
    const planned: Planned[] = [];
    for (let i = 0; i < entry.parts.length; i++) {
      const part = entry.parts[i];
      const check = normalizePartPath(folder, part.path);
      if (!check.ok) {
        tableUsable = false;
        blockers.push({
          code: check.code,
          message: "백업 파일 경로가 안전하지 않습니다.",
          table,
          detail: { path: String(part.path), reason: check.reason },
        });
        continue;
      }
      if (seenPaths.has(check.fullPath)) {
        tableUsable = false;
        blockers.push({
          code: "PART_PATH_DUPLICATE",
          message: "같은 백업 파일 경로가 중복 기재되어 있습니다.",
          table,
          detail: { path: check.fullPath },
        });
        continue;
      }
      seenPaths.add(check.fullPath);
      planned.push({ index: i, part, fullPath: check.fullPath });
    }

    // 4-2) 동시성 제한 다운로드(3~5개 범위)
    const results = await mapLimit(planned, DOWNLOAD_CONCURRENCY, async (p) => {
      const { data: blob, error: dlError } = await admin.storage.from(BUCKET).download(p.fullPath);
      if (dlError || !blob) return { p, bytes: null as Uint8Array | null, error: dlError?.message ?? "다운로드 실패" };
      return { p, bytes: new Uint8Array(await blob.arrayBuffer()), error: null as string | null };
    });

    // 4-3) manifest 순서대로 실측 검증
    const partHashes: string[] = [];
    for (const r of results) {
      const { part, fullPath, index } = r.p;
      if (!r.bytes) {
        tableUsable = false;
        blockers.push({
          code: "PART_FILE_MISSING",
          message: "백업 파일 일부를 읽을 수 없습니다.",
          table,
          detail: { path: String(part.path), error: r.error },
        });
        continue;
      }
      const bytes = r.bytes;
      const actual = await sha256Hex(bytes);
      // 실제 해시를 계층 해시 재계산에 사용한다(선언값 재조합 금지).
      partHashes.push(actual);

      if (actual !== part.sha256) {
        tableUsable = false;
        blockers.push({
          code: "PART_HASH_MISMATCH",
          message: "백업 파일이 손상되었거나 변경되었습니다(무결성 검증 실패).",
          table,
          detail: { path: String(part.path), expected: part.sha256, actual },
        });
      }
      if (bytes.length !== part.size_bytes) {
        tableUsable = false;
        blockers.push({
          code: "PART_SIZE_MISMATCH",
          message: "백업 파일 크기가 기록과 다릅니다.",
          table,
          detail: { path: String(part.path), expected: part.size_bytes, actual: bytes.length },
        });
      }
      let rowCount = part.rows;
      let parsedOk = true;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (!Array.isArray(parsed)) throw new Error("배열이 아님");
        rowCount = parsed.length;
        if (rowCount !== part.rows) {
          tableUsable = false;
          blockers.push({
            code: "PART_ROW_COUNT_MISMATCH",
            message: "백업 파일의 실제 행 수가 기록된 행 수와 다릅니다.",
            table,
            detail: { path: String(part.path), manifest_rows: part.rows, actual_rows: rowCount },
          });
        }
      } catch (err) {
        parsedOk = false;
        tableUsable = false;
        blockers.push({
          code: "PART_PARSE_FAILED",
          message: "백업 파일을 해석할 수 없습니다.",
          table,
          detail: { path: String(part.path), error: (err as Error).message },
        });
      }
      rowsFromParts += rowCount;
      bytesFromParts += bytes.length;
      parts.push({
        table,
        path: String(part.path),
        rows: rowCount,
        bytes: bytes.length,
        manifest_sha256: part.sha256,
        actual_sha256: actual,
      });
      if (isTarget && parsedOk) {
        partContract.push({
          table,
          part_index: index,
          path: String(part.path),
          full_path: fullPath,
          rows: rowCount,
          size_bytes: bytes.length,
          sha256: actual,
        });
      }
    }

    // 테이블 해시 재계산은 생성 시와 동일한 산식(manifest-hash.ts)을 사용한다.
    const recomputedTableHash = await combineHashes(partHashes);
    recomputedTableHashes.push(recomputedTableHash);
    if (recomputedTableHash !== entry.sha256) {
      tableHashMismatches.push(table);
      blockers.push({
        code: "TABLE_HASH_MISMATCH",
        message: "표 단위 검증값이 백업 기록과 다릅니다.",
        table,
        detail: { expected: entry.sha256, actual: recomputedTableHash },
      });
    }

    if (!isTarget) continue;
    if (tableUsable && rowsFromParts !== entry.rows) {
      blockers.push({
        code: "TABLE_ROW_COUNT_MISMATCH",
        message: "표 단위 행 수 합계가 백업 기록과 다릅니다.",
        table,
        detail: { manifest_rows: entry.rows, parts_rows: rowsFromParts },
      });
    }
    if (tableUsable && bytesFromParts !== entry.size_bytes) {
      blockers.push({
        code: "TABLE_SIZE_MISMATCH",
        message: "표 단위 파일 크기 합계가 백업 기록과 다릅니다.",
        table,
        detail: { manifest_size: entry.size_bytes, parts_size: bytesFromParts },
      });
    }
    expectedRows[table] = rowsFromParts;
  }


  const recomputedOverall = manifest ? await combineHashes(recomputedTableHashes) : null;
  const overallMatches =
    !!manifest && recomputedOverall === (manifest.sha256 ?? null) && recomputedOverall === (snapshot.sha256_hash ?? null);
  if (manifest && !overallMatches) {
    blockers.push({
      code: "SNAPSHOT_OVERALL_HASH_MISMATCH",
      message: "백업 전체 검증값 재계산 결과가 기록과 다릅니다.",
      detail: {
        manifest: manifest.sha256 ?? null,
        db: snapshot.sha256_hash ?? null,
        recomputed: recomputedOverall,
      },
    });
  }

  for (const t of finalTables) {
    if (!(t in expectedRows) && !(manifest?.tables ?? []).some((e) => String(e.name) === t)) {
      blockers.push({
        code: "TABLE_MISSING_IN_MANIFEST",
        message: "복원 대상 표가 백업 목록에 없습니다.",
        table: t,
      });
    }
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

  const schemaComplete =
    !isLegacy &&
    !!snapshotFingerprint &&
    !!snapshotContract &&
    missingDigestTables.length === 0 &&
    missingCurrentTables.length === 0;

  return {
    snapshot: {
      id: snapshot.id,
      name: snapshot.name ?? null,
      created_at: snapshot.created_at ?? null,
      schema_version: schemaVersion,
      is_legacy: isLegacy,
      tables_in_snapshot: tablesInSnapshot,
      manifest_source: manifestSource,
    },
    scope: String(opts.scope),
    dependency,
    expected_rows: expectedRows,
    manifest_sha256: manifestSha256,
    part_contract: partContract,
    parts,

    hashes: {
      manifest_overall: manifest?.sha256 ?? null,
      recomputed_overall: recomputedOverall,
      db_recorded_overall: snapshot.sha256_hash ?? null,
      overall_matches: overallMatches,
      table_hash_mismatches: tableHashMismatches,
    },
    schema: {
      snapshot_fingerprint: snapshotFingerprint,
      current_fingerprint: (currentFp as string | null) ?? null,
      matches: schemaComplete && changedTables.length === 0,
      changed_tables: changedTables,
      missing_digest_tables: missingDigestTables,
      missing_current_tables: missingCurrentTables,
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
      hashes: pf.hashes,
      manifest_source: pf.snapshot.manifest_source,
      manifest_sha256: pf.manifest_sha256,
      // staging 이 고정될 계약(경로·순서·행수·크기·해시). 이후 단계는 이 값만 신뢰한다.
      part_contract: pf.part_contract,
      parts: pf.parts.map((p) => ({ table: p.table, path: p.path, rows: p.rows, bytes: p.bytes })),
    } as any,
    expected_rows: pf.expected_rows as any,
    manifest_sha256: pf.manifest_sha256,
    schema_fingerprint: pf.schema.current_fingerprint,

    status: pf.ok ? "preflight_clean" : "preflight_blocked",
    initiated_by: opts.userId,
    // preflight_blocked 는 최종 종료 상태이므로 종료 시각을 남긴다.
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
    .select(
      "id, snapshot_id, final_restore_tables, expected_rows, status, manifest_sha256, preflight_result",
    )
    .eq("id", runId)
    .maybeSingle();

  if (runError) throw new Error(runError.message);
  if (!run) throw new Error("복원 준비 작업을 찾을 수 없습니다.");
  if (run.status !== "preflight_clean") {
    throw new Error(
      `사전검증을 통과한 작업만 준비 영역에 적재할 수 있습니다. 현재 상태: ${run.status}`,
    );
  }

  const { error: statusError } = await admin
    .from("restore_runs")
    .update({ status: "staging" })
    .eq("id", runId);
  if (statusError) throw new Error(`상태 갱신 실패: ${statusError.message}`);

  // 재시도 안전성: 같은 작업의 기존 준비 데이터를 먼저 비운다(준비 영역 한정).
  const { error: clearError } = await admin
    .from("restore_staging_rows")
    .delete()
    .eq("restore_run_id", runId);
  if (clearError) throw new Error(`준비 영역 초기화 실패: ${clearError.message}`);

  const snapshot = await loadSnapshot(admin, run.snapshot_id);
  const folder = snapshot.storage_path ?? `snapshots/${run.snapshot_id}/`;
  const staged: Record<string, number> = {};

  try {
    // ── (1) manifest bytes 고정 대조 ────────────────────────────────────────
    // 사전검증 시점에 계산한 manifest.json 원본 bytes 의 SHA-256 과 지금 값이
    // 다르면, 승인받은 payload 가 아니므로 즉시 중단한다.
    const pinnedManifestSha = (run as any).manifest_sha256 as string | null;
    if (!pinnedManifestSha) {
      throw new Error(
        "RESTORE_MANIFEST_PIN_MISSING: 사전검증이 고정한 목록 파일 검증값이 없습니다. 사전검증을 다시 실행하십시오.",
      );
    }
    const manifestPath = `${folder.endsWith("/") ? folder : `${folder}/`}manifest.json`;
    const { data: mBlob, error: mErr } = await admin.storage.from(BUCKET).download(manifestPath);
    if (mErr || !mBlob) throw new Error("백업 목록 파일(manifest.json)을 읽을 수 없습니다.");
    const currentManifestSha = await sha256Hex(new Uint8Array(await mBlob.arrayBuffer()));
    if (currentManifestSha !== pinnedManifestSha) {
      throw new Error(
        `RESTORE_MANIFEST_CHANGED_AFTER_PREFLIGHT: 사전검증 이후 백업 목록 파일이 바뀌었습니다(expected=${pinnedManifestSha}, actual=${currentManifestSha}).`,
      );
    }

    // ── (2) 적재는 사전검증이 고정한 계약에만 근거한다 ───────────────────────
    const contract = ((run as any).preflight_result?.part_contract ?? []) as PartContract[];
    if (!Array.isArray(contract) || contract.length === 0) {
      throw new Error(
        "RESTORE_PART_CONTRACT_MISSING: 사전검증이 고정한 파트 계약이 없습니다. 사전검증을 다시 실행하십시오.",
      );
    }

    for (const table of (run.final_restore_tables ?? []) as string[]) {
      const tableParts = contract
        .filter((c) => c.table === table)
        .sort((a, b) => a.part_index - b.part_index);
      if (tableParts.length === 0) {
        throw new Error(`RESTORE_PART_CONTRACT_MISSING: 사전검증 계약에 표 정보가 없습니다: ${table}`);
      }
      let sequence = 0;
      for (const part of tableParts) {
        // 계약에 기록된 정규 경로를 다시 검증한 뒤 그대로 사용한다.
        const check = normalizePartPath(folder, part.path);
        if (!check.ok || check.fullPath !== part.full_path) {
          throw new Error(
            `RESTORE_PART_CHANGED_AFTER_PREFLIGHT: 파일 경로가 사전검증 계약과 다릅니다(${table} / ${part.path}).`,
          );
        }
        const { data: blob, error: dlError } = await admin.storage.from(BUCKET).download(part.full_path);
        if (dlError || !blob) {
          throw new Error(
            `RESTORE_PART_CHANGED_AFTER_PREFLIGHT: 백업 파일을 읽을 수 없습니다(${table} / ${part.path}).`,
          );
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes.length !== part.size_bytes) {
          throw new Error(
            `RESTORE_PART_CHANGED_AFTER_PREFLIGHT: 파일 크기가 사전검증 값과 다릅니다(${table} / ${part.path}).`,
          );
        }
        const actual = await sha256Hex(bytes);
        if (actual !== part.sha256) {
          throw new Error(
            `RESTORE_PART_CHANGED_AFTER_PREFLIGHT: 파일 내용이 사전검증 이후 변경되었습니다(${table} / ${part.path}).`,
          );
        }
        const rows = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>[];
        if (!Array.isArray(rows)) throw new Error(`백업 파일 형식 오류(${table} / ${part.path})`);
        if (rows.length !== part.rows) {
          throw new Error(
            `RESTORE_PART_CHANGED_AFTER_PREFLIGHT: 행 수가 사전검증 값과 다릅니다(${table} / ${part.path}).`,
          );
        }

        for (let i = 0; i < rows.length; i += STAGING_INSERT_CHUNK) {
          const chunk = rows.slice(i, i + STAGING_INSERT_CHUNK);
          const payload = chunk.map((row) => ({
            restore_run_id: runId,
            table_name: table,
            part_index: part.part_index,
            part_path: part.path,
            row_sequence: sequence++,
            row_data: row as any,
          }));
          const { error: insertError } = await admin.from("restore_staging_rows").insert(payload as any);
          if (insertError) throw new Error(`준비 영역 적재 실패(${table}): ${insertError.message}`);
        }
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
    const { error: updateError } = await admin
      .from("restore_runs")
      .update({
        staged_rows: staged as any,
        status,
        // staging_verified 는 최종 완료 상태가 아니므로 종료 시각을 남기지 않는다.
        finished_at: verify.ok ? null : new Date().toISOString(),
        // 기존 preflight 감사 증거는 보존하고, 검산 결과는 별도 컬럼에 기록한다.
        staging_verify: verify as any,
        error_code: verify.ok ? null : (verify.issues?.[0]?.code ?? "STAGING_VERIFY_FAILED"),
        error_message: verify.ok ? null : "준비 영역 검산에서 불일치가 발견되었습니다.",
      } as any)
      .eq("id", runId);
    if (updateError) throw new Error(`복원 작업 기록 갱신 실패: ${updateError.message}`);

    return { run_id: runId, staged_rows: staged, status };
  } catch (err) {
    // 실패해도 preflight_result 는 절대 덮어쓰지 않는다.
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
  return data as {
    ok: boolean;
    run_id: string;
    tables: JsonValue[];
    issues: PreflightIssue[];
    unsupported_constraints: JsonValue[];
  };
}
