// 단일 호환 Baseline 계약 회귀검사 — fixture 만 사용한다 (Storage/DB 접근 없음).
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { readBaselineZip } from "@/lib/abd/ocs-baseline-reader";
import {
  ABD_ITEMS_INDEX_SCHEMA,
  BASELINE_ABD_INDEX_PATH,
  BASELINE_DATASETS,
  BASELINE_SCHEMA_VERSION,
  sha256Hex,
} from "@/lib/abd/ocs-baseline-shared";

const INDEX_ROWS = [
  { abd_item_id: "11111111-1111-1111-1111-111111111111", abd_number: "ABD-0001", normalized_abd_number: "abd0001", is_active: true },
  { abd_item_id: "22222222-2222-2222-2222-222222222222", abd_number: "ABD-0002", normalized_abd_number: "abd0002", is_active: true },
];

async function buildFixture(opts: { withSidecar?: boolean; tamperIndex?: boolean; badRowCount?: boolean } = {}) {
  const { withSidecar = true, tamperIndex = false, badRowCount = false } = opts;
  const zip = new JSZip();
  const files = [];
  for (const ds of BASELINE_DATASETS) {
    const text = JSON.stringify({ dataset: ds, row_count: 1, rows: [{ id: ds }] }, null, 0);
    files.push({ relative_path: `${ds}.json`, byte_size: new TextEncoder().encode(text).byteLength, sha256: await sha256Hex(text), row_count: 1 });
    zip.file(`${ds}.json`, text);
  }
  const manifest: Record<string, unknown> = {
    schema_version: BASELINE_SCHEMA_VERSION,
    baseline_id: "base-id",
    base_baseline_id: "base-id",
    base_import_run_id: "run-1",
    base_core_hash: "core-hash",
    total_rows: files.reduce((s, f) => s + f.row_count, 0),
    files,
  };
  if (withSidecar) {
    let text = JSON.stringify({ schema_version: ABD_ITEMS_INDEX_SCHEMA, generated_at: "2026-08-15T00:00:00.000Z", row_count: INDEX_ROWS.length, rows: INDEX_ROWS }, null, 0);
    const decl = { relative_path: BASELINE_ABD_INDEX_PATH, byte_size: new TextEncoder().encode(text).byteLength, sha256: await sha256Hex(text), row_count: badRowCount ? INDEX_ROWS.length + 1 : INDEX_ROWS.length };
    if (tamperIndex) text = text.replace("ABD-0001", "ABD-0009");
    zip.file(BASELINE_ABD_INDEX_PATH, text);
    manifest["validation_files"] = [decl];
  }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const bytes = (await zip.generateAsync({ type: "uint8array" })) as Uint8Array;
  return { manifest, file: new File([bytes as unknown as BlobPart], "base.zip") };
}

describe("단일 호환 Baseline", () => {
  it("Test 1 — 기존 로컬 프로그램 계약(v1 · files 10종 · total_rows)", async () => {
    const { manifest } = await buildFixture();
    const files = manifest["files"] as { relative_path: string; row_count: number }[];
    expect(manifest["schema_version"]).toBe("ocs-baseline-v1");
    expect(files).toHaveLength(10);
    expect(files.some((f) => f.relative_path.startsWith("validation/"))).toBe(false);
    expect(manifest["total_rows"]).toBe(files.reduce((s, f) => s + f.row_count, 0));
    expect((manifest["validation_files"] as unknown[]).length).toBe(1);
  });

  it("Test 2 — 브라우저 인덱스 판독", async () => {
    const { file } = await buildFixture();
    const r = await readBaselineZip(file);
    expect(r.blockers).toEqual([]);
    expect(r.abdIndex).toHaveLength(2);
    expect(r.byExact.get("ABD-0001")?.is_active).toBe(true);
    expect(r.byNormalized.get("abd0002")).toHaveLength(1);
  });

  it("Test 3 — sidecar 변조 차단", async () => {
    const { file } = await buildFixture({ tamperIndex: true });
    const r = await readBaselineZip(file);
    expect(r.abdIndex).toBeNull();
    expect(r.blockers.some((b) => b.includes("SHA-256"))).toBe(true);
  });

  it("Test 4 — row count 불일치 차단", async () => {
    const { file } = await buildFixture({ badRowCount: true });
    const r = await readBaselineZip(file);
    expect(r.abdIndex).toBeNull();
    expect(r.blockers.some((b) => b.includes("row_count"))).toBe(true);
  });

  it("Test 5 — sidecar 없는 과거 v1", async () => {
    const { manifest, file } = await buildFixture({ withSidecar: false });
    expect((manifest["files"] as unknown[]).length).toBe(10);
    const r = await readBaselineZip(file);
    expect(r.schema_version).toBe("ocs-baseline-v1");
    expect(r.abdIndex).toBeNull();
    expect(r.blockers).toEqual([]);
  });

  it("Test 6 — baseline_id 계약 동일 (패키지/브라우저/서버 관문)", async () => {
    const { file } = await buildFixture();
    const r = await readBaselineZip(file);
    const { computeBaselineId, computeBaselineIdCandidates } = await import("@/lib/abd/ocs-baseline-shared");
    const v1 = await computeBaselineId(BASELINE_SCHEMA_VERSION, "core-hash", "run-1");
    const cands = await computeBaselineIdCandidates("core-hash", "run-1");
    expect(cands.all).toContain(v1);
    expect(r.core_hash).toBe("core-hash");
    expect(r.base_import_run_id).toBe("run-1");
    expect(r.abdIndex).not.toBeNull();
  });
});
