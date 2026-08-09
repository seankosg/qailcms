import { describe, expect, it } from "vitest";
import {
  recheckCollisionsServerSide,
  verifiedKey,
  type MetaRow,
} from "./ocs-increment-collision";
import type { AssetRef, ImageMeta, SourceFileMeta, UploadReceipt } from "./ocs-increment-types";

const SRC_BUCKET = "ocs-source";
const IMG_BUCKET = "ocs-images";
const RUN = "run-1";
const PKG = "pkg-1";

const srcAsset: AssetRef = {
  kind: "source",
  bucket: SRC_BUCKET,
  path: "pkg-1/a.xlsx",
  sha256: "aa11",
};
const imgAsset: AssetRef = {
  kind: "image",
  bucket: IMG_BUCKET,
  path: "img/1.jpg",
  sha256: "bb22",
};

const srcMeta: SourceFileMeta = {
  source_file_id: "s1",
  file_name: "a.xlsx",
  relative_path: "a.xlsx",
  storage_path: srcAsset.path,
  content_hash: "aa11",
  byte_size: 100,
  mime_type: "application/vnd.ms-excel",
};

const imgMeta: ImageMeta = {
  source_attachment_id: "att-1",
  storage_path: imgAsset.path,
  content_hash: "bb22",
  byte_size: 200,
  width: null,
  height: null,
  image_format: "jpeg",
  mime_type: "image/jpeg",
  source_image_index: null,
  source_parent_comment_id: null,
  atomic_comment_id: null,
  attachment_scope: "comment",
};

const receipt = (over: Partial<UploadReceipt> = {}): UploadReceipt => ({
  run_id: RUN,
  package_id: PKG,
  bucket: SRC_BUCKET,
  path: srcAsset.path,
  sha256: "aa11",
  state: "uploaded",
  ...over,
});

const noMeta = async (): Promise<MetaRow[]> => [];
const lister = (present: string[]) => async (bucket: string, dir: string) =>
  present
    .filter((p) => p.startsWith(`${bucket}::`))
    .map((p) => p.slice(`${bucket}::`.length))
    .filter((p) => (dir ? p.startsWith(`${dir}/`) : !p.includes("/")))
    .map((p) => (dir ? p.slice(dir.length + 1) : p));

const run = (
  assets: AssetRef[],
  present: string[],
  receipts: UploadReceipt[],
  verified: Set<string>,
  images: ImageMeta[] = [],
  sources: SourceFileMeta[] = [],
) =>
  recheckCollisionsServerSide(
    assets,
    sources,
    noMeta,
    lister(present),
    images,
    receipts,
    { run_id: RUN, package_id: PKG },
    verified,
    { requireStorageExists: true },
  );

describe("new source excel server gate", () => {
  it("1) blocks new source object without server verify receipt", async () => {
    const r = await run(
      [srcAsset],
      [`${SRC_BUCKET}::${srcAsset.path}`],
      [receipt()],
      new Set(),
      [],
      [srcMeta],
    );
    expect(r.declared_new_paths).toEqual([]);
    expect(r.blockers.join()).toMatch(/SERVER_VERIFY_MISSING/);
  });

  it("2) blocks source receipt from another run/package", async () => {
    const r = await run(
      [srcAsset],
      [`${SRC_BUCKET}::${srcAsset.path}`],
      [receipt({ run_id: "other" })],
      new Set([verifiedKey(SRC_BUCKET, srcAsset.path, "aa11", 100)]),
      [],
      [srcMeta],
    );
    expect(r.blockers.join()).toMatch(/RECEIPT_FOREIGN_RUN|UPLOAD_RECEIPT_MISSING/);
    expect(r.declared_new_paths).toEqual([]);
  });

  it("3) blocks source with server hash/size mismatch", async () => {
    const r = await run(
      [srcAsset],
      [`${SRC_BUCKET}::${srcAsset.path}`],
      [receipt()],
      new Set([verifiedKey(SRC_BUCKET, srcAsset.path, "aa11", 999)]),
      [],
      [srcMeta],
    );
    expect(r.blockers.join()).toMatch(/SERVER_VERIFY_MISSING/);
  });

  it("4) passes source with valid server receipt", async () => {
    const r = await run(
      [srcAsset],
      [`${SRC_BUCKET}::${srcAsset.path}`],
      [receipt()],
      new Set([verifiedKey(SRC_BUCKET, srcAsset.path, "aa11", 100)]),
      [],
      [srcMeta],
    );
    expect(r.blockers).toEqual([]);
    expect(r.declared_new_paths).toEqual([srcAsset.path]);
  });

  it("5) recovers ambiguous upload error once server verifies the object", async () => {
    // upload 응답은 오류였지만 object 는 저장됨 → declared_new 영수증 + 서버 검증으로 통과
    const r = await run(
      [srcAsset],
      [`${SRC_BUCKET}::${srcAsset.path}`],
      [receipt({ state: "declared_new" })],
      new Set([verifiedKey(SRC_BUCKET, srcAsset.path, "aa11", 100)]),
      [],
      [srcMeta],
    );
    expect(r.blockers).toEqual([]);
    expect(r.declared_new_paths).toEqual([srcAsset.path]);
  });

  it("6) blocks when image or source object is deleted from storage", async () => {
    const rs = await run([srcAsset], [], [receipt()], new Set(), [], [srcMeta]);
    expect(rs.blockers.join()).toMatch(/STORAGE_MISSING/);
    const ri = await run(
      [imgAsset],
      [],
      [receipt({ bucket: IMG_BUCKET, path: imgAsset.path, sha256: "bb22" })],
      new Set(),
      [imgMeta],
      [],
    );
    expect(ri.blockers.join()).toMatch(/STORAGE_MISSING/);
  });

  it("7) mixed package identity holds", async () => {
    const r = await run(
      [srcAsset, imgAsset],
      [`${SRC_BUCKET}::${srcAsset.path}`, `${IMG_BUCKET}::${imgAsset.path}`],
      [receipt(), receipt({ bucket: IMG_BUCKET, path: imgAsset.path, sha256: "bb22" })],
      new Set([
        verifiedKey(SRC_BUCKET, srcAsset.path, "aa11", 100),
        verifiedKey(IMG_BUCKET, imgAsset.path, "bb22", 200),
      ]),
      [imgMeta],
      [srcMeta],
    );
    expect(r.blockers).toEqual([]);
    expect(r.skip_paths.length + r.declared_new_paths.length).toBe(2);
    expect(r.new_paths).toEqual([]);
  });
});
