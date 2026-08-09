// ABD OCS 증분 Import — Storage 충돌 판정 (Stage 7).
// 규칙: 같은 storage_path 가 이미 존재하면 DB metadata 의 content_hash 와
// manifest SHA-256 을 대조한다. 같으면 existing(skip), 다르면 blocker,
// metadata 가 없으면 unresolved collision blocker.
// 신규 컬럼·경로 변경·삭제·overwrite 는 금지.
import { supabase } from "@/integrations/supabase/client";
import { OCS_BUCKET } from "@/lib/abd/ocs-import.functions";
import { OCS_SOURCE_BUCKET } from "@/lib/abd/ocs-source-manifest";
import type { IncrementPackage } from "@/lib/abd/ocs-increment-package";

export type CollisionState =
  | "new"
  | "existing"
  | "declared_new"
  | "hash_mismatch"
  | "unresolved";

export type CollisionRow = {
  kind: "image" | "source";
  bucket: string;
  path: string;
  state: CollisionState;
  expected_hash: string;
  found_hash: string | null;
};

export type CollisionReport = {
  rows: CollisionRow[];
  counts: Record<CollisionState, number>;
  blockers: string[];
  /** state === "existing" 인 경로 집합 — 업로드에서 건너뛴다. */
  skipPaths: Set<string>;
};

export function imageStoragePath(relativePath: string): string {
  return relativePath.replace(/^images\//, "");
}

export function sourceStoragePath(packageId: string, relativePath: string): string {
  const fileName = relativePath.split("/").pop() ?? relativePath;
  return `${packageId}/${fileName}`;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** 버킷에서 대상 경로들의 실제 존재 여부를 확인 (읽기 전용). */
async function existingPaths(bucket: string, paths: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const dirs = new Set(paths.map(dirOf));
  for (const dir of dirs) {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(dir, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`${bucket}/${dir} 조회 실패: ${error.message}`);
      const list = data ?? [];
      for (const it of list) {
        if (!(it as { id?: string | null }).id) continue;
        found.add(dir ? `${dir}/${it.name}` : it.name);
      }
      if (list.length < 1000) break;
      offset += list.length;
    }
  }
  return new Set(paths.filter((p) => found.has(p)));
}

async function hashByPath(
  table: "abd_ocs_attachments" | "abd_ocs_source_files",
  paths: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < paths.length; i += 200) {
    const slice = paths.slice(i, i + 200);
    const { data, error } = await supabase
      .from(table)
      .select("storage_path, content_hash")
      .in("storage_path", slice);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as { storage_path: string; content_hash: string | null }[]) {
      out.set(r.storage_path, r.content_hash);
    }
  }
  return out;
}

function classify(
  kind: CollisionRow["kind"],
  bucket: string,
  path: string,
  expected: string,
  exists: boolean,
  meta: Map<string, string | null>,
  declaredHash?: string,
): CollisionRow {
  if (!exists) {
    return { kind, bucket, path, state: "new", expected_hash: expected, found_hash: null };
  }
  if (!meta.has(path)) {
    if (declaredHash && declaredHash === expected.toLowerCase()) {
      return {
        kind,
        bucket,
        path,
        state: "declared_new",
        expected_hash: expected,
        found_hash: null,
      };
    }
    return { kind, bucket, path, state: "unresolved", expected_hash: expected, found_hash: null };
  }
  const found = (meta.get(path) ?? "").toLowerCase();
  if (!found) {
    if (declaredHash && declaredHash === expected.toLowerCase()) {
      return {
        kind,
        bucket,
        path,
        state: "declared_new",
        expected_hash: expected,
        found_hash: null,
      };
    }
    return { kind, bucket, path, state: "unresolved", expected_hash: expected, found_hash: null };
  }
  return {
    kind,
    bucket,
    path,
    state: found === expected.toLowerCase() ? "existing" : "hash_mismatch",
    expected_hash: expected,
    found_hash: found,
  };
}

