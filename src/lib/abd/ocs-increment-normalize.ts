// ABD OCS 증분 Import — 입력 정규화 (서버 함수 모듈을 얇게 유지하기 위한 분리).
import type {
  AssetRef,
  ImageMeta,
  SourceFileMeta,
  SourceFileRef,
  UploadReceipt,
} from "@/lib/abd/ocs-increment-types";

export const sourceFileList = (v: unknown): SourceFileRef[] =>
  Array.isArray(v)
    ? v.map((x) => ({
        file_name: String((x as SourceFileRef)?.file_name ?? ""),
        content_hash: String((x as SourceFileRef)?.content_hash ?? ""),
      }))
    : [];

export const sourceMetaList = (v: unknown): SourceFileMeta[] =>
  Array.isArray(v)
    ? v.map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const meta: SourceFileMeta = {
          source_file_id: String(o["source_file_id"] ?? ""),
          file_name: String(o["file_name"] ?? ""),
          relative_path: String(o["relative_path"] ?? ""),
          storage_path: String(o["storage_path"] ?? ""),
          content_hash: String(o["content_hash"] ?? "").toLowerCase(),
          byte_size: Number(o["byte_size"] ?? 0),
          mime_type: String(o["mime_type"] ?? ""),
        };
        for (const [k, val] of Object.entries(meta)) {
          const empty = k === "byte_size" ? !(val as number) : !String(val);
          if (empty) throw new Error(`source metadata 필드 누락: ${k}`);
        }
        return meta;
      })
    : [];

export const assetList = (v: unknown): AssetRef[] =>
  Array.isArray(v)
    ? v.map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return {
          kind: o["kind"] === "source" ? "source" : "image",
          bucket: String(o["bucket"] ?? ""),
          path: String(o["path"] ?? ""),
          sha256: String(o["sha256"] ?? "").toLowerCase(),
        } as AssetRef;
      })
    : [];

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
    ? null
    : Math.trunc(Number(v));

export const imageMetaList = (v: unknown): ImageMeta[] =>
  Array.isArray(v)
    ? v.map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const meta: ImageMeta = {
          source_attachment_id: String(o["source_attachment_id"] ?? ""),
          storage_path: String(o["storage_path"] ?? ""),
          content_hash: String(o["content_hash"] ?? "").toLowerCase(),
          byte_size: Number(o["byte_size"] ?? 0),
          width: numOrNull(o["width"]),
          height: numOrNull(o["height"]),
          image_format: o["image_format"] ? String(o["image_format"]) : null,
          mime_type: o["mime_type"] ? String(o["mime_type"]) : null,
          source_image_index: numOrNull(o["source_image_index"]),
          source_parent_comment_id: o["source_parent_comment_id"]
            ? String(o["source_parent_comment_id"])
            : null,
          atomic_comment_id: o["atomic_comment_id"] ? String(o["atomic_comment_id"]) : null,
          attachment_scope: String(o["attachment_scope"] ?? ""),
        };
        for (const k of [
          "source_attachment_id",
          "storage_path",
          "content_hash",
          "attachment_scope",
        ] as const) {
          if (!meta[k]) throw new Error(`image metadata 필드 누락: ${k}`);
        }
        if (!meta.byte_size) throw new Error("image metadata 필드 누락: byte_size");
        return meta;
      })
    : [];

export const receiptList = (v: unknown): UploadReceipt[] =>
  Array.isArray(v)
    ? v.map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return {
          run_id: String(o["run_id"] ?? ""),
          package_id: String(o["package_id"] ?? ""),
          bucket: String(o["bucket"] ?? ""),
          path: String(o["path"] ?? ""),
          sha256: String(o["sha256"] ?? "").toLowerCase(),
          state:
            o["state"] === "uploaded" || o["state"] === "existing" || o["state"] === "failed"
              ? (o["state"] as UploadReceipt["state"])
              : "failed",
        } as UploadReceipt;
      })
    : [];
