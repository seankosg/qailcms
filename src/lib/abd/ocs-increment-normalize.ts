// ABD OCS 증분 Import — 입력 정규화 (서버 함수 모듈을 얇게 유지하기 위한 분리).
import type { AssetRef, SourceFileMeta, SourceFileRef } from "@/lib/abd/ocs-increment-types";

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