export async function checkPackageStorageCollisions(pkg: IncrementPackage): Promise<CollisionReport> {
  const imagePaths = pkg.images.map((b) => imageStoragePath(b.relative_path));
  const sourcePaths = pkg.sourceFiles.map((b) => sourceStoragePath(pkg.manifest.package_id, b.relative_path));
  const declaredImages = new Map(pkg.imageMeta.map((m) => [m.storage_path, m]));

  const [imgExists, srcExists, imgMeta, srcMeta] = await Promise.all([
    imagePaths.length ? existingPaths(OCS_BUCKET, imagePaths) : Promise.resolve(new Set<string>()),
    sourcePaths.length ? existingPaths(OCS_SOURCE_BUCKET, sourcePaths) : Promise.resolve(new Set<string>()),
    imagePaths.length ? hashByPath("abd_ocs_attachments", imagePaths) : Promise.resolve(new Map<string, string | null>()),
    sourcePaths.length ? hashByPath("abd_ocs_source_files", sourcePaths) : Promise.resolve(new Map<string, string | null>()),
  ]);

  const rows: CollisionRow[] = [
    ...pkg.images.map((b, i) =>
      classify(
        "image",
        OCS_BUCKET,
        imagePaths[i]!,
        b.sha256,
        imgExists.has(imagePaths[i]!),
        imgMeta,
        declaredImages.get(imagePaths[i]!)?.content_hash,
      ),
    ),
    ...pkg.sourceFiles.map((b, i) =>
      classify("source", OCS_SOURCE_BUCKET, sourcePaths[i]!, b.sha256, srcExists.has(sourcePaths[i]!), srcMeta),
    ),
  ];

  const counts: Record<CollisionState, number> = {
    new: 0,
    existing: 0,
    declared_new: 0,
    hash_mismatch: 0,
    unresolved: 0,
  };
  for (const r of rows) counts[r.state] += 1;

  const blockers: string[] = [];

  // 동일 attachment ID · 다른 path 교차 충돌 (path 중심 검사만으로는 잡히지 않는다)
  const ids = pkg.imageMeta.map((m) => m.source_attachment_id);
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    if (slice.length === 0) break;
    const { data, error } = await supabase
      .from("abd_ocs_attachments")
      .select("source_attachment_id, storage_path, content_hash")
      .in("source_attachment_id", slice);
    if (error) throw new Error(`abd_ocs_attachments 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as {
      source_attachment_id: string;
      storage_path: string;
      content_hash: string | null;
    }[]) {
      const decl = declaredImages.get(
        pkg.imageMeta.find((m) => m.source_attachment_id === r.source_attachment_id)
          ?.storage_path ?? "",
      );
      if (!decl) continue;
      if (!r.content_hash) {
        blockers.push(`ATTACHMENT_METADATA_MISSING: ${r.source_attachment_id} (기존 해시 없음)`);
      } else if (r.storage_path !== decl.storage_path) {
        blockers.push(
          `ATTACHMENT_ID_PATH_CONFLICT: ${r.source_attachment_id} (DB ${r.storage_path} ≠ 패키지 ${decl.storage_path})`,
        );
      } else if (r.content_hash.toLowerCase() !== decl.content_hash) {
        blockers.push(`ATTACHMENT_ID_HASH_CONFLICT: ${r.source_attachment_id}`);
      }
    }
  }

  if (counts.hash_mismatch > 0) {
    blockers.push(
      `Storage 충돌 — 동일 경로 다른 해시 ${counts.hash_mismatch}건 (overwrite 금지, 패키지 재생성 필요)`,
    );
  }
  if (counts.unresolved > 0) {
    blockers.push(`Storage 충돌 — metadata 없는 미해결 충돌 ${counts.unresolved}건`);
  }

  return {
    rows,
    counts,
    blockers,
    skipPaths: new Set(rows.filter((r) => r.state === "existing").map((r) => r.path)),
  };
}
