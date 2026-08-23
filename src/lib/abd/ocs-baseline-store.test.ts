// Baseline 저장·재사용 결함 교정 회귀검사 — 순수 헬퍼만 사용 (Storage/DB 접근 없음).
import { describe, it, expect } from "vitest";
import {
  abdIndexDigest,
  assertUploadSucceeded,
  crossCheckManifests,
  pickZipByPointer,
} from "@/lib/abd/ocs-baseline-store";
import {
  BASELINE_ABD_INDEX_PATH,
  BASELINE_DATASETS,
  BASELINE_SCHEMA_VERSION,
  baselineFileName,
  baselineUniqueToken,
} from "@/lib/abd/ocs-baseline-shared";

const ROWS = [
  { abd_item_id: "a", abd_number: "ABD-0001", normalized_abd_number: "abd0001", is_active: true },
  { abd_item_id: "b", abd_number: "ABD-0002", normalized_abd_number: "abd0002", is_active: true },
];

function manifest(over: Record<string, unknown> = {}) {
  const files = BASELINE_DATASETS.map((d) => ({
    relative_path: `${d}.json`,
    byte_size: 10,
    sha256: "aa",
    row_count: 1,
  }));
  return {
    schema_version: BASELINE_SCHEMA_VERSION,
    baseline_id: "bid",
    base_core_hash: "core",
    base_import_run_id: "run-1",
    files,
    total_rows: files.length,
    validation_files: [
      { relative_path: BASELINE_ABD_INDEX_PATH, byte_size: 100, sha256: "bb", row_count: 2 },
    ],
    ...over,
  };
}

describe("Baseline 저장·재사용 교정", () => {
  it("Test 1 — 같은 분에 2회 생성해도 ZIP 경로가 다르다", () => {
    const d = new Date("2026-08-23T22:10:00Z");
    const a = baselineFileName("202608240110", "bid", baselineUniqueToken(d));
    const b = baselineFileName("202608240110", "bid", baselineUniqueToken(d));
    expect(a).not.toBe(b);
    expect(a.endsWith(".zip")).toBe(true);
  });

  it("Test 2 — 폴더에 ZIP 2개여도 sidecar 포인터 ZIP 만 선택", () => {
    const entries = [{ name: "old.zip" }, { name: "new.zip" }];
    expect(pickZipByPointer(entries, "new.zip")?.name).toBe("new.zip");
    expect(pickZipByPointer(entries, null)).toBeNull();
    expect(pickZipByPointer(entries, "missing.zip")).toBeNull();
  });

  it("Test 3 — abd_items_raw 만 바뀌어도 지문이 달라져 재사용 불가", async () => {
    const before = await abdIndexDigest(ROWS);
    const after = await abdIndexDigest([
      ...ROWS,
      { abd_item_id: "c", abd_number: "ABD-0003", normalized_abd_number: "abd0003", is_active: true },
    ]);
    const flipped = await abdIndexDigest([{ ...ROWS[0]!, is_active: false }, ROWS[1]!]);
    expect(after).not.toBe(before);
    expect(flipped).not.toBe(before);
    expect(await abdIndexDigest(ROWS)).toBe(before);
  });

  it("Test 4 — ZIP 내부 manifest 와 외부 sidecar 불일치 시 재사용 금지", () => {
    expect(crossCheckManifests(manifest(), manifest())).toEqual([]);
    expect(crossCheckManifests(manifest(), manifest({ base_core_hash: "other" })).length).toBeGreaterThan(0);
    expect(
      crossCheckManifests(
        manifest(),
        manifest({
          validation_files: [
            { relative_path: BASELINE_ABD_INDEX_PATH, byte_size: 100, sha256: "cc", row_count: 2 },
          ],
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(crossCheckManifests(manifest(), null).length).toBe(1);
  });

  it("Test 5 — upload already exists 는 성공으로 무시하지 않는다", () => {
    expect(() => assertUploadSucceeded({ message: "The resource already exists" }, "p")).toThrow(
      /BASELINE_UPLOAD_FAILED/,
    );
    expect(() => assertUploadSucceeded(null, "p")).not.toThrow();
  });
});
