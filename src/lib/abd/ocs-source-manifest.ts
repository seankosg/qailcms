/**
 * OCS 원본 Excel 업로드 매니페스트 어댑터.
 * `OCS_Source_File_Upload_Manifest.json` 의 필드를 앱 계약으로 변환한다.
 * relative_path / storage_path 는 매니페스트 값을 정본으로 그대로 사용한다.
 */
export const OCS_SOURCE_BUCKET = "abd-ocs-source-files";
export const OCS_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const OCS_SOURCE_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type OcsSourceEntry = {
  source_file_id: string;
  file_name: string;
  relative_path: string;
  storage_path: string;
  content_hash: string | null;
  byte_size: number | null;
  mime_type: string;
};

export type OcsSourceManifestParse = {
  total_raw: number;
  entries: OcsSourceEntry[];
  invalid_rows: { index: number; reason: string }[];
  duplicated_ids: string[];
  duplicated_paths: string[];
};

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function isXlsx(name: string): boolean {
  return name.toLowerCase().endsWith(".xlsx");
}

export function parseOcsSourceManifest(json: unknown): OcsSourceManifestParse {
  const box = (json ?? {}) as Record<string, unknown>;
  const raw: Record<string, unknown>[] = (
    Array.isArray(json) ? json : (box["files"] ?? box["source_files"] ?? box["entries"] ?? [])
  ) as Record<string, unknown>[];

  const entries: OcsSourceEntry[] = [];
  const invalid_rows: { index: number; reason: string }[] = [];

  raw.forEach((r, i) => {
    const relative_path = str(r?.relative_path) ?? str(r?.path);
    if (!relative_path) {
      invalid_rows.push({ index: i, reason: "relative_path 누락" });
      return;
    }
    const file_name = str(r?.file_name) ?? baseName(relative_path);
    if (!isXlsx(file_name)) {
      invalid_rows.push({ index: i, reason: "XLSX 아님" });
      return;
    }
    const storage_path = str(r?.storage_path);
    if (!storage_path) {
      invalid_rows.push({ index: i, reason: "storage_path 누락" });
      return;
    }
    const content_hash =
      (str(r?.content_hash) ?? str(r?.sha256) ?? str(r?.file_sha256))?.toLowerCase() ?? null;
    const byte_size = num(r?.byte_size) ?? num(r?.size);
    if (byte_size != null && byte_size > OCS_SOURCE_MAX_BYTES) {
      invalid_rows.push({ index: i, reason: "20MiB 초과" });
      return;
    }
    entries.push({
      source_file_id:
        str(r?.source_file_id) ?? str(r?.file_id) ?? str(r?.id) ?? content_hash ?? relative_path,
      file_name,
      relative_path,
      storage_path,
      content_hash,
      byte_size,
      mime_type: str(r?.mime_type) ?? OCS_SOURCE_MIME,
    });
  });

  const seenId = new Set<string>();
  const dupId = new Set<string>();
  const seenPath = new Set<string>();
  const dupPath = new Set<string>();
  for (const e of entries) {
    if (seenId.has(e.source_file_id)) dupId.add(e.source_file_id);
    seenId.add(e.source_file_id);
    if (seenPath.has(e.storage_path)) dupPath.add(e.storage_path);
    seenPath.add(e.storage_path);
  }

  return {
    total_raw: raw.length,
    entries,
    invalid_rows,
    duplicated_ids: Array.from(dupId),
    duplicated_paths: Array.from(dupPath),
  };
}

function stripTopFolder(p: string): string {
  const i = p.indexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

export type OcsSourceFolderMatch = {
  matched: Map<string, File>; // relative_path -> File
  missing: string[]; // 매니페스트에는 있으나 폴더에 없는 relative_path
  folderOnly: string[]; // 폴더에만 있는 파일
  nonXlsx: number;
};

export function matchSourceFolder(
  entries: OcsSourceEntry[],
  files: FileList | File[],
): OcsSourceFolderMatch {
  const roots = new Set(
    entries.map((e) => e.relative_path.split("/")[0]).filter((v): v is string => !!v),
  );
  const byPath = new Map<string, File>();
  let nonXlsx = 0;

  for (const f of Array.from(files)) {
    const full = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (!isXlsx(full)) {
      nonXlsx += 1;
      continue;
    }
    const top = full.split("/")[0] ?? "";
    const rel = roots.has(top) ? full : stripTopFolder(full);
    byPath.set(rel, f);
  }

  const matched = new Map<string, File>();
  const missing: string[] = [];
  for (const e of entries) {
    const f = byPath.get(e.relative_path);
    if (f) {
      matched.set(e.relative_path, f);
      byPath.delete(e.relative_path);
    } else missing.push(e.relative_path);
  }
  return { matched, missing, folderOnly: Array.from(byPath.keys()), nonXlsx };
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}