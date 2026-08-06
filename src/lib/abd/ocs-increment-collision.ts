// ABD OCS 증분 Import — Import 직전 서버측 Storage 충돌 최종 판정.
// 클라이언트 사전 점검과 동일 규칙을 서버에서 다시 적용한다.
import type { AssetRef, SourceFileMeta } from "@/lib/abd/ocs-increment-types";

export type MetaRow = { storage_path: string; content_hash: string | null };
export type MetaLookup = (
  table: "abd_ocs_attachments" | "abd_ocs_source_files",
  paths: string[],
) => Promise<MetaRow[]>;
export type StorageLister = (bucket: string, dir: string) => Promise<string[]>;

export type ServerCollisionResult = {
  skip_paths: string[];
  new_paths: string[];
  blockers: string[];
};

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export async function recheckCollisionsServerSide(
  assets: AssetRef[],
  sourceMeta: SourceFileMeta[],
  lookupMeta: MetaLookup,
  listStorage: StorageLister,
): Promise<ServerCollisionResult> {
  const blockers: string[] = [];
  const skip: string[] = [];
  const fresh: string[] = [];
  if (assets.length === 0) return { skip_paths: skip, new_paths: fresh, blockers };

  const declared = new Map(sourceMeta.map((m) => [m.storage_path, m.content_hash.toLowerCase()]));

  // 1) Storage 실제 존재 여부
  const existing = new Set<string>();
  const buckets = new Map<string, Set<string>>();
  for (const a of assets) {
    if (!buckets.has(a.bucket)) buckets.set(a.bucket, new Set());
    buckets.get(a.bucket)!.add(dirOf(a.path));
  }
  for (const [bucket, dirs] of buckets) {
    for (const dir of dirs) {
      const names = await listStorage(bucket, dir);
      for (const n of names) existing.add(`${bucket}::${dir ? `${dir}/${n}` : n}`);
    }
  }

  // 2) DB metadata 대조
  const meta = new Map<string, string | null>();
  const byTable: Record<"abd_ocs_attachments" | "abd_ocs_source_files", string[]> = {
    abd_ocs_attachments: assets.filter((a) => a.kind === "image").map((a) => a.path),
    abd_ocs_source_files: assets.filter((a) => a.kind === "source").map((a) => a.path),
  };
  for (const table of Object.keys(byTable) as (keyof typeof byTable)[]) {
    const paths = byTable[table];
    for (let i = 0; i < paths.length; i += 200) {
      for (const r of await lookupMeta(table, paths.slice(i, i + 200))) {
        meta.set(`${table}::${r.storage_path}`, r.content_hash);
      }
    }
  }

  for (const a of assets) {
    const table = a.kind === "image" ? "abd_ocs_attachments" : "abd_ocs_source_files";
    const exists = existing.has(`${a.bucket}::${a.path}`);
    if (!exists) {
      fresh.push(a.path);
      continue;
    }
    const key = `${table}::${a.path}`;
    const found = (meta.get(key) ?? "").toLowerCase();
    if (meta.has(key) && found) {
      if (found === a.sha256) skip.push(a.path);
      else
        blockers.push(
          `STORAGE_HASH_MISMATCH: ${a.bucket}/${a.path} (DB ${found.slice(0, 12)} ≠ 패키지 ${a.sha256.slice(0, 12)})`,
        );
      continue;
    }
    // metadata 없음 — 이번 패키지가 방금 올린 원본 Excel 만 허용 (등록은 서버 트랜잭션에서 수행)
    if (a.kind === "source" && declared.get(a.path) === a.sha256) {
      fresh.push(a.path);
      continue;
    }
    blockers.push(`STORAGE_UNRESOLVED: ${a.bucket}/${a.path} — Storage object 는 있으나 DB metadata 가 없습니다.`);
  }

  return { skip_paths: skip, new_paths: fresh, blockers };
}
