/**
 * 논리 DR 내보내기 — 서버 전용 로직.
 *
 * - 토큰 원문은 발급 응답에서 1회만 반환하고, DB 에는 SHA-256 만 남긴다.
 * - 운영 테이블은 dr_export_runs 외에 어떤 것도 쓰지 않는다.
 * - Snapshot 폴더(db-backups) 는 manifest 가 선언한 경로만 읽는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BUCKET as SNAPSHOT_BUCKET, SNAPSHOT_SCHEMA_VERSION } from "./backup-core.server";
import { normalizePartPath, sha256Hex } from "./manifest-hash";
import {
  DR_TOKEN_TTL_HOURS,
  DR_WORK_BUCKETS,
  checkRunUsable,
  collectManifestParts,
  generateDrToken,
  hashDrToken,
  isBucketAllowed,
  normalizeObjectPath,
} from "./dr-export-contract";

type Admin = SupabaseClient<Database>;

export class DrExportError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function snapshotFolder(storagePath: string): string {
  return storagePath.endsWith("/") ? storagePath : `${storagePath}/`;
}

/** Snapshot manifest 원본 bytes 를 읽고 계약을 사전검증한다(part 전수 다운로드 없음). */
export async function loadAndVerifySnapshot(admin: Admin, snapshotId: string) {
  const { data: row, error } = await admin
    .from("database_snapshots")
    .select("id, name, created_at, storage_path, sha256_hash, size_bytes, metadata")
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw new DrExportError("SNAPSHOT_QUERY_FAILED", error.message, 500);
  if (!row?.storage_path) throw new DrExportError("SNAPSHOT_NOT_FOUND", "선택한 Snapshot 을 찾을 수 없습니다.", 404);

  const folder = snapshotFolder(row.storage_path);
  const { data: blob, error: dlErr } = await admin.storage.from(SNAPSHOT_BUCKET).download(`${folder}manifest.json`);
  if (dlErr || !blob) {
    throw new DrExportError("SNAPSHOT_MANIFEST_MISSING", "Snapshot 목록 파일(manifest.json)이 없습니다.", 409);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const manifestSha = await sha256Hex(bytes);
  let manifest: any;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DrExportError("SNAPSHOT_MANIFEST_INVALID", "Snapshot 목록 파일을 읽을 수 없습니다.", 409);
  }

  if (manifest?.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new DrExportError(
      "SNAPSHOT_SCHEMA_VERSION_UNSUPPORTED",
      `논리 DR 은 ${SNAPSHOT_SCHEMA_VERSION} Snapshot 만 사용할 수 있습니다.`,
      409,
    );
  }
  if (typeof manifest?.sha256 !== "string" || manifest.sha256.length !== 64) {
    throw new DrExportError("SNAPSHOT_HASH_MISSING", "Snapshot 전체 해시 계약이 없습니다.", 409);
  }
  if (row.sha256_hash && row.sha256_hash !== manifest.sha256) {
    throw new DrExportError("SNAPSHOT_HASH_MISMATCH", "DB 기록과 Snapshot 목록 파일의 해시가 다릅니다.", 409);
  }
  if (!manifest?.schema_fingerprint) {
    throw new DrExportError("SNAPSHOT_FINGERPRINT_MISSING", "Snapshot 스키마 지문 계약이 없습니다.", 409);
  }

  const parts = collectManifestParts(manifest);
  if (parts.length === 0) throw new DrExportError("SNAPSHOT_PARTS_EMPTY", "Snapshot 데이터 파일 목록이 비어 있습니다.", 409);
  for (const p of parts) {
    const check = normalizePartPath(folder, p.path);
    if (!check.ok) throw new DrExportError(check.code, `Snapshot 파일 경로가 올바르지 않습니다: ${check.reason}`, 409);
    if (!p.sha256 || p.sha256.length !== 64) {
      throw new DrExportError("SNAPSHOT_PART_HASH_MISSING", "Snapshot 파일 해시 계약이 없습니다.", 409);
    }
  }

  return { row, folder, manifest, manifestBytes: bytes, manifestSha, parts };
}

/** 일회용 토큰 발급. 반환된 token 원문은 이 시점에만 존재한다. */
export async function issueDrExportRun(admin: Admin, snapshotId: string, issuedBy: string) {
  const verified = await loadAndVerifySnapshot(admin, snapshotId);
  const token = generateDrToken();
  const tokenSha = await hashDrToken(token);
  const expiresAt = new Date(Date.now() + DR_TOKEN_TTL_HOURS * 3600_000).toISOString();

  const { data, error } = await (admin as any)
    .from("dr_export_runs")
    .insert({
      snapshot_id: snapshotId,
      issued_by: issuedBy,
      token_sha256: tokenSha,
      status: "issued",
      expires_at: expiresAt,
      snapshot_manifest_sha256: verified.manifestSha,
      snapshot_overall_sha256: verified.manifest.sha256,
      buckets: [...DR_WORK_BUCKETS],
    })
    .select("id, expires_at")
    .single();
  if (error) throw new DrExportError("RUN_CREATE_FAILED", error.message, 500);

  return {
    runId: data.id as string,
    token,
    expiresAt: data.expires_at as string,
    snapshotId,
    snapshotManifestSha256: verified.manifestSha,
    snapshotOverallSha256: verified.manifest.sha256 as string,
    buckets: [...DR_WORK_BUCKETS],
    partCount: verified.parts.length,
  };
}

