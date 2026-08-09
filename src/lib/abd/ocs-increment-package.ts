// ABD OCS 정규 증분 Import — 단일 ZIP 패키지 판독기.
// 이 모듈은 archive reader + 계약 검증만 수행한다. OCS 의미 파서가 아니다.
import JSZip from "jszip";
import { sha256Hex } from "@/lib/abd/ocs-db-parser";
import { BASELINE_CORE_TABLES } from "@/lib/abd/ocs-baseline-shared";
import {
  parseV3Atomic,
  parseV3Policy,
  parseV3ResponseMapping,
  type V3AtomicParse,
  type V3PolicyParse,
  type V3ResponseParse,
  type V3StageAttachment,
} from "@/lib/abd/ocs-v3-parser";

export const INCREMENT_SCHEMA_VERSION = "ocs-increment/1";
export const PACKAGE_NAME_RE = /^OCS_Increment_(\d{8})_(\d+)\.zip$/;

export type ManifestFileEntry = {
  relative_path: string;
  byte_size: number;
  sha256: string;
};

export type IncrementManifest = {
  schema_version: string;
  package_id: string;
  data_date: string;
  base_baseline_id: string;
  base_import_run_id: string;
  base_core_hash: string;
  base_core_table_hashes: Record<string, string>;
  base_generated_at: string;
  target_ocs_numbers: string[];
  change_type: "new" | "revision" | "mixed" | string;
  files: ManifestFileEntry[];
  generated_at: string;
  tool_version: string;
};

export type PackageBinary = {
  relative_path: string;
  bytes: ArrayBuffer;
  sha256: string;
  byte_size: number;
};

