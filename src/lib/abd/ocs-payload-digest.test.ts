import { describe, expect, it } from "vitest";
import { computeStagingPayloadDigest, PAYLOAD_DIGEST_VERSION } from "./ocs-payload-digest";
import type { V3AtomicParse, V3ResponseParse, V3StageComment } from "./ocs-v3-parser";

const c = (over: Partial<V3StageComment>): V3StageComment => ({
  source_comment_id: "C1",
  source_parent_comment_id: "P1",
  comment_group_id: "G1",
  atomic_item_no: 1,
  atomic_item_count: 2,
  split_status: "split",
  comment_part: null,
  ocs_comment: "본문 텍스트",
  assessed_code: "A",
  contractor_response: null,
  ocs_number: "OCS-1",
  drawing_number: null,
  source_file_name: "a.xlsx",
  source_sheet_name: "Sheet1",
  source_row_index: 10,
  abd_numbers: ["ABD-001"],
  link_status: "linked",
  link_scope: "single",
  link_method: "exact",
  is_active: true,
  retired_reason: null,
  initial_complied: false,
  compliance_source: null,
  compliance_reason: null,
  ...over,
});

const atomic = (comments: V3StageComment[]): V3AtomicParse =>
  ({
    summary: {},
    link_correction_summary: {},
    payload_sha256: null,
    groups: [
      {
        group_id: "G1",
        source_parent_comment_id: "P1",
        ocs_number: "OCS-1",
        drawing_number: null,
        source_file_name: "a.xlsx",
        source_sheet: "Sheet1",
        source_row: 10,
        item_count: 2,
        split_status: "split",
        group_contractor_response: null,
        v3_ocs_number: "OCS-1",
      },
    ],
    comments,
    attachments: [],
  }) as unknown as V3AtomicParse;

const response = (): V3ResponseParse =>
  ({
    total_raw: 1,
    segments: [
      {
        group_id: "G1",
        source_parent_comment_id: "P1",
        response_segment_no: 1,
        response_source_label: null,
        response_text: "resp",
        atomic_comment_id: "C1",
        mapping_status: "confirmed_high",
        mapping_method: "exact",
        confidence_score: 0.9,
        source_file_name: "a.xlsx",
        source_sheet: "Sheet1",
        source_row: 10,
        generic_response: false,
      },
    ],
    invalid_rows: [],
  }) as unknown as V3ResponseParse;

describe("ocs staging payload digest", () => {
  it("동일 payload 는 동일 digest·count 를 낸다 (행 순서 무관)", async () => {
    const rows = [c({}), c({ source_comment_id: "C2", atomic_item_no: 2 })];
    const a = await computeStagingPayloadDigest({ atomic: atomic(rows), response: response() });
    const b = await computeStagingPayloadDigest({
      atomic: atomic([...rows].reverse()),
      response: response(),
    });
    expect(a.digest_version).toBe(PAYLOAD_DIGEST_VERSION);
    expect(a.payload_sha256).toBe(b.payload_sha256);
    expect(a.counts).toEqual({ groups: 1, comments: 2, attachments: 0, responses: 1 });
  });

  it("comment 1개 값 변조 → digest 불일치 (count 는 동일)", async () => {
    const base = await computeStagingPayloadDigest({
      atomic: atomic([c({})]),
      response: response(),
    });
    const tampered = await computeStagingPayloadDigest({
      atomic: atomic([c({ ocs_comment: "본문 텍스트 변조" })]),
      response: response(),
    });
    expect(tampered.counts.comments).toBe(base.counts.comments);
    expect(tampered.payload_sha256).not.toBe(base.payload_sha256);
  });

  it("row 1개 누락 → count·digest 모두 불일치", async () => {
    const full = await computeStagingPayloadDigest({
      atomic: atomic([c({}), c({ source_comment_id: "C2" })]),
      response: response(),
    });
    const missing = await computeStagingPayloadDigest({
      atomic: atomic([c({})]),
      response: response(),
    });
    expect(missing.counts.comments).toBe(full.counts.comments - 1);
    expect(missing.payload_sha256).not.toBe(full.payload_sha256);
  });
});