/** Bearer 토큰 검증 후 run 행을 돌려준다. */
export async function authenticateDrToken(admin: Admin, request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new DrExportError("TOKEN_MISSING", "토큰이 필요합니다.", 401);
  const token = header.slice(7).trim();
  if (!token) throw new DrExportError("TOKEN_MISSING", "토큰이 필요합니다.", 401);

  const tokenSha = await hashDrToken(token);
  const { data: run, error } = await (admin as any)
    .from("dr_export_runs")
    .select("*")
    .eq("token_sha256", tokenSha)
    .maybeSingle();
  if (error) throw new DrExportError("RUN_QUERY_FAILED", error.message, 500);

  const gate = checkRunUsable(run);
  if (!gate.ok) throw new DrExportError(gate.code, gate.message, 401);

  if (run.status === "issued") {
    await (admin as any)
      .from("dr_export_runs")
      .update({ status: "downloading", first_used_at: run.first_used_at ?? new Date().toISOString() })
      .eq("id", run.id);
  }
  return { run, token };
}

/** 이 run 이 접근할 수 있는 Snapshot part 전체 경로를 확정한다(선언 목록 밖은 차단). */
export async function resolveSnapshotPart(admin: Admin, run: any, rawPath: unknown) {
  const verified = await loadAndVerifySnapshot(admin, run.snapshot_id);
  if (run.snapshot_manifest_sha256 && run.snapshot_manifest_sha256 !== verified.manifestSha) {
    throw new DrExportError("SNAPSHOT_MANIFEST_CHANGED", "Snapshot 목록 파일이 발급 시점과 다릅니다.", 409);
  }
  const norm = normalizeObjectPath(rawPath);
  if (!norm.ok) throw new DrExportError(norm.code, norm.message, 400);
  const declared = verified.parts.find((p) => p.path === norm.path);
  if (!declared) throw new DrExportError("PART_NOT_DECLARED", "목록에 없는 파일은 내려받을 수 없습니다.", 403);
  const full = normalizePartPath(verified.folder, declared.path);
  if (!full.ok) throw new DrExportError(full.code, full.reason, 400);
  return { fullPath: full.fullPath, declared, bucket: SNAPSHOT_BUCKET };
}

/** 업무 버킷 재귀 목록(페이지네이션). 허용 버킷 외에는 즉시 거부한다. */
export async function listWorkBucketObjects(
  admin: Admin,
  bucket: string,
  opts: { prefix?: string; limit: number; offset: number },
) {
  if (!isBucketAllowed(bucket)) throw new DrExportError("BUCKET_NOT_ALLOWED", "허용되지 않은 보관함입니다.", 403);
  let prefix = "";
  if (opts.prefix) {
    const norm = normalizeObjectPath(opts.prefix);
    if (!norm.ok) throw new DrExportError(norm.code, norm.message, 400);
    prefix = norm.path;
  }

  // 폴더 재귀 탐색: 큐 방식으로 하위 폴더까지 모두 훑는다.
  const files: { path: string; size: number; updated_at: string | null }[] = [];
  const queue: string[] = [prefix];
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    let page = 0;
    for (;;) {
      const { data, error } = await admin.storage
        .from(bucket)
        .list(dir, { limit: 1000, offset: page * 1000, sortBy: { column: "name", order: "asc" } });
      if (error) throw new DrExportError("BUCKET_LIST_FAILED", error.message, 502);
      const rows = data ?? [];
      for (const it of rows) {
        const child = dir ? `${dir}/${it.name}` : it.name;
        if (it.id === null || it.metadata == null) queue.push(child);
        else files.push({ path: child, size: Number((it.metadata as any)?.size ?? 0), updated_at: it.updated_at ?? null });
      }
      if (rows.length < 1000) break;
      page += 1;
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const slice = files.slice(opts.offset, opts.offset + opts.limit);
  return {
    bucket,
    total: files.length,
    total_bytes: files.reduce((s, f) => s + f.size, 0),
    offset: opts.offset,
    limit: opts.limit,
    next_offset: opts.offset + slice.length < files.length ? opts.offset + slice.length : null,
    files: slice,
  };
}

/** 업무 버킷 object 경로 확정: 허용 버킷 + 실제 존재 확인. */
export async function resolveWorkObject(admin: Admin, bucket: string, rawPath: unknown) {
  if (!isBucketAllowed(bucket)) throw new DrExportError("BUCKET_NOT_ALLOWED", "허용되지 않은 보관함입니다.", 403);
  const norm = normalizeObjectPath(rawPath);
  if (!norm.ok) throw new DrExportError(norm.code, norm.message, 400);
  const segs = norm.path.split("/");
  const name = segs.pop() as string;
  const dir = segs.join("/");
  const { data, error } = await admin.storage.from(bucket).list(dir, { limit: 100, search: name });
  if (error) throw new DrExportError("OBJECT_LOOKUP_FAILED", error.message, 502);
  const hit = (data ?? []).find((it) => it.name === name && it.id !== null);
  if (!hit) throw new DrExportError("OBJECT_NOT_LISTED", "목록에 없는 파일은 내려받을 수 없습니다.", 403);
  return { bucket, path: norm.path, size: Number((hit.metadata as any)?.size ?? 0) };
}
