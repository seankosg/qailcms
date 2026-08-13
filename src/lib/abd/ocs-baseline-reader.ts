// ABD OCS Baseline ZIP — 브라우저 판독기 (읽기 전용, 서버 호출 없음).
// 로컬 검증에 필요한 최소 정보(계약 hash + ABD 번호 인덱스)만 뽑는다.
import JSZip from "jszip";
import {
  ABD_ITEMS_INDEX_SCHEMA,
  BASELINE_ABD_INDEX_PATH,
  BASELINE_SCHEMA_VERSIONS_READABLE,
} from "@/lib/abd/ocs-baseline-shared";
import { normalizeAbdNumber } from "@/lib/abd/ocs-number-normalize";

export type AbdIndexRow = {
  abd_item_id: string;
  abd_number: string;
  normalized_abd_number: string;
  is_active: boolean;
};

export type BaselineRead = {
  file_name: string;
  schema_version: string;
  baseline_id: string;
  base_import_run_id: string;
  core_hash: string;
  core_table_hashes: Record<string, string>;
  generated_at: string | null;
  /** v2 만 존재. v1 Baseline 은 null → ABD 번호 존재 검증을 로컬에서 할 수 없다. */
  abdIndex: AbdIndexRow[] | null;
  /** normalized key → canonical rows (active 만) */
  byNormalized: Map<string, AbdIndexRow[]>;
  /** 정확한 abd_number → row */
  byExact: Map<string, AbdIndexRow>;
  blockers: string[];
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function readBaselineZip(file: File): Promise<BaselineRead> {
  const blockers: string[] = [];
  const raw = await file.arrayBuffer();
  const sig = new Uint8Array(raw.slice(0, 2));
  if (!(sig[0] === 0x50 && sig[1] === 0x4b)) {
    throw new Error("Baseline ZIP 이 아닙니다 (ZIP signature 불일치).");
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(raw);
  } catch (e) {
    throw new Error(`Baseline ZIP 을 열 수 없습니다: ${(e as Error).message}`);
  }
  const mf = zip.file("manifest.json");
  if (!mf) throw new Error("Baseline ZIP 에 manifest.json 이 없습니다.");
  let m: Record<string, unknown> = {};
  try {
    m = JSON.parse(await mf.async("string")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Baseline manifest.json 파싱 실패: ${(e as Error).message}`);
  }

  const schema = str(m["schema_version"]);
  if (!(BASELINE_SCHEMA_VERSIONS_READABLE as readonly string[]).includes(schema)) {
    blockers.push(
      `Baseline schema_version 을 읽을 수 없습니다: ${schema || "(없음)"} (${BASELINE_SCHEMA_VERSIONS_READABLE.join(" / ")})`,
    );
  }

  let abdIndex: AbdIndexRow[] | null = null;
  const idxFile = zip.file(BASELINE_ABD_INDEX_PATH);
  if (idxFile) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(await idxFile.async("string")) as Record<string, unknown>;
    } catch (e) {
      blockers.push(`${BASELINE_ABD_INDEX_PATH} 파싱 실패: ${(e as Error).message}`);
    }
    if (str(parsed["schema_version"]) && str(parsed["schema_version"]) !== ABD_ITEMS_INDEX_SCHEMA) {
      blockers.push(
        `ABD 인덱스 schema_version 불일치: ${str(parsed["schema_version"])} ≠ ${ABD_ITEMS_INDEX_SCHEMA}`,
      );
    }
    const rows = Array.isArray(parsed["rows"]) ? (parsed["rows"] as Record<string, unknown>[]) : [];
    abdIndex = rows.map((r) => {
      const num = str(r["abd_number"]);
      return {
        abd_item_id: str(r["abd_item_id"]),
        abd_number: num,
        normalized_abd_number: str(r["normalized_abd_number"]) || normalizeAbdNumber(num),
        is_active: r["is_active"] !== false,
      };
    });
  }

  const byNormalized = new Map<string, AbdIndexRow[]>();
  const byExact = new Map<string, AbdIndexRow>();
  for (const r of abdIndex ?? []) {
    if (!r.abd_number) continue;
    byExact.set(r.abd_number, r);
    if (!r.is_active) continue;
    const list = byNormalized.get(r.normalized_abd_number) ?? [];
    list.push(r);
    byNormalized.set(r.normalized_abd_number, list);
  }

  return {
    file_name: file.name,
    schema_version: schema,
    baseline_id: str(m["baseline_id"]) || str(m["base_baseline_id"]),
    base_import_run_id: str(m["base_import_run_id"]) || str(m["latest_success_import_run_id"]),
    core_hash: str(m["base_core_hash"]).toLowerCase(),
    core_table_hashes: (m["base_core_table_hashes"] ?? {}) as Record<string, string>,
    generated_at: str(m["generated_at"]) || null,
    abdIndex,
    byNormalized,
    byExact,
    blockers,
  };
}
