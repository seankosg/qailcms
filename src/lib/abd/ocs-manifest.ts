/**
 * OCS 첨부 매니페스트 어댑터 (Stage A1).
 *
 * 실제 파일 `OCS_Final_Attachment_Manifest.json` 의 필드명을 앱 내부 계약으로 변환한다.
 * 추측 금지 원칙: 원본 키를 그대로 읽고, 별칭은 아래 목록에 명시된 것만 허용한다.
 *
 *  attachment_id | id                -> source_attachment_id
 *  comment_id    | source_comment_id -> source_comment_id (없으면 needs_review)
 *  relative_path                     -> storage_path (정본, 그대로 사용)
 *  image_sha256  | sha256            -> content_hash
 *  source_image_index | image_index | sort_order -> source_image_index
 *  width_px / height_px              -> width / height
 *  image_format  | format            -> image_format
 *  byte_size     | size              -> byte_size
 */
export type OcsManifestEntry = {
  source_attachment_id: string;
  source_comment_id: string | null;
  relative_path: string;
  content_hash: string | null;
  byte_size: number | null;
  source_image_index: number | null;
  width: number | null;
  height: number | null;
  image_format: string | null;
  file_name: string;
  link_status: "unmatched" | "needs_review";
};

export type OcsManifestParse = {
  total_raw: number;
  entries: OcsManifestEntry[];
  skipped_no_path: number;
  needs_review: number;
  duplicated_attachment_ids: string[];
  duplicated_paths: string[];
  invalid_rows: { index: number; reason: string }[];
};

export const OCS_ALLOWED_MIME = ["image/png", "image/jpeg"] as const;
export const OCS_ALLOWED_EXT = ["png", "jpg", "jpeg"] as const;
export const OCS_MAX_BYTES = 8 * 1024 * 1024;

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function basenameOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function extOf(path: string): string {
  const b = basenameOf(path);
  const i = b.lastIndexOf(".");
  return i < 0 ? "" : b.slice(i + 1).toLowerCase();
}

export function mimeForExt(ext: string): string | null {
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return null;
}

export function parseOcsManifest(json: unknown): OcsManifestParse {
  const raw: any[] = Array.isArray(json)
    ? json
    : ((json as any)?.attachments ?? (json as any)?.files ?? (json as any)?.entries ?? []);
  const invalid_rows: { index: number; reason: string }[] = [];
  const entries: OcsManifestEntry[] = [];
  let skipped_no_path = 0;

  raw.forEach((r, i) => {
    const relative_path = str(r?.relative_path);
    if (!relative_path) {
      skipped_no_path += 1;
      return; // A1 업로드 대상 아님 (이미지 파일 없음)
    }
    const source_attachment_id =
      str(r?.attachment_id) ?? str(r?.source_attachment_id) ?? str(r?.id);
    if (!source_attachment_id) {
      invalid_rows.push({ index: i, reason: "attachment_id 누락" });
      return;
    }
    const source_comment_id = str(r?.comment_id) ?? str(r?.source_comment_id);
    const byte_size = num(r?.byte_size) ?? num(r?.size);
    const ext = extOf(relative_path);
    if (!(OCS_ALLOWED_EXT as readonly string[]).includes(ext)) {
      invalid_rows.push({ index: i, reason: `허용되지 않는 형식(.${ext || "?"})` });
      return;
    }
    if (byte_size != null && byte_size > OCS_MAX_BYTES) {
      invalid_rows.push({ index: i, reason: "8MB 초과" });
      return;
    }
    entries.push({
      source_attachment_id,
      source_comment_id,
      relative_path,
      content_hash: (str(r?.image_sha256) ?? str(r?.sha256))?.toLowerCase() ?? null,
      byte_size,
      source_image_index: num(r?.source_image_index) ?? num(r?.image_index) ?? num(r?.sort_order),
      width: num(r?.width_px) ?? num(r?.width),
      height: num(r?.height_px) ?? num(r?.height),
      image_format: str(r?.image_format) ?? str(r?.format) ?? ext,
      file_name: str(r?.file_name) ?? basenameOf(relative_path),
      link_status: source_comment_id ? "unmatched" : "needs_review",
    });
  });

  const seenIds = new Set<string>();
  const dupIds = new Set<string>();
  const seenPaths = new Set<string>();
  const dupPaths = new Set<string>();
  for (const e of entries) {
    if (seenIds.has(e.source_attachment_id)) dupIds.add(e.source_attachment_id);
    seenIds.add(e.source_attachment_id);
    if (seenPaths.has(e.relative_path)) dupPaths.add(e.relative_path);
    seenPaths.add(e.relative_path);
  }

  return {
    total_raw: raw.length,
    entries,
    skipped_no_path,
    needs_review: entries.filter((e) => e.link_status === "needs_review").length,
    duplicated_attachment_ids: Array.from(dupIds),
    duplicated_paths: Array.from(dupPaths),
    invalid_rows,
  };
}

/**
 * 폴더 선택 결과를 매니페스트 경로에 매칭한다.
 * - `webkitRelativePath` 사용 (basename 매칭 금지)
 * - 최상위 폴더 한 단계만 제거하고 나머지 하위 구조는 그대로 비교
 */
export function stripTopFolder(webkitRelativePath: string): string {
  const i = webkitRelativePath.indexOf("/");
  return i < 0 ? webkitRelativePath : webkitRelativePath.slice(i + 1);
}

export type FolderMatchResult = {
  matched: Map<string, File>; // relative_path -> File
  unmatchedManifest: string[]; // 폴더에 없는 manifest 경로
  extraFiles: string[]; // manifest 에 없는 폴더 파일
  nonImageFiles: number;
};

export function matchFolderFiles(
  entries: OcsManifestEntry[],
  files: FileList | File[],
): FolderMatchResult {
  const byPath = new Map<string, File>();
  let nonImageFiles = 0;
  const manifestRoots = new Set(
    entries.map((e) => e.relative_path.split("/")[0]).filter((v): v is string => !!v),
  );
  for (const f of Array.from(files)) {
    const full = ((f as any).webkitRelativePath as string) || f.name;
    const ext = extOf(full);
    if (!(OCS_ALLOWED_EXT as readonly string[]).includes(ext)) {
      nonImageFiles += 1;
      continue;
    }
    // 사용자가 상위 폴더(ocs-db-all)를 골랐으면 한 단계 제거,
    // manifest 루트 폴더(attachments) 자체를 골랐으면 그대로 비교한다.
    const top = full.split("/")[0] ?? "";
    const rel = manifestRoots.has(top) ? full : stripTopFolder(full);
    byPath.set(rel, f);
  }
  const matched = new Map<string, File>();
  const unmatchedManifest: string[] = [];
  for (const e of entries) {
    const f = byPath.get(e.relative_path);
    if (f) {
      matched.set(e.relative_path, f);
      byPath.delete(e.relative_path);
    } else unmatchedManifest.push(e.relative_path);
  }
  return { matched, unmatchedManifest, extraFiles: Array.from(byPath.keys()), nonImageFiles };
}
