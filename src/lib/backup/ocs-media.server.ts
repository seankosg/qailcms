import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** 백업 산출물이 저장되는 버킷 (DB 스냅샷과 동일) */
const BACKUP_BUCKET = "db-backups";
/** OCS 원본 이미지 비공개 버킷 */
export const OCS_BUCKET = "abd-ocs-attachments";

export type MediaManifestEntry = {
  storage_path: string;
  source_attachment_id: string | null;
  content_hash: string;
  size_bytes: number;
  backup_path: string;
  db_content_hash: string | null;
};

export type MediaFailure = { storage_path: string; error: string };

export type MediaBatchResult = {
  processed: number;
  copied: number;
  skipped_existing: number;
  failures: MediaFailure[];
  next_offset: number | null;
  total: number;
};

function mediaFolder(snapshotId: string) {
  return `snapshots/${snapshotId}/media/`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function countOcsMedia(supabaseAdmin: SupabaseClient<Database>): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("abd_ocs_attachments")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`첨부 개수 조회 실패: ${error.message}`);
  return count ?? 0;
}

/**
 * OCS 이미지 배치 백업.
 * - 원본은 읽기만 하며 절대 삭제/수정하지 않는다.
 * - 백업 대상 경로가 이미 있으면 overwrite 하지 않고 skip 한다(upsert=false).
 * - 배치별 manifest part 파일을 남기고 finalize 에서 병합한다.
 */
export async function backupOcsMediaBatch(
  supabaseAdmin: SupabaseClient<Database>,
  snapshotId: string,
  offset: number,
  limit: number,
): Promise<MediaBatchResult> {
  const total = await countOcsMedia(supabaseAdmin);
  const { data: rows, error } = await supabaseAdmin
    .from("abd_ocs_attachments")
    .select("id, storage_path, source_attachment_id, content_hash")
    .order("storage_path", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`첨부 목록 조회 실패: ${error.message}`);

  const entries: MediaManifestEntry[] = [];
  const failures: MediaFailure[] = [];
  let copied = 0;
  let skippedExisting = 0;
  const folder = mediaFolder(snapshotId);

  for (const row of rows ?? []) {
    const path = row.storage_path as string;
    try {
      const { data: blob, error: dlError } = await supabaseAdmin.storage.from(OCS_BUCKET).download(path);
      if (dlError || !blob) throw new Error(dlError?.message ?? "다운로드 실패");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hash = await sha256Hex(bytes);
      const backupPath = `${folder}${path}`;

      const { error: upError } = await supabaseAdmin.storage
        .from(BACKUP_BUCKET)
        .upload(backupPath, new Blob([bytes], { type: blob.type || "application/octet-stream" }), {
          contentType: blob.type || "application/octet-stream",
          upsert: false,
        });
      if (upError) {
        const msg = upError.message ?? "";
        if (/exists/i.test(msg)) skippedExisting++;
        else throw new Error(msg);
      } else {
        copied++;
      }

      entries.push({
        storage_path: path,
        source_attachment_id: (row.source_attachment_id as string | null) ?? null,
        content_hash: hash,
        size_bytes: bytes.length,
        backup_path: backupPath,
        db_content_hash: (row.content_hash as string | null) ?? null,
      });
    } catch (err) {
      failures.push({ storage_path: path, error: (err as Error).message });
    }
  }

  // 배치 manifest part 기록 (재실행 시 덮어쓰기 허용 — 백업 원본 이미지가 아니라 메타 파일)
  const partName = `media-manifest.part-${String(Math.floor(offset / Math.max(limit, 1))).padStart(4, "0")}.json`;
  const partBytes = new TextEncoder().encode(JSON.stringify(entries));
  const { error: partError } = await supabaseAdmin.storage
    .from(BACKUP_BUCKET)
    .upload(`snapshots/${snapshotId}/${partName}`, new Blob([partBytes], { type: "application/json" }), {
      contentType: "application/json",
      upsert: true,
    });
  if (partError) throw new Error(`media manifest part 저장 실패: ${partError.message}`);

  const nextOffset = offset + (rows?.length ?? 0);
  return {
    processed: rows?.length ?? 0,
    copied,
    skipped_existing: skippedExisting,
    failures,
    next_offset: nextOffset < total ? nextOffset : null,
    total,
  };
}

