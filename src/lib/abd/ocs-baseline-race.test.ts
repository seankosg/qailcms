// ABD 인덱스 경쟁 감지 회귀검사 — 순수 헬퍼 + 파이프라인 시뮬레이션 (Storage/DB 접근 없음).
import { describe, it, expect, vi } from "vitest";
import { abdIndexDigest, assertAbdIndexUnchanged } from "@/lib/abd/ocs-baseline-store";

const ROWS = [
  { abd_item_id: "a", abd_number: "ABD-0001", normalized_abd_number: "abd0001", is_active: true },
  { abd_item_id: "b", abd_number: "ABD-0002", normalized_abd_number: "abd0002", is_active: true },
];

/** createOcsBaseline 의 시작→추출→재검증→업로드 순서를 그대로 흉내 낸다. */
async function runPipeline(
  startRows: typeof ROWS,
  endRows: typeof ROWS,
  upload: () => void,
  sidecar: () => void,
) {
  const startDigest = await abdIndexDigest(startRows);
  // (데이터셋 추출 + core hash after 검사 자리)
  const finalRows = endRows;
  assertAbdIndexUnchanged(startDigest, await abdIndexDigest(finalRows));
  upload();
  sidecar();
  return finalRows;
}

describe("Baseline 생성 중 ABD 인덱스 변경 감지", () => {
  it("Test 1 — 시작/종료 digest 동일 → 생성 계속", async () => {
    const upload = vi.fn();
    const sidecar = vi.fn();
    const rows = await runPipeline(ROWS, [...ROWS], upload, sidecar);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(sidecar).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
  });

  it("Test 2 — digest 불일치 → 오류, upload/sidecar 0회", async () => {
    const upload = vi.fn();
    const sidecar = vi.fn();
    await expect(
      runPipeline(
        ROWS,
        [
          ...ROWS,
          { abd_item_id: "c", abd_number: "ABD-0003", normalized_abd_number: "abd0003", is_active: true },
        ],
        upload,
        sidecar,
      ),
    ).rejects.toThrow(/BASELINE_ABD_INDEX_RACE_DETECTED/);
    expect(upload).not.toHaveBeenCalled();
    expect(sidecar).not.toHaveBeenCalled();
  });
});
