// ABD OCS — 브라우저에서 교정본 Clean ZIP 을 재조립한다.
// 원본 ZIP 은 손대지 않는다. atomic.json 의 ABD Number 필드만 locator 로 찾아 치환하고
// corrections.json(교정 이력) · local_validation_receipt.json(영수증)을 추가한다.
import JSZip from "jszip";
import { sha256Hex } from "@/lib/abd/ocs-db-parser";
import { nextPackageFileName, type IncrementPackage } from "@/lib/abd/ocs-increment-package";
import {
  correctionsSha256,
  locatorKey,
  type CorrectionItem,
  type CorrectionsDoc,
} from "@/lib/abd/ocs-local-corrections";
import {
  LOCAL_RECEIPT_PATH,
  type LocalValidationReceipt,
} from "@/lib/abd/ocs-local-validation";

const ABD_LIST_KEYS = ["V3 ABD Numbers", "v3_abd_numbers"];
const ABD_ONE_KEYS = ["V3 ABD Number", "v3_abd_number"];
const ID_KEYS = ["Atomic Comment ID", "atomic_comment_id", "Comment ID", "comment_id"];
const FILE_KEYS = ["Source File Name", "source_file_name"];
const SHEET_KEYS = ["Source Sheet", "source_sheet", "source_sheet_name"];
const ROW_KEYS = ["Source Row", "source_row", "source_row_index"];
const ITEM_NO_KEYS = ["Atomic Item No", "atomic_item_no"];

const pick = (r: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null) return k;
  return null;
};
const val = (r: Record<string, unknown>, keys: string[]): unknown => {
  const k = pick(r, keys);
  return k ? r[k] : null;
};
const sv = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const nv = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
};

const asList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x ?? "").trim()).filter(Boolean)
    : String(v ?? "")
        .split(/[;,\n|]/)
        .map((x) => x.trim())
        .filter(Boolean);

export type CorrectedPackage = {
  file_name: string;
  blob: Blob;
  package_id: string;
  package_sha256: string;
  applied: number;
};

/**
 * 교정본 파일명 — 계약(OCS_Increment_<YYYYMMDD>_<seq>.zip)을 그대로 지키고 sequence 만 올린다.
 * 계보는 파일명이 아니라 manifest.supersedes_package_id 에 기록한다.
 */
export function correctedFileName(original: string, revision: number): string {
  return nextPackageFileName(original, Math.max(1, revision));
}

/** 원본 파일명(hash 포함) 기반 locator 키 — corrections 와 동일 산식 */
function rowLocatorKey(
  r: Record<string, unknown>,
  sourceFileHashByName: Map<string, string>,
): string {
  const name = sv(val(r, FILE_KEYS));
  return [
    sourceFileHashByName.get(name) ?? "",
    name,
    sv(val(r, SHEET_KEYS)),
    nv(val(r, ROW_KEYS)),
    sv(val(r, ID_KEYS)),
    nv(val(r, ITEM_NO_KEYS)),
  ].join("|");
}

