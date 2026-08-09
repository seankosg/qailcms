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

/**
 * 최종 Import 용도에서는 Storage 에 object 가 없는 자산을 절대 "신규(fresh)" 로 통과시키지 않는다.
 * (업로드 실패/누락분이 조용히 Import 되는 것을 차단)
 */
export type RecheckOptions = { requireStorageExists?: boolean };

export type ServerCollisionResult = {
  skip_paths: string[];
  new_paths: string[];
  declared_new_paths: string[];
  blockers: string[];
};

/** 신규 자산(이미지·Source Excel) 공통 검증 결과 */
type NewAssetVerdict = { ok: true } | { ok: false; blocker: string };

/**
 * DB metadata 가 없는 신규 자산의 공통 관문.
 * 이미지/Source 를 구분하지 않고 동일 조건을 요구한다:
 * 패키지 선언 일치 → 이번 run/package 업로드 영수증 → 서버 실측 검증 영수증.
 */
function verifyNewAsset(
  a: AssetRef,
  declaredHash: string | undefined,
  declaredSize: number | undefined,
  receipt: UploadReceipt | undefined,
  verified: VerifiedKeySet,
): NewAssetVerdict {
  if (declaredHash === undefined || declaredSize === undefined) {
    return {
      ok: false,
      blocker: `STORAGE_UNRESOLVED: ${a.bucket}/${a.path} — Storage object 는 있으나 DB metadata 가 없습니다.`,
    };
  }
  if (declaredHash !== a.sha256) {
    return {
      ok: false,
      blocker: `PACKAGE_HASH_CONFLICT: ${a.bucket}/${a.path} (선언 ${declaredHash.slice(0, 12)} ≠ 자산 ${a.sha256.slice(0, 12)})`,
    };
  }
  if (!receipt || receipt.sha256 !== a.sha256) {
    return {
      ok: false,
      blocker: `UPLOAD_RECEIPT_MISSING: ${a.bucket}/${a.path} — 이번 run/package 의 업로드 영수증이 없습니다.`,
    };
  }
  if (!verified.has(verifiedKey(a.bucket, a.path, a.sha256, declaredSize))) {
    return {
      ok: false,
      blocker: `SERVER_VERIFY_MISSING: ${a.bucket}/${a.path} — 서버 실측 검증 영수증(hash/size 일치)이 없습니다.`,
    };
  }
  return { ok: true };
}

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
  options: RecheckOptions = {},
): Promise<ServerCollisionResult> {
  const requireStorageExists = options.requireStorageExists === true;
  const blockers: string[] = imageMetaIntegrityBlockers(imageMeta);
  const skip: string[] = [];
  const fresh: string[] = [];
  const declaredNew: string[] = [];
  if (assets.length === 0)
    return { skip_paths: skip, new_paths: fresh, declared_new_paths: declaredNew, blockers };

  const declared = new Map(sourceMeta.map((m) => [m.storage_path, m.content_hash.toLowerCase()]));
  const declaredSourceSize = new Map(sourceMeta.map((m) => [m.storage_path, m.byte_size]));
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
      if (requireStorageExists) {
        blockers.push(
          `STORAGE_MISSING: ${a.bucket}/${a.path} — 업로드되지 않은 자산입니다. 업로드를 완료한 뒤 다시 실행하십시오.`,
        );
      } else {
        fresh.push(a.path);
      }
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
    // metadata 없음 — 이미지/Source 동일 관문 (패키지 선언 + 업로드 영수증 + 서버 실측 검증)
    const declImg = a.kind === "image" ? declaredImages.get(a.path) : undefined;
    const declaredHash =
      a.kind === "image"
        ? declImg && declImg.storage_path === a.path
          ? declImg.content_hash
          : undefined
        : declared.get(a.path);
    const declaredSize =
      a.kind === "image" ? declImg?.byte_size : declaredSourceSize.get(a.path);
    const verdict = verifyNewAsset(
      a,
      declaredHash,
      declaredSize,
      receiptByPath.get(`${a.bucket}::${a.path}`),
      verified,
    );
    if (verdict.ok) declaredNew.push(a.path);
    else blockers.push(verdict.blocker);
  }

  return { skip_paths: skip, new_paths: fresh, declared_new_paths: declaredNew, blockers };
}
