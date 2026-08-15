// ABD OCS Baseline ZIP — 브라우저 판독기 (읽기 전용, 서버 호출 없음).
// 로컬 검증에 필요한 최소 정보(계약 hash + ABD 번호 인덱스)만 뽑는다.
import JSZip from "jszip";
import {
  ABD_ITEMS_INDEX_SCHEMA,
  BASELINE_ABD_INDEX_PATH,
  BASELINE_DATASETS,
  BASELINE_SCHEMA_VERSIONS_READABLE,
  sha256Hex,
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
  /**
   * 검증 sidecar 가 존재하고 무결성 검증을 통과했을 때만 채워진다.
   * null 이면 브라우저 ABD 번호 검증 불가 (schema_version 과 무관).
   */
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

  // 1) 운영 데이터셋 10종 계약 확인 (선언 기준)
  const declaredFiles = Array.isArray(m["files"])
    ? (m["files"] as Record<string, unknown>[])
    : [];
  const declaredNames = new Set(declaredFiles.map((f) => str(f["relative_path"])));
  const missingDatasets = BASELINE_DATASETS.filter((d) => !declaredNames.has(`${d}.json`));
  if (missingDatasets.length > 0) {
    blockers.push(`manifest.files 데이터셋 누락: ${missingDatasets.join(", ")}`);
  }

  // 2) 검증 sidecar 선언 → 3~4) 실제 파일 독립 검증
  const validationFiles = Array.isArray(m["validation_files"])
    ? (m["validation_files"] as Record<string, unknown>[])
    : [];
  const decl = validationFiles.find(
    (f) => str(f["relative_path"]) === BASELINE_ABD_INDEX_PATH,
  );

  let abdIndex: AbdIndexRow[] | null = null;
  const idxFile = zip.file(BASELINE_ABD_INDEX_PATH);
  if (decl && !idxFile) {
    blockers.push(
      `manifest 가 ${BASELINE_ABD_INDEX_PATH} 를 선언했으나 ZIP 에 파일이 없습니다.`,
    );
  }
  if (idxFile) {
    let parsed: Record<string, unknown> = {};
    let ok = true;
    const text = await idxFile.async("string");
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch (e) {
      blockers.push(`${BASELINE_ABD_INDEX_PATH} 파싱 실패: ${(e as Error).message}`);
      ok = false;
    }
    if (str(parsed["schema_version"]) !== ABD_ITEMS_INDEX_SCHEMA) {
      blockers.push(
        `ABD 인덱스 schema_version 불일치: ${str(parsed["schema_version"]) || "(없음)"} ≠ ${ABD_ITEMS_INDEX_SCHEMA}`,
      );
      ok = false;
    }
    const rows = Array.isArray(parsed["rows"]) ? (parsed["rows"] as Record<string, unknown>[]) : [];
    const declaredRowCount = Number(parsed["row_count"] ?? NaN);
    if (!Number.isFinite(declaredRowCount) || declaredRowCount !== rows.length) {
      blockers.push(
        `ABD 인덱스 row_count 불일치: 선언 ${String(parsed["row_count"] ?? "(없음)")} ≠ rows ${rows.length}`,
      );
      ok = false;
    }
    if (decl) {
      const byteSize = new TextEncoder().encode(text).byteLength;
      if (Number(decl["byte_size"]) !== byteSize) {
        blockers.push(
          `ABD 인덱스 byte size 불일치: 선언 ${String(decl["byte_size"])} ≠ 실제 ${byteSize}`,
        );
        ok = false;
      }
      const actualHash = await sha256Hex(text);
      if (str(decl["sha256"]).toLowerCase() !== actualHash) {
        blockers.push("ABD 인덱스 SHA-256 불일치 — Baseline 이 변조되었을 수 있습니다.");
        ok = false;
      }
      if (Number(decl["row_count"]) !== rows.length) {
        blockers.push(
          `validation_files.row_count 불일치: 선언 ${String(decl["row_count"])} ≠ rows ${rows.length}`,
        );
        ok = false;
      }
    } else {
      blockers.push(
        `manifest 에 ${BASELINE_ABD_INDEX_PATH} 의 validation_files 무결성 선언이 없습니다.`,
      );
      ok = false;
    }
    const mapped = rows.map((r) => {
      const num = str(r["abd_number"]);
      return {
        abd_item_id: str(r["abd_item_id"]),
        abd_number: num,
        normalized_abd_number: str(r["normalized_abd_number"]) || normalizeAbdNumber(num),
        is_active: r["is_active"] !== false,
      };
    });
    if (mapped.some((r) => !r.abd_item_id || !r.abd_number)) {
      blockers.push("ABD 인덱스에 필수 필드(abd_item_id / abd_number)가 누락된 행이 있습니다.");
      ok = false;
    }
    abdIndex = ok ? mapped : null;
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