export async function buildCorrectedPackage(args: {
  originalFile: File;
  pkg: IncrementPackage;
  corrections: CorrectionItem[];
  baselineId: string;
  revision?: number;
  receiptOf: (manifest: unknown, corrections: CorrectionsDoc) => Promise<LocalValidationReceipt>;
}): Promise<CorrectedPackage> {
  const { originalFile, pkg } = args;
  const zip = await JSZip.loadAsync(await originalFile.arrayBuffer());

  const atomicEntry = zip.file("atomic.json");
  if (!atomicEntry) throw new Error("원본 패키지에 atomic.json 이 없습니다.");
  const atomicRaw = JSON.parse(await atomicEntry.async("string")) as Record<string, unknown>;

  const nameToHash = new Map<string, string>();
  for (const f of pkg.sourceFiles) {
    nameToHash.set(f.relative_path.replace(/^source\//, ""), f.sha256);
  }
  const byLocator = new Map<string, CorrectionItem[]>();
  for (const it of args.corrections) {
    const k = locatorKey(it);
    byLocator.set(k, [...(byLocator.get(k) ?? []), it]);
  }

  const listKey = (["atomic_comments", "comments", "atomic_rows"] as const).find((k) =>
    Array.isArray(atomicRaw[k]),
  );
  if (!listKey) throw new Error("atomic.json 에서 코멘트 배열을 찾을 수 없습니다.");
  const rows = atomicRaw[listKey] as Record<string, unknown>[];

  let applied = 0;
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = rowLocatorKey(r, nameToHash);
    const items = byLocator.get(key);
    if (!items) continue;
    seen.add(key);
    const lk = pick(r, ABD_LIST_KEYS);
    const ok = pick(r, ABD_ONE_KEYS);
    let numbers = lk ? asList(r[lk]) : ok ? asList(r[ok]) : [];
    for (const it of items) {
      const idx = numbers.indexOf(it.before);
      if (idx < 0) {
        missing.push(`${it.sn ?? key} / ${it.before}`);
        continue;
      }
      numbers[idx] = it.after;
      applied += 1;
    }
    numbers = [...new Set(numbers)];
    if (lk) r[lk] = numbers;
    else if (ok) r[ok] = numbers.join("; ");
    else r["V3 ABD Numbers"] = numbers;
  }
  for (const [k] of byLocator) if (!seen.has(k)) missing.push(`대상 행 없음(locator): ${k}`);
  if (missing.length > 0) {
    throw new Error(`교정을 적용할 수 없는 항목이 있습니다: ${missing.slice(0, 5).join(" ; ")}`);
  }

  const atomicText = JSON.stringify(atomicRaw);
  const atomicSha = await sha256Hex(atomicText);
  zip.file("atomic.json", atomicText);

  const revision = args.revision ?? 1;
  const newPackageId = await sha256Hex(
    `${pkg.manifest.package_id}|corrected|${revision}|${atomicSha}`,
  );

  const corrections: CorrectionsDoc = {
    schema_version: "ocs-corrections/1",
    original_package_id: pkg.manifest.package_id,
    original_package_sha256: pkg.package_sha256,
    base_baseline_id: args.baselineId || pkg.manifest.base_baseline_id,
    generated_at: new Date().toISOString(),
    items: args.corrections,
  };
  const correctionsText = JSON.stringify(corrections);
  const correctionsSha = await correctionsSha256(corrections);
  zip.file("corrections.json", correctionsText);

  // manifest 갱신 — 원본 계보(supersedes)를 남기고 files 해시를 실제 값으로 맞춘다.
  const mfEntry = zip.file("manifest.json");
  if (!mfEntry) throw new Error("원본 패키지에 manifest.json 이 없습니다.");
  const mf = JSON.parse(await mfEntry.async("string")) as Record<string, unknown>;
  mf["package_id"] = newPackageId;
  mf["supersedes_package_id"] = pkg.manifest.package_id;
  mf["corrections_sha256"] = correctionsSha;
  mf["corrected_revision"] = revision;
  mf["generated_at"] = new Date().toISOString();
  const files = Array.isArray(mf["files"]) ? (mf["files"] as Record<string, unknown>[]) : [];
  const enc = new TextEncoder();
  const upsert = (relative_path: string, text: string, sha: string) => {
    const entry = files.find((f) => String(f["relative_path"]) === relative_path);
    const next = { relative_path, byte_size: enc.encode(text).byteLength, sha256: sha };
    if (entry) Object.assign(entry, next);
    else files.push(next);
  };
  upsert("atomic.json", atomicText, atomicSha);
  upsert("corrections.json", correctionsText, correctionsSha);
  mf["files"] = files;

  // 영수증은 digest 대상 manifest(영수증 entry 제외) 기준으로 계산한다 → digest 순환 없음.
  const receipt = await args.receiptOf(mf, corrections);
  const receiptText = JSON.stringify(receipt);
  const receiptSha = await sha256Hex(receiptText);
  zip.file(LOCAL_RECEIPT_PATH, receiptText);
  upsert(LOCAL_RECEIPT_PATH, receiptText, receiptSha);
  mf["files"] = files;
  zip.file("manifest.json", JSON.stringify(mf));

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const package_sha256 = await sha256Hex(await blob.arrayBuffer());
  return {
    file_name: correctedFileName(originalFile.name, revision),
    blob,
    package_id: newPackageId,
    package_sha256,
    applied,
  };
}
