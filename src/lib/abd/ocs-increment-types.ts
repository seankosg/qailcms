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

/** 패키지가 선언한 신규 이미지 metadata (앱은 값을 생성하지 않는다) */
export type ImageMeta = {
  source_attachment_id: string;
  storage_path: string;
  content_hash: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  image_format: string | null;
  mime_type: string | null;
  source_image_index: number | null;
  source_parent_comment_id: string | null;
  atomic_comment_id: string | null;
  attachment_scope: string;
};

/**
 * 이번 run 의 업로드 영수증 — 실패해도 보존한다. 자동 DELETE 는 하지 않는다.
 * uploaded: upsert:false 업로드 성공 응답만.
 * existing: 기존 DB metadata 와 ID/path/hash 가 모두 일치하는 object 만.
 * declared_new: Storage object 는 있으나 DB metadata 가 없는 경우(서버 실측 검증 대상).
 */
export type UploadReceipt = {
  run_id: string;
  package_id: string;
  bucket: string;
  path: string;
  sha256: string;
  state: "uploaded" | "existing" | "declared_new" | "failed";
  error?: string;
};
