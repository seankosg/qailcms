// ABD OCS 정규 증분 Import — 단일 ZIP 패키지 판독기.
// 이 모듈은 archive reader + 계약 검증만 수행한다. OCS 의미 파서가 아니다.
import JSZip from "jszip";
import { sha256Hex } from "@/lib/abd/ocs-db-parser";
import {
  parseV3Atomic,
  parseV3Policy,
  parseV3ResponseMapping,
  type V3AtomicParse,
  type V3PolicyParse,
  type V3ResponseParse,
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

export type IncrementPackage = {
  file_name: string;
  package_sha256: string;
  manifest: IncrementManifest;
  atomic: V3AtomicParse;
  response: V3ResponseParse;
  policy: V3PolicyParse;
  sourceFiles: PackageBinary[];
  images: PackageBinary[];
  verifiedFiles: number;
  blockers: string[];
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const REQUIRED_ENTRIES = ["manifest.json", "atomic.json", "response_mapping.json", "policy.json"];

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

/** ZIP 1개를 열고 매니페스트 계약·SHA-256 을 전부 검증한다. 운영 DB 는 건드리지 않는다. */
export async function readIncrementPackage(file: File): Promise<IncrementPackage> {
  const blockers: string[] = [];
  if (!PACKAGE_NAME_RE.test(file.name)) {
    blockers.push(`파일명이 계약과 다릅니다: ${file.name} (OCS_Increment_<YYYYMMDD>_<seq>.zip)`);
  }
  const raw = await file.arrayBuffer();
  const packageSha = await hashBytes(raw);
  const zip = await JSZip.loadAsync(raw);

  for (const name of REQUIRED_ENTRIES) {
    if (!zip.file(name)) blockers.push(`패키지에 ${name} 이 없습니다.`);
  }
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    return {
      file_name: file.name,
      package_sha256: packageSha,
      manifest: parseManifest({}),
      atomic: parseV3Atomic({ comments: [] }),
      response: parseV3ResponseMapping({}),
      policy: parseV3Policy({}),
      sourceFiles: [],
      images: [],
      verifiedFiles: 0,
      blockers,
    };
  }

  const manifest = parseManifest(JSON.parse(await manifestFile.async("string")));
  if (manifest.schema_version !== INCREMENT_SCHEMA_VERSION) {
    blockers.push(`schema_version 불일치: ${manifest.schema_version || "(없음)"} ≠ ${INCREMENT_SCHEMA_VERSION}`);
  }
  if (!manifest.data_date) blockers.push("manifest.data_date 가 없습니다.");
  if (!manifest.base_baseline_id) blockers.push("manifest.base_baseline_id 가 없습니다.");
  if (!manifest.base_import_run_id) blockers.push("manifest.base_import_run_id 가 없습니다.");
  if (!manifest.package_id) blockers.push("manifest.package_id 가 없습니다.");
  if (manifest.target_ocs_numbers.length === 0) blockers.push("대상 OCS 번호 배열이 비어 있습니다.");
  if (manifest.files.length === 0) blockers.push("manifest.files 목록이 비어 있습니다.");

  // 내부 파일 SHA-256 · byte size 전수 검증
  const bins = new Map<string, PackageBinary>();
  let verified = 0;
  for (const entry of manifest.files) {
    const zf = zip.file(entry.relative_path);
    if (!zf) {
      blockers.push(`매니페스트 경로가 패키지에 없습니다: ${entry.relative_path}`);
      continue;
    }
    const bytes = await zf.async("arraybuffer");
    const sha = await hashBytes(bytes);
    if (entry.sha256 && sha !== entry.sha256) {
      blockers.push(`SHA-256 불일치: ${entry.relative_path}`);
      continue;
    }
    if (entry.byte_size && entry.byte_size !== bytes.byteLength) {
      blockers.push(`byte size 불일치: ${entry.relative_path} (${bytes.byteLength} ≠ ${entry.byte_size})`);
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
  if (atomic.invalid_rows.length > 0) blockers.push(`atomic.json 형식 오류 ${atomic.invalid_rows.length}건`);
  if (!policy.policy_version) blockers.push("policy.json 의 policy_version 이 없습니다.");

  const sourceFiles = [...bins.values()].filter((b) => b.relative_path.startsWith("source/"));
  const images = [...bins.values()].filter((b) => b.relative_path.startsWith("images/"));

  return {
    file_name: file.name,
    package_sha256: packageSha,
    manifest,
    atomic,
    response,
    policy,
    sourceFiles,
    images,
    verifiedFiles: verified,
    blockers,
  };
}
