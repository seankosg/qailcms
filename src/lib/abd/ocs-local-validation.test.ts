import { describe, expect, it } from "vitest";
import {
  BASELINE_V1_NOTICE,
  buildLocalValidationReceipt,
  validateIncrementLocally,
  verifyLocalValidationReceipt,
} from "./ocs-local-validation";
import { BASELINE_CORE_TABLES } from "./ocs-baseline-shared";
import { nextPackageFileName, PACKAGE_NAME_RE } from "./ocs-increment-package";
import { correctedFileName } from "./ocs-corrected-package";
import { makeCorrectionsDoc, type CorrectionItem } from "./ocs-local-corrections";
import type { BaselineRead, AbdIndexRow } from "./ocs-baseline-reader";
import type { IncrementPackage } from "./ocs-increment-package";
import type { V3StageComment } from "./ocs-v3-parser";

const idx = (n: string, active = true): AbdIndexRow => ({
  abd_item_id: `id-${n}`,
  abd_number: n,
  normalized_abd_number: n.toUpperCase(),
  is_active: active,
});

function baseline(rows: AbdIndexRow[] | null): BaselineRead {
  const byNormalized = new Map<string, AbdIndexRow[]>();
  const byExact = new Map<string, AbdIndexRow>();
  for (const r of rows ?? []) {
    byExact.set(r.abd_number, r);
    if (r.is_active) byNormalized.set(r.normalized_abd_number, [
      ...(byNormalized.get(r.normalized_abd_number) ?? []),
      r,
    ]);
  }
  return {
    file_name: "b.zip",
    schema_version: "ocs-baseline-v2",
    baseline_id: "B1",
    base_import_run_id: "R1",
    core_hash: "abc",
    core_table_hashes: {},
    generated_at: null,
    abdIndex: rows,
    byNormalized,
    byExact,
    blockers: [],
  };
}

const comment = (over: Partial<V3StageComment>): V3StageComment => ({
  source_comment_id: "C1",
  source_parent_comment_id: "P1",
  comment_group_id: null,
  atomic_item_no: 1,
  atomic_item_count: 1,
  split_status: null,
  comment_part: null,
  ocs_comment: "x",
  assessed_code: null,
  contractor_response: null,
  ocs_number: "OCS-1",
  drawing_number: null,
  source_file_name: "a.xlsx",
  source_sheet_name: "S",
  source_row_index: 3,
  abd_numbers: [],
  link_status: null,
  link_scope: null,
  link_method: null,
  is_active: true,
  retired_reason: null,
  initial_complied: false,
  compliance_source: null,
  compliance_reason: null,
  ...over,
});

function pkg(comments: V3StageComment[]): IncrementPackage {
  return {
    file_name: "OCS_Increment_20260101_1.zip",
    file_size: 1,
    package_sha256: "sha",
    manifest: {
      schema_version: "ocs-increment/1",
      package_id: "P",
      data_date: "2026-01-01",
      base_baseline_id: "B1",
      base_import_run_id: "R1",
      base_core_hash: "abc",
      base_core_table_hashes: Object.fromEntries(
        BASELINE_CORE_TABLES.map((t) => [t, "h"]),
      ) as Record<string, string>,
      base_generated_at: "",
      target_ocs_numbers: [],
      change_type: "new",
      files: [],
      generated_at: "",
      tool_version: "",
    },
    atomic: {
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
          source_sheet: "S",
          source_row: 3,
          item_count: 1,
          split_status: null,
          group_contractor_response: null,
          v3_ocs_number: null,
        },
      ],
      comments,
      attachments: [],
      invalid_rows: [],
      duplicated_atomic_ids: [],
      source_parent_count: 1,
      active_count: comments.length,
      inactive_count: 0,
      linked_count: 0,
      linked_multi_count: 0,
      abd_link_associations: 0,
      distinct_abd_numbers: 0,
      residual_multi_marker_rows: 0,
      attachment_scope_counts: {},
      attachment_invalid_rows: [],
      duplicated_attachment_ids: [],
      duplicated_attachment_paths: [],
    },
    response: {
      total_raw: 0,
      segments: [],
      invalid_rows: [],
      reviewed_source_groups: 0,
      atomic_comments_in_groups: 0,
      status_counts: {},
      confirmed_high: 0,
      probable: 0,
      requires_review: 0,
      duplicate_ignored: 0,
      open_segments: 0,
      open_groups: 0,
      confirmed_high_unique_targets: 0,
      duplicate_links: 0,
    },
    policy: {
      policy_version: null,
      generated_at: null,
      atomic_v3_file: null,
      atomic_v3_sha256: null,
      response_mapping_file: null,
      response_mapping_sha256: null,
      open_segment_count: 0,
      open_group_count: 0,
      group_inherited_attachment_count: 0,
      raw_data_ocs_change_count: 0,
      group_response_decisions: 0,
    },
    sourceFiles: [
      { relative_path: "source/a.xlsx", bytes: new ArrayBuffer(1), sha256: "h1", byte_size: 1 },
    ],
    images: [],
    imageMeta: [],
    verifiedFiles: 0,
    blockers: [],
  };
}

