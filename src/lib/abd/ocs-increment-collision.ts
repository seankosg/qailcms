// ABD OCS 증분 Import — Import 직전 서버측 Storage 충돌 최종 판정.
// 클라이언트 사전 점검과 동일 규칙을 서버에서 다시 적용한다.
import type {
  AssetRef,
  ImageMeta,
  SourceFileMeta,
  UploadReceipt,
} from "@/lib/abd/ocs-increment-types";

export type MetaRow = { storage_path: string; content_hash: string | null };
export type MetaLookup = (
  table: "abd_ocs_attachments" | "abd_ocs_source_files",
  paths: string[],
) => Promise<MetaRow[]>;
export type StorageLister = (bucket: string, dir: string) => Promise<string[]>;
/**
 * 서버 실측 검증 영수증 키 집합 — `bucket::path::sha256::byte_size`.
 * 별도 batch 서버 함수(ocsIncVerifyBatch)가 object 를 직접 내려받아 계산한 결과만 들어온다.
 */
export type VerifiedKeySet = Set<string>;

export const verifiedKey = (bucket: string, path: string, sha256: string, byteSize: number) =>
  `${bucket}::${path}::${sha256.toLowerCase()}::${byteSize}`;

export type RunIdentity = { run_id: string; package_id: string };

export type ServerCollisionResult = {
  skip_paths: string[];
  new_paths: string[];
  declared_new_paths: string[];
  blockers: string[];
};

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** 서버 입력 최종 방어 — attachment ID/경로 중복 및 ID↔경로 교차 불일치. */
export function imageMetaIntegrityBlockers(imageMeta: ImageMeta[]): string[] {
  const out: string[] = [];
  const byId = new Map<string, ImageMeta>();
  const byPath = new Map<string, ImageMeta>();
  for (const m of imageMeta) {
    const prevId = byId.get(m.source_attachment_id);
    if (prevId) {
      out.push(
        prevId.storage_path === m.storage_path && prevId.content_hash === m.content_hash
          ? `DUPLICATE_ATTACHMENT_ID: ${m.source_attachment_id}`
          : `ATTACHMENT_ID_PATH_CONFLICT(input): ${m.source_attachment_id} (${prevId.storage_path} ≠ ${m.storage_path})`,
      );
    }
    byId.set(m.source_attachment_id, m);
    const prevPath = byPath.get(m.storage_path);
    if (prevPath) {
      out.push(
        prevPath.source_attachment_id === m.source_attachment_id &&
          prevPath.content_hash === m.content_hash
          ? `DUPLICATE_STORAGE_PATH: ${m.storage_path}`
          : `STORAGE_PATH_ID_CONFLICT(input): ${m.storage_path} (${prevPath.source_attachment_id} ≠ ${m.source_attachment_id})`,
      );
    }
    byPath.set(m.storage_path, m);
  }
  return out;
}

export async function recheckCollisionsServerSide(
  assets: AssetRef[],
  sourceMeta: SourceFileMeta[],
  lookupMeta: MetaLookup,
  listStorage: StorageLister,
  imageMeta: ImageMeta[] = [],
  receipts: UploadReceipt[] = [],
  identity?: RunIdentity,
  verified: VerifiedKeySet = new Set<string>(),
): Promise<ServerCollisionResult> {
  const blockers: string[] = imageMetaIntegrityBlockers(imageMeta);
  const skip: string[] = [];
  const fresh: string[] = [];
  const declaredNew: string[] = [];
  if (assets.length === 0)
    return { skip_paths: skip, new_paths: fresh, declared_new_paths: declaredNew, blockers };

  const declared = new Map(sourceMeta.map((m) => [m.storage_path, m.content_hash.toLowerCase()]));
  const declaredImages = new Map(imageMeta.map((m) => [m.storage_path, m]));
  // receipt 교차검증 — 다른 run/package 영수증 재사용 차단.
  const foreign = receipts.filter(
    (r) =>
      identity !== undefined &&
      (r.run_id !== identity.run_id || r.package_id !== identity.package_id),
  );
  if (foreign.length > 0) {
    blockers.push(
      `RECEIPT_FOREIGN_RUN: 다른 run/package 의 업로드 영수증 ${foreign.length}건 (${foreign
        .slice(0, 3)
        .map((r) => `${r.run_id}/${r.package_id}`)
        .join(", ")})`,
    );
  }
  const receiptByPath = new Map(
    receipts
      .filter(
        (r) =>
          (r.state === "uploaded" || r.state === "declared_new") &&
          (identity === undefined ||
            (r.run_id === identity.run_id && r.package_id === identity.package_id)),
      )
      .map((r) => [`${r.bucket}::${r.path}`, r]),
  );

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
    // 신규 이미지: 패키지 선언 + ID/경로/해시 일치 + 이번 run 업로드 receipt 가 모두 있어야 허용
    if (a.kind === "image") {
      const decl = declaredImages.get(a.path);
      const rec = receiptByPath.get(`${a.bucket}::${a.path}`);
      if (
        decl &&
        decl.storage_path === a.path &&
        decl.content_hash === a.sha256 &&
        rec &&
        rec.sha256 === a.sha256
      ) {
        // 클라이언트 신고 SHA-256 을 믿지 않는다 — 서버 검증 배치가 남긴 영수증만 인정한다.
        if (!verified.has(verifiedKey(a.bucket, a.path, a.sha256, decl.byte_size))) {
          blockers.push(
            `SERVER_VERIFY_MISSING: ${a.bucket}/${a.path} — 서버 실측 검증 영수증(hash/size 일치)이 없습니다.`,
          );
          continue;
        }
        declaredNew.push(a.path);
        continue;
      }
    }
    blockers.push(
      `STORAGE_UNRESOLVED: ${a.bucket}/${a.path} — Storage object 는 있으나 DB metadata 가 없습니다.`,
    );
  }

  return { skip_paths: skip, new_paths: fresh, declared_new_paths: declaredNew, blockers };
}
