// ABD OCS 증분 Import — 서버/클라이언트 공용 타입.
export type SourceFileRef = { file_name: string; content_hash: string };

/** 패키지가 전달하는 원본 Excel 메타데이터 전체 (등록은 서버 트랜잭션 안에서만) */
export type SourceFileMeta = {
  source_file_id: string;
  file_name: string;
  relative_path: string;
  storage_path: string;
  content_hash: string;
  byte_size: number;
  mime_type: string;
};

/** Import 직전 서버 재검증 대상 Storage 자산 */
export type AssetRef = {
  kind: "image" | "source";
  bucket: string;
  path: string;
  sha256: string;
};
