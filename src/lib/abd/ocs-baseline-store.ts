// ABD OCS Baseline — 저장·재사용 판정 순수 헬퍼 (Storage/DB 접근 없음, 테스트 대상).
// 계약(schema v1 · files 10종 · validation_files sidecar)은 여기서 바꾸지 않는다.
import { BASELINE_ABD_INDEX_PATH, sha256Hex } from "@/lib/abd/ocs-baseline-shared";

export type AbdIndexRowLike = {
  abd_item_id: string;
  abd_number: string;
  normalized_abd_number: string;
  is_active: boolean;
};

/**
 * ABD 인덱스 내용 지문 — generated_at 은 제외하고 실제 rows 만으로 계산한다.
 * 같은 core hash·import run 이어도 abd_items_raw 가 바뀌면 지문이 달라진다.
 */
export async function abdIndexDigest(rows: AbdIndexRowLike[]): Promise<string> {
  const canon = rows.map((r) => [
    r.abd_item_id,
    r.abd_number,
    r.normalized_abd_number,
    r.is_active ? 1 : 0,
  ]);
  return sha256Hex(JSON.stringify({ row_count: rows.length, rows: canon }));
}

/** sidecar 포인터가 가리키는 ZIP 만 최신으로 인정한다 (폴더 첫 ZIP fallback 금지). */
export function pickZipByPointer<T extends { name: string }>(
  entries: T[],
  pointerName: string | null | undefined,
): T | null {
  if (!pointerName) return null;
  return entries.find((e) => e.name === pointerName && e.name.endsWith(".zip")) ?? null;
}

type ManifestLike = Record<string, unknown> | null | undefined;

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** ZIP 내부 manifest 와 외부 sidecar 대조 — 불일치 사유 목록을 반환한다. */
export function crossCheckManifests(inner: ManifestLike, outer: ManifestLike): string[] {
  const out: string[] = [];
  if (!inner) return ["ZIP 내부 manifest.json 을 읽지 못했습니다."];
  if (!outer) return ["외부 manifest sidecar 를 읽지 못했습니다."];
  for (const key of ["schema_version", "baseline_id", "base_core_hash", "base_import_run_id"]) {
    if (s(inner[key]) !== s(outer[key])) {
      out.push(`${key} 불일치: ZIP ${s(inner[key]) || "(없음)"} ≠ sidecar ${s(outer[key]) || "(없음)"}`);
    }
  }
  const innerFiles = Array.isArray(inner["files"]) ? (inner["files"] as Record<string, unknown>[]) : [];
  const outerFiles = Array.isArray(outer["files"]) ? (outer["files"] as Record<string, unknown>[]) : [];
  if (innerFiles.length !== 10) out.push(`ZIP manifest.files 가 10종이 아닙니다 (${innerFiles.length}).`);
  if (innerFiles.length !== outerFiles.length) out.push("files 수가 sidecar 와 다릅니다.");
  else {
    for (const f of innerFiles) {
      const m = outerFiles.find((o) => s(o["relative_path"]) === s(f["relative_path"]));
      if (!m) {
        out.push(`sidecar 에 없는 파일: ${s(f["relative_path"])}`);
        continue;
      }
      if (s(m["sha256"]).toLowerCase() !== s(f["sha256"]).toLowerCase() ||
        Number(m["byte_size"]) !== Number(f["byte_size"]) ||
        Number(m["row_count"]) !== Number(f["row_count"])) {
        out.push(`파일 선언 불일치: ${s(f["relative_path"])}`);
      }
    }
  }
  const iv = (Array.isArray(inner["validation_files"]) ? inner["validation_files"] : []) as Record<string, unknown>[];
  const ov = (Array.isArray(outer["validation_files"]) ? outer["validation_files"] : []) as Record<string, unknown>[];
  const ii = iv.find((f) => s(f["relative_path"]) === BASELINE_ABD_INDEX_PATH);
  const oi = ov.find((f) => s(f["relative_path"]) === BASELINE_ABD_INDEX_PATH);
  if (!ii || !oi) {
    out.push("validation_files 의 ABD 인덱스 선언이 없습니다.");
  } else if (
    s(ii["sha256"]).toLowerCase() !== s(oi["sha256"]).toLowerCase() ||
    Number(ii["byte_size"]) !== Number(oi["byte_size"]) ||
    Number(ii["row_count"]) !== Number(oi["row_count"])
  ) {
    out.push("ABD 인덱스 선언(sha256/byte_size/row_count)이 sidecar 와 다릅니다.");
  }
  return out;
}

/** upload 오류는 already exists 를 포함해 어떤 경우도 성공으로 넘기지 않는다. */
export function assertUploadSucceeded(err: { message: string } | null, path: string): void {
  if (!err) return;
  throw new Error(`BASELINE_UPLOAD_FAILED: ${path} — ${err.message}`);
}