describe("validateIncrementLocally", () => {
  it("정확히 일치하는 ABD 는 CLEAN", () => {
    const r = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: ["ABD-001"] })]),
      baseline: baseline([idx("ABD-001")]),
    });
    expect(r.clean).toBe(true);
    expect(r.unresolved_abd_count).toBe(0);
  });

  it("표기만 다른 값은 후보를 제시하되 blocker 로 남긴다", () => {
    const r = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: ["abd-001 "] })]),
      baseline: baseline([idx("ABD-001")]),
    });
    expect(r.clean).toBe(false);
    const i = r.issues.find((x) => x.code === "ABD_NUMBER_NORMALIZATION");
    expect(i?.candidates[0]?.abd_number).toBe("ABD-001");
    expect(i?.correction_mode).toBe("inline_mapping");
  });

  it("Baseline 에 없는 번호는 후보 없이 unresolved", () => {
    const r = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: ["ABD-999"] })]),
      baseline: baseline([idx("ABD-001")]),
    });
    expect(r.issues.some((x) => x.code === "ABD_NUMBER_UNRESOLVED")).toBe(true);
  });

  it("v1 Baseline(인덱스 없음)은 로컬 해소 불가로 차단", () => {
    const r = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: ["ABD-001"] })]),
      baseline: baseline(null),
    });
    expect(r.issues.some((x) => x.code === "BASELINE_INDEX_MISSING")).toBe(true);
    expect(r.clean).toBe(false);
    expect(r.baseline_supports_local_validation).toBe(false);
    expect(r.issues.find((x) => x.code === "BASELINE_INDEX_MISSING")?.message).toBe(
      BASELINE_V1_NOTICE,
    );
  });

  it("v2 Baseline 은 정상 검증된다", () => {
    const r = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: ["ABD-001"] })]),
      baseline: baseline([idx("ABD-001")]),
    });
    expect(r.baseline_supports_local_validation).toBe(true);
    expect(r.clean).toBe(true);
  });

  it("unresolved 1건 → canonical 교정 후 unresolved 0 · 항등식 유지", async () => {
    const before = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: ["abd-001 "] })]),
      baseline: baseline([idx("ABD-001")]),
    });
    expect(before.unresolved_abd_count).toBe(1);
    expect(before.abd_link_associations).toBe(1);

    const item: CorrectionItem = {
      source_file_hash: "h1",
      source_file_name: "a.xlsx",
      sheet_name: "S",
      source_row: 3,
      sn: "C1",
      atomic_item_no: 1,
      field: "abd_number",
      before: "abd-001 ",
      after: "ABD-001",
      after_abd_item_id: "id-ABD-001",
      reason: "user_selected_canonical_mapping",
    };
    const doc = makeCorrectionsDoc("P", "sha", "B1", [item]);
    const after = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: ["abd-001 "] })]),
      baseline: baseline([idx("ABD-001")]),
      corrections: doc,
    });
    expect(after.unresolved_abd_count).toBe(0);
    expect(after.clean).toBe(true);
    expect(after.abd_link_associations).toBe(1);
    expect(after.distinct_linked_abd).toBe(1);
    expect(after.duplicate_identity_count).toBe(0);
    expect(after.duplicate_pair_count).toBe(0);
    expect(
      after.single_linked_comments + after.multi_linked_comments + after.unmatched_comments,
    ).toBe(after.active_comments);

    // 변조된 locator 는 적용되지 않고 차단된다.
    const tampered = makeCorrectionsDoc("P", "sha", "B1", [{ ...item, source_row: 999 }]);
    const bad = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: ["abd-001 "] })]),
      baseline: baseline([idx("ABD-001")]),
      corrections: tampered,
    });
    expect(bad.clean).toBe(false);
    expect(bad.unresolved_abd_count).toBe(1);
  });

  it("교정 ZIP 파일명은 계약(OCS_Increment_<YYYYMMDD>_<seq>.zip)을 지킨다", () => {
    const name = correctedFileName("OCS_Increment_20260101_1.zip", 1);
    expect(name).toBe("OCS_Increment_20260101_2.zip");
    expect(PACKAGE_NAME_RE.test(name)).toBe(true);
    expect(nextPackageFileName("OCS_Increment_20260101_09.zip")).toBe(
      "OCS_Increment_20260101_10.zip",
    );
  });

  it("변조된 payload digest 는 영수증 대조에서 차단된다", async () => {
    const p = pkg([comment({ abd_numbers: ["ABD-001"] })]);
    const r = validateIncrementLocally({ pkg: p, baseline: baseline([idx("ABD-001")]) });
    const receipt = await buildLocalValidationReceipt({
      pkg: p,
      result: r,
      corrections: null,
      manifestForPayload: p.manifest,
    });
    const okCheck = await verifyLocalValidationReceipt({
      receipt,
      pkg: p,
      corrections: null,
      manifestForPayload: p.manifest,
    });
    expect(okCheck.ok).toBe(true);
    const badCheck = await verifyLocalValidationReceipt({
      receipt: { ...receipt, payload_sha256: "deadbeef" },
      pkg: p,
      corrections: null,
      manifestForPayload: p.manifest,
    });
    expect(badCheck.ok).toBe(false);
  });

  it("active identity 중복을 차단한다", () => {
    const r = validateIncrementLocally({
      pkg: pkg([comment({ abd_numbers: [] }), comment({ abd_numbers: [] })]),
      baseline: baseline([idx("ABD-001")]),
    });
    expect(r.duplicate_identity_count).toBe(1);
  });
});