/** 신규 이미지 등록 계약 — 앱은 값을 생성하지 않고 패키지 선언값을 그대로 전달한다. */
export type PackageImageMeta = {
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
 * ZIP bomb 방어 상한 — 운영 실측(2026-08-09) 기준으로 산정한다.
 * 실측: OCS 이미지 2,310개 / 최대 1.07MB / 합계 181MB, 원본 Excel 298개 / 최대 10.5MB.
 * 상한은 전량(2,608 object) 대비 약 3배, 최대 단일 파일 대비 약 6배 여유를 둔다.
 */
export const ZIP_LIMITS = {
  maxEntries: 8000,
  maxSingleFileBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
} as const;

export type IncrementPackage = {
  file_name: string;
  file_size: number;
  package_sha256: string;
  manifest: IncrementManifest;
  atomic: V3AtomicParse;
  response: V3ResponseParse;
  policy: V3PolicyParse;
  sourceFiles: PackageBinary[];
  images: PackageBinary[];
  imageMeta: PackageImageMeta[];
  verifiedFiles: number;
  blockers: string[];
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const REQUIRED_ENTRIES = ["manifest.json", "atomic.json", "response_mapping.json", "policy.json"];
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** ZIP entry 경로 안전성 검사 — 위반 사유 배열(빈 배열이면 안전). */
export function zipPathViolations(path: string): string[] {
  const out: string[] = [];
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) out.push(`절대경로: ${path}`);
  if (path.includes("\\")) out.push(`역슬래시 포함 경로: ${path}`);
  if (CONTROL_CHARS.test(path)) out.push(`제어문자 포함 경로: ${JSON.stringify(path)}`);
  const segs = path.split("/");
  if (segs.some((x) => x === "..")) out.push(`상위 경로 탈출(..): ${path}`);
  if (segs.some((x) => x === "")) out.push(`빈 경로 segment: ${path}`);
  if (segs.some((x) => x === ".")) out.push(`상대 경로 segment(.): ${path}`);
  return out;
}

function parseManifest(json: unknown): IncrementManifest {
  const o = (json ?? {}) as Record<string, unknown>;
  const files = Array.isArray(o["files"]) ? (o["files"] as Record<string, unknown>[]) : [];
  return {
    schema_version: str(o["schema_version"]),
    package_id: str(o["package_id"]),
    data_date: str(o["data_date"]),
    base_baseline_id: str(o["base_baseline_id"]),
    base_import_run_id: str(o["base_import_run_id"]),
    base_core_hash: str(o["base_core_hash"]).toLowerCase(),
    base_core_table_hashes:
      o["base_core_table_hashes"] && typeof o["base_core_table_hashes"] === "object"
        ? (o["base_core_table_hashes"] as Record<string, string>)
        : {},
    base_generated_at: str(o["base_generated_at"]),
    target_ocs_numbers: Array.isArray(o["target_ocs_numbers"])
      ? (o["target_ocs_numbers"] as unknown[]).map(str).filter(Boolean)
      : [],
    change_type: str(o["change_type"]),
    files: files.map((f) => ({
      relative_path: str(f["relative_path"]),
      byte_size: Number(f["byte_size"] ?? 0),
      sha256: str(f["sha256"]).toLowerCase(),
    })),
    generated_at: str(o["generated_at"]),
    tool_version: str(o["tool_version"]),
  };
}

async function hashBytes(buf: ArrayBuffer): Promise<string> {
  return sha256Hex(buf);
}

/**
 * base_core_table_hashes 계약 — Baseline Core 8개 테이블이 정확히 모두 있어야 하고
 * 값은 공백이 아니어야 한다. 누락·추가·공백은 blocker(= null 로 우회 불가).
 */
export function coreTableHashBlockers(hashes: Record<string, string>): string[] {
  const out: string[] = [];
  const keys = Object.keys(hashes ?? {});
  if (keys.length === 0) {
    out.push("manifest.base_core_table_hashes 가 없습니다.");
    return out;
  }
  const missing = BASELINE_CORE_TABLES.filter((t) => !keys.includes(t));
  const extra = keys.filter((k) => !(BASELINE_CORE_TABLES as readonly string[]).includes(k));
  const blank = BASELINE_CORE_TABLES.filter(
    (t) => keys.includes(t) && !String(hashes[t] ?? "").trim(),
  );
  if (missing.length) out.push(`base_core_table_hashes 누락: ${missing.join(", ")}`);
  if (extra.length) out.push(`base_core_table_hashes 에 정본 외 항목: ${extra.join(", ")}`);
  if (blank.length) out.push(`base_core_table_hashes 공백 값: ${blank.join(", ")}`);
  return out;
}

/**
 * 패키지 이미지 바이너리 ↔ atomic.json attachment metadata 대응 검증.
 * 앱은 값을 만들지 않는다. 선언이 없거나 필수값이 비면 blocker 다.
 */
export function buildImageMeta(
  attachments: V3StageAttachment[],
  images: PackageBinary[],
): { imageMeta: PackageImageMeta[]; blockers: string[] } {
  const blockers: string[] = [];
  const byPath = new Map<string, V3StageAttachment>();
  for (const a of attachments) if (a.storage_path) byPath.set(a.storage_path, a);

  const imageMeta: PackageImageMeta[] = [];
  for (const bin of images) {
    const path = bin.relative_path.replace(/^images\//, "");
    const a = byPath.get(path);
    if (!a) {
      blockers.push(`패키지 이미지에 대응하는 attachment metadata 가 없습니다: ${path}`);
      continue;
    }
    const missing: string[] = [];
    if (!a.content_hash) missing.push("content_hash");
    if (a.byte_size === null) missing.push("byte_size");
    if (a.width === null) missing.push("width");
    if (a.height === null) missing.push("height");
    if (!a.image_format) missing.push("image_format");
    if (!a.mime_type) missing.push("mime_type");
    if (a.source_image_index === null) missing.push("source_image_index");
    if (!a.attachment_scope) missing.push("attachment_scope");
    if (missing.length > 0) {
      blockers.push(`신규 attachment metadata 누락 (${path}): ${missing.join(", ")}`);
      continue;
    }
    if (a.content_hash !== bin.sha256.toLowerCase()) {
      blockers.push(`attachment content_hash 가 이미지 SHA-256 과 다릅니다: ${path}`);
      continue;
    }
    if (a.byte_size !== bin.byte_size) {
      blockers.push(`attachment byte_size 가 이미지 실제 크기와 다릅니다: ${path}`);
      continue;
    }
    imageMeta.push({
      source_attachment_id: a.source_attachment_id,
      storage_path: path,
      content_hash: a.content_hash,
      byte_size: a.byte_size,
      width: a.width,
      height: a.height,
      image_format: a.image_format,
      mime_type: a.mime_type,
      source_image_index: a.source_image_index,
      source_parent_comment_id: a.source_parent_comment_id,
      atomic_comment_id: a.atomic_comment_id,
      attachment_scope: a.attachment_scope as string,
    });
  }
  return { imageMeta, blockers };
}

/** ZIP 1개를 열고 매니페스트 계약·SHA-256 을 전부 검증한다. 운영 DB 는 건드리지 않는다. */
export async function readIncrementPackage(file: File): Promise<IncrementPackage> {
  const blockers: string[] = [];
  if (!PACKAGE_NAME_RE.test(file.name)) {
    blockers.push(`파일명이 계약과 다릅니다: ${file.name} (OCS_Increment_<YYYYMMDD>_<seq>.zip)`);
  }
  const raw = await file.arrayBuffer();
  const packageSha = await hashBytes(raw);
  const sig = new Uint8Array(raw.slice(0, 4));
  if (!(sig[0] === 0x50 && sig[1] === 0x4b)) {
    throw new Error("ZIP 파일이 아닙니다 (ZIP signature 불일치).");
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(raw);
  } catch (e) {
    throw new Error(`ZIP 을 열 수 없습니다: ${(e as Error).message}`);
  }

  // ZIP 구조 보안 검사 (path traversal · 제어문자 · 대소문자 충돌 · 규모 상한)
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > ZIP_LIMITS.maxEntries) {
    blockers.push(`ZIP entry 수 상한 초과: ${entries.length} > ${ZIP_LIMITS.maxEntries}`);
  }
  const lowerSeen = new Map<string, string>();
  for (const e of entries) {
    blockers.push(...zipPathViolations(e.name));
    const prev = lowerSeen.get(e.name.toLowerCase());
    if (prev && prev !== e.name) blockers.push(`대소문자만 다른 충돌 경로: ${prev} / ${e.name}`);
    lowerSeen.set(e.name.toLowerCase(), e.name);
  }
  if (blockers.some((b) => b.includes("경로"))) {
    return {
      file_name: file.name,
      file_size: file.size,
      package_sha256: packageSha,
      manifest: parseManifest({}),
      atomic: parseV3Atomic({ comments: [] }),
      response: parseV3ResponseMapping({}),
      policy: parseV3Policy({}),
      sourceFiles: [],
      images: [],
      imageMeta: [],
      verifiedFiles: 0,
      blockers,
    };
  }

  for (const name of REQUIRED_ENTRIES) {
    if (!zip.file(name)) blockers.push(`패키지에 ${name} 이 없습니다.`);
  }
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    return {
      file_name: file.name,
      file_size: file.size,
      package_sha256: packageSha,
      manifest: parseManifest({}),
      atomic: parseV3Atomic({ comments: [] }),
      response: parseV3ResponseMapping({}),
      policy: parseV3Policy({}),
      sourceFiles: [],
      images: [],
      imageMeta: [],
      verifiedFiles: 0,
      blockers,
    };
  }

  let manifestJson: unknown = {};
  try {
    manifestJson = JSON.parse(await manifestFile.async("string"));
  } catch (e) {
    throw new Error(`manifest.json 파싱 실패: ${(e as Error).message}`);
  }
  const manifest = parseManifest(manifestJson);

  // manifest 경로 계약 — 중복/대소문자 충돌/보안 위반
  const manifestSeen = new Map<string, string>();
  for (const f of manifest.files) {
    blockers.push(...zipPathViolations(f.relative_path));
    const key = f.relative_path.toLowerCase();
    if (manifestSeen.has(key)) {
      blockers.push(`manifest 중복 relative_path: ${f.relative_path}`);
    }
    manifestSeen.set(key, f.relative_path);
  }
  // manifest 에 없는 source/ · images/ 파일 금지
  for (const e of entries) {
    if (
      (e.name.startsWith("source/") || e.name.startsWith("images/")) &&
      !manifestSeen.has(e.name.toLowerCase())
    ) {
      blockers.push(`manifest 에 없는 패키지 파일: ${e.name}`);
    }
  }
  if (manifest.schema_version !== INCREMENT_SCHEMA_VERSION) {
    blockers.push(
      `schema_version 불일치: ${manifest.schema_version || "(없음)"} ≠ ${INCREMENT_SCHEMA_VERSION}`,
    );
  }
  if (!manifest.data_date) blockers.push("manifest.data_date 가 없습니다.");
  if (!manifest.base_baseline_id) blockers.push("manifest.base_baseline_id 가 없습니다.");
  if (!manifest.base_import_run_id) blockers.push("manifest.base_import_run_id 가 없습니다.");
  if (!manifest.base_core_hash) blockers.push("manifest.base_core_hash 가 없습니다.");
  if (!manifest.base_generated_at) blockers.push("manifest.base_generated_at 가 없습니다.");
  blockers.push(...coreTableHashBlockers(manifest.base_core_table_hashes));
  if (!manifest.package_id) blockers.push("manifest.package_id 가 없습니다.");
  if (manifest.target_ocs_numbers.length === 0)
    blockers.push("대상 OCS 번호 배열이 비어 있습니다.");
  if (manifest.files.length === 0) blockers.push("manifest.files 목록이 비어 있습니다.");

  // 내부 파일 SHA-256 · byte size 전수 검증
  const bins = new Map<string, PackageBinary>();
  let verified = 0;
  let totalUncompressed = 0;
  for (const entry of manifest.files) {
    const zf = zip.file(entry.relative_path);
    if (!zf) {
      blockers.push(`매니페스트 경로가 패키지에 없습니다: ${entry.relative_path}`);
      continue;
    }
    if (entry.byte_size > ZIP_LIMITS.maxSingleFileBytes) {
      blockers.push(
        `단일 파일 크기 상한 초과: ${entry.relative_path} (${entry.byte_size} > ${ZIP_LIMITS.maxSingleFileBytes})`,
      );
      continue;
    }
    totalUncompressed += entry.byte_size;
    if (totalUncompressed > ZIP_LIMITS.maxTotalUncompressedBytes) {
      blockers.push(
        `총 압축해제 크기 상한 초과: > ${ZIP_LIMITS.maxTotalUncompressedBytes} bytes (ZIP bomb 방어)`,
      );
      break;
    }
    const bytes = await zf.async("arraybuffer");
    const sha = await hashBytes(bytes);
    if (entry.sha256 && sha !== entry.sha256) {
      blockers.push(`SHA-256 불일치: ${entry.relative_path}`);
      continue;
    }
    if (entry.byte_size && entry.byte_size !== bytes.byteLength) {
      blockers.push(
        `byte size 불일치: ${entry.relative_path} (${bytes.byteLength} ≠ ${entry.byte_size})`,
      );
      continue;
    }
    verified += 1;
    bins.set(entry.relative_path, {
      relative_path: entry.relative_path,
      bytes,
      sha256: sha,
      byte_size: bytes.byteLength,
    });
  }

  const jsonOf = async (name: string): Promise<unknown> => {
    const zf = zip.file(name);
    if (!zf) return {};
    try {
      return JSON.parse(await zf.async("string"));
    } catch (e) {
      blockers.push(`${name} 파싱 실패: ${(e as Error).message}`);
      return {};
    }
  };

  const atomic = parseV3Atomic(await jsonOf("atomic.json"));
  const response = parseV3ResponseMapping(await jsonOf("response_mapping.json"));
  const policy = parseV3Policy(await jsonOf("policy.json"));

  if (atomic.comments.length === 0) blockers.push("atomic.json 에 코멘트 행이 없습니다.");
  if (atomic.duplicated_atomic_ids.length > 0) {
    blockers.push(`중복 source_comment_id ${atomic.duplicated_atomic_ids.length}건`);
  }
  if (atomic.invalid_rows.length > 0)
    blockers.push(`atomic.json 형식 오류 ${atomic.invalid_rows.length}건`);
  if (!policy.policy_version) blockers.push("policy.json 의 policy_version 이 없습니다.");

  const sourceFiles = [...bins.values()].filter((b) => b.relative_path.startsWith("source/"));
  const images = [...bins.values()].filter((b) => b.relative_path.startsWith("images/"));

  if (atomic.attachment_invalid_rows.length > 0) {
    blockers.push(
      `attachment 계약 오류 ${atomic.attachment_invalid_rows.length}건: ${atomic.attachment_invalid_rows
        .slice(0, 3)
        .map((r) => r.reason)
        .join(" / ")}`,
    );
  }
  if (atomic.duplicated_attachment_ids.length > 0)
    blockers.push(`중복 source_attachment_id ${atomic.duplicated_attachment_ids.length}건`);
  if (atomic.duplicated_attachment_paths.length > 0)
    blockers.push(`중복 attachment storage_path ${atomic.duplicated_attachment_paths.length}건`);

  const { imageMeta, blockers: imgBlockers } = buildImageMeta(atomic.attachments, images);
  blockers.push(...imgBlockers);

  return {
    file_name: file.name,
    file_size: file.size,
    package_sha256: packageSha,
    manifest,
    atomic,
    response,
    policy,
    sourceFiles,
    images,
    imageMeta,
    verifiedFiles: verified,
    blockers,
  };
}