export async function finalizeOcsMediaManifest(
  supabaseAdmin: SupabaseClient<Database>,
  snapshotId: string,
): Promise<{ files: number; total_bytes: number }> {
  const { data: files, error: listError } = await supabaseAdmin.storage
    .from(BACKUP_BUCKET)
    .list(`snapshots/${snapshotId}`, { limit: 1000 });
  if (listError) throw new Error(`part 목록 조회 실패: ${listError.message}`);

  const parts = (files ?? [])
    .map((f) => f.name)
    .filter((n) => n.startsWith("media-manifest.part-"))
    .sort();

  const entries: MediaManifestEntry[] = [];
  for (const part of parts) {
    const { data: blob, error } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .download(`snapshots/${snapshotId}/${part}`);
    if (error || !blob) throw new Error(`part 읽기 실패 (${part}): ${error?.message}`);
    entries.push(...(JSON.parse(await blob.text()) as MediaManifestEntry[]));
  }

  const manifest = {
    snapshot_id: snapshotId,
    bucket: OCS_BUCKET,
    created_at: new Date().toISOString(),
    file_count: entries.length,
    total_bytes: entries.reduce((s, e) => s + e.size_bytes, 0),
    files: entries,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const { error: upError } = await supabaseAdmin.storage
    .from(BACKUP_BUCKET)
    .upload(`snapshots/${snapshotId}/media-manifest.json`, new Blob([bytes], { type: "application/json" }), {
      contentType: "application/json",
      upsert: true,
    });
  if (upError) throw new Error(`media manifest 저장 실패: ${upError.message}`);

  return { files: entries.length, total_bytes: manifest.total_bytes };
}

export type MediaVerifyResult = {
  db_rows: number;
  manifest_files: number;
  stored_files: number;
  missing: string[];
  orphan: string[];
  hash_mismatch: string[];
};

async function listAllUnder(
  supabaseAdmin: SupabaseClient<Database>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const out: string[] = [];
  const stack = [prefix];
  while (stack.length) {
    const dir = stack.pop()!;
    let offset = 0;
    while (true) {
      const { data, error } = await supabaseAdmin.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error) throw new Error(`목록 조회 실패 (${dir}): ${error.message}`);
      const items = data ?? [];
      for (const item of items) {
        const full = dir ? `${dir}/${item.name}` : item.name;
        if (item.id === null || item.metadata === null) stack.push(full);
        else out.push(full);
      }
      if (items.length < 1000) break;
      offset += 1000;
    }
  }
  return out;
}

/**
 * 복구 검증: 백업된 이미지 파일 목록 ↔ DB attachment metadata 대조.
 * missing = DB 에는 있으나 백업 파일 없음, orphan = 백업 파일이 DB 에 없음,
 * hash mismatch = 백업 시 실제 바이트 해시와 DB content_hash 불일치.
 */
export async function verifyOcsMedia(
  supabaseAdmin: SupabaseClient<Database>,
  snapshotId: string,
): Promise<MediaVerifyResult> {
  const { data: blob, error } = await supabaseAdmin.storage
    .from(BACKUP_BUCKET)
    .download(`snapshots/${snapshotId}/media-manifest.json`);
  if (error || !blob) throw new Error("media-manifest.json 이 없습니다. 먼저 OCS 이미지 백업을 실행하십시오.");
  const manifest = JSON.parse(await blob.text()) as { files: MediaManifestEntry[] };
  const entries = manifest.files ?? [];

  // DB 정본
  const dbRows: { storage_path: string; content_hash: string | null }[] = [];
  let from = 0;
  while (true) {
    const { data, error: dbError } = await supabaseAdmin
      .from("abd_ocs_attachments")
      .select("storage_path, content_hash")
      .order("storage_path", { ascending: true })
      .range(from, from + 999);
    if (dbError) throw new Error(`DB 조회 실패: ${dbError.message}`);
    const rows = (data ?? []) as { storage_path: string; content_hash: string | null }[];
    dbRows.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }

  const folder = mediaFolder(snapshotId);
  const stored = new Set(
    (await listAllUnder(supabaseAdmin, BACKUP_BUCKET, folder.replace(/\/$/, ""))).map((p) =>
      p.startsWith(folder) ? p.slice(folder.length) : p,
    ),
  );
  const entryByPath = new Map(entries.map((e) => [e.storage_path, e]));
  const dbPaths = new Set(dbRows.map((r) => r.storage_path));

  const missing: string[] = [];
  const hashMismatch: string[] = [];
  for (const row of dbRows) {
    const entry = entryByPath.get(row.storage_path);
    if (!entry || !stored.has(row.storage_path)) {
      missing.push(row.storage_path);
      continue;
    }
    if (row.content_hash && entry.content_hash !== row.content_hash) hashMismatch.push(row.storage_path);
  }
  const orphan = [...stored].filter((p) => !dbPaths.has(p));

  return {
    db_rows: dbRows.length,
    manifest_files: entries.length,
    stored_files: stored.size,
    missing,
    orphan,
    hash_mismatch: hashMismatch,
  };
}