/**
 * ABD OCS Atomic V3 일회성 교정 어댑터 — 순수 함수만 둔다.
 *
 * 입력 1) OCS_Atomic_V3_DryRun.json               — 교정 정본(원자 코멘트 + 첨부 메타)
 * 입력 2) OCS_Atomic_V2_to_V3_Delta_Audit.json    — V2→V3 변경 감사
 * 입력 3) OCS_Contractor_Response_Atomic_Mapping_V3.json — 응답 segment ↔ atomic 매핑
 *
 * 이 어댑터는 코멘트를 재파싱하지 않는다. 제공된 JSON 을 그대로 정본으로 읽는다.
 */

export type V3AtomicRow = {
  source_comment_id: string;
  source_parent_comment_id: string;
  group_key: string;
  atomic_item_no: number | null;
  atomic_item_count: number | null;
  ocs_comment: string | null;
  assessed_code: string | null;
  ocs_number: string | null;
  source_drawing_number: string | null;
  source_file_name: string | null;
  source_sheet_name: string | null;
  source_row_index: number | null;
  contractor_response_raw: string | null;
};

export type V3AtomicParse = {
  total_raw: number;
  rows: V3AtomicRow[];
  invalid_rows: { index: number; reason: string }[];
  duplicated_atomic_ids: string[];
  source_parent_count: number;
  multi_group_count: number;
  single_comment_count: number;
  residual_multi_marker_rows: number;
  attachments_metadata: number;
};

export type V3DeltaParse = {
  source_parents: number;
  v2_atomic: number;
  v3_atomic: number;
  delta: number;
  changed_parents: number;
  unchanged_parents: number;
  residual_multi_marker_rows: number;
  changed_parent_ids: string[];
};

export type V3ResponseSegment = {
  source_parent_comment_id: string;
  response_segment_no: number;
  response_source_label: string | null;
  response_text: string | null;
  source_file_name: string | null;
  source_sheet: string | null;
  source_row: number | null;
  target_atomic_comment_id: string | null;
  mapping_status: string;
  mapping_method: string | null;
  confidence_score: number | null;
  evidence_terms: unknown;
};

export type V3ResponseParse = {
  total_raw: number;
  segments: V3ResponseSegment[];
  invalid_rows: { index: number; reason: string }[];
  reviewed_source_groups: number;
  atomic_comments_in_groups: number;
  status_counts: Record<string, number>;
  confirmed_high: number;
  probable: number;
  requires_review: number;
  duplicate_ignored: number;
  confirmed_high_unique_targets: number;
  duplicate_links: number;
};

/** 하이픈/점/괄호 번호 마커가 본문 안에 2개 이상 남아 있는지 — V3 잔존 복수 번호 검사 */
const MULTI_MARKER = /(^|\n|\s)(\d{1,2})\s*[.)-]\s+\S/g;

export function countNumberMarkers(text: string | null): number {
  if (!text) return 0;
  MULTI_MARKER.lastIndex = 0;
  let n = 0;
  while (MULTI_MARKER.exec(text) !== null) n += 1;
  return n;
}

function pick(r: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== "") return r[k];
  }
  return undefined;
}
function s(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}
function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    return Math.trunc(Number(v));
  return null;
}
function f(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const K = {
  atomic: [
    "Atomic Comment ID",
    "atomic_comment_id",
    "source_comment_id",
    "Comment ID",
    "comment_id",
  ],
  parent: [
    "Parent Comment ID",
    "parent_comment_id",
    "Source Parent Comment ID",
    "source_parent_comment_id",
    "Original Comment ID",
  ],
  group: ["Group Key", "group_key", "Comment Group Key", "comment_group_key"],
  itemNo: ["Atomic Item No", "atomic_item_no", "Item No", "item_no", "Seq"],
  itemCount: ["Atomic Item Count", "atomic_item_count", "Item Count", "item_count"],
  text: ["Atomic Comment", "atomic_comment", "OCS Comment", "ocs_comment", "Comment Text"],
  assessed: ["Assessed Code", "assessed_code"],
  ocsNumber: ["OCS Number", "ocs_number"],
  drawing: ["ABD Drawing Number", "source_drawing_number", "Drawing Number"],
  fileName: ["Source File Name", "source_file_name", "source_file"],
  sheet: ["Source Sheet", "source_sheet_name", "source_sheet", "Source Sheet Name"],
  rowIndex: ["Source Row", "source_row_index", "source_row", "Source Row Index"],
  responseRaw: [
    "Contractor Response Raw",
    "contractor_response_raw",
    "Original Contractor Response",
    "Contractor Response",
    "contractor_response",
  ],
  segNo: ["Response Segment No", "response_segment_no", "segment_no", "Segment No"],
  segLabel: ["Response Source Label", "response_source_label", "segment_label", "Response Label"],
  segText: ["Response Text", "response_text", "Segment Text", "segment_text"],
  target: [
    "Target Atomic Comment ID",
    "target_atomic_comment_id",
    "Atomic Comment ID",
    "atomic_comment_id",
  ],
  mapStatus: ["Mapping Status", "mapping_status", "status"],
  mapMethod: ["Mapping Method", "mapping_method", "method"],
  score: ["Confidence", "confidence", "confidence_score", "Confidence Score"],
  evidence: ["Evidence Terms", "evidence_terms", "evidence"],
};

function rowsOf(json: unknown, extraKeys: string[] = []): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  const box = (json ?? {}) as Record<string, unknown>;
  for (const k of ["rows", "data", "items", ...extraKeys]) {
    if (Array.isArray(box[k])) return box[k] as Record<string, unknown>[];
  }
  return [];
}

function summaryOf(json: unknown): Record<string, unknown> {
  const box = (json ?? {}) as Record<string, unknown>;
  for (const k of ["summary", "meta", "totals", "audit_summary", "statistics"]) {
    const v = box[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return box;
}

/** 4.1 — Atomic V3 정본 */
export function parseV3Atomic(json: unknown): V3AtomicParse {
  const box = (json ?? {}) as Record<string, unknown>;
  const raw = rowsOf(json, ["atomic_comments", "comments", "atomic_rows"]);
  const rows: V3AtomicRow[] = [];
  const invalid_rows: { index: number; reason: string }[] = [];
  let residual = 0;

  raw.forEach((r, i) => {
    const cid = s(pick(r, K.atomic));
    if (!cid) {
      invalid_rows.push({ index: i, reason: "Atomic Comment ID 누락" });
      return;
    }
    const pid = s(pick(r, K.parent)) ?? cid;
    const text = s(pick(r, K.text));
    if (countNumberMarkers(text) > 1) residual += 1;
    rows.push({
      source_comment_id: cid,
      source_parent_comment_id: pid,
      group_key: s(pick(r, K.group)) ?? `G:${pid}`,
      atomic_item_no: n(pick(r, K.itemNo)),
      atomic_item_count: n(pick(r, K.itemCount)),
      ocs_comment: text,
      assessed_code: s(pick(r, K.assessed)),
      ocs_number: s(pick(r, K.ocsNumber)),
      source_drawing_number: s(pick(r, K.drawing)),
      source_file_name: s(pick(r, K.fileName)),
      source_sheet_name: s(pick(r, K.sheet)),
      source_row_index: n(pick(r, K.rowIndex)),
      contractor_response_raw: s(pick(r, K.responseRaw)),
    });
  });

  const seen = new Set<string>();
  const dup = new Set<string>();
  const byParent = new Map<string, number>();
  for (const r of rows) {
    if (seen.has(r.source_comment_id)) dup.add(r.source_comment_id);
    seen.add(r.source_comment_id);
    byParent.set(r.source_parent_comment_id, (byParent.get(r.source_parent_comment_id) ?? 0) + 1);
  }

  const attArr = ["attachments", "attachment_metadata", "attachments_metadata"]
    .map((k) => box[k])
    .find((v) => Array.isArray(v)) as unknown[] | undefined;

  return {
    total_raw: raw.length,
    rows,
    invalid_rows,
    duplicated_atomic_ids: Array.from(dup),
    source_parent_count: byParent.size,
    multi_group_count: Array.from(byParent.values()).filter((c) => c > 1).length,
    single_comment_count: Array.from(byParent.values()).filter((c) => c === 1).length,
    residual_multi_marker_rows: residual,
    attachments_metadata: attArr?.length ?? 0,
  };
}

/** 4.2 — V2→V3 Delta Audit */
export function parseV3Delta(json: unknown): V3DeltaParse {
  const sum = summaryOf(json);
  const rows = rowsOf(json, ["changed_parents", "changes", "delta_rows", "parents"]);
  const changedIds = new Set<string>();
  for (const r of rows) {
    const changedFlag = pick(r, ["changed", "is_changed", "has_change"]);
    const pid = s(pick(r, K.parent)) ?? s(pick(r, K.atomic));
    if (!pid) continue;
    const v2c = n(pick(r, ["v2_count", "V2 Count", "v2_atomic_count"]));
    const v3c = n(pick(r, ["v3_count", "V3 Count", "v3_atomic_count"]));
    const changed =
      changedFlag === undefined
        ? v2c !== null && v3c !== null
          ? v2c !== v3c
          : true
        : String(changedFlag).toLowerCase() === "true";
    if (changed) changedIds.add(pid);
  }
  const g = (keys: string[]) => n(pick(sum, keys)) ?? 0;
  const v2 = g(["v2_atomic_comments", "V2 Atomic Comments", "v2_atomic", "v2_count"]);
  const v3 = g(["v3_atomic_comments", "V3 Atomic Comments", "v3_atomic", "v3_count"]);
  const changedCount =
    g(["changed_source_parents", "changed_parents", "Changed Source Parents"]) || changedIds.size;
  const parents = g(["source_parents", "Source Parents", "source_parent_count"]);
  return {
    source_parents: parents,
    v2_atomic: v2,
    v3_atomic: v3,
    delta: g(["delta", "atomic_delta"]) || v3 - v2,
    changed_parents: changedCount,
    unchanged_parents:
      g(["unchanged_source_parents", "unchanged_parents"]) ||
      (parents ? parents - changedCount : 0),
    residual_multi_marker_rows: g(["v3_residual_multi_marker_rows", "residual_multi_marker_rows"]),
    changed_parent_ids: Array.from(changedIds),
  };
}

const ALLOWED_STATUS = new Set([
  "confirmed_high",
  "probable",
  "requires_review",
  "duplicate_ignored",
]);

/** 4.3 — Contractor Response Atomic Mapping */
export function parseV3ResponseMapping(json: unknown): V3ResponseParse {
  const raw = rowsOf(json, ["segments", "response_segments", "mappings", "response_mappings"]);
  const segments: V3ResponseSegment[] = [];
  const invalid_rows: { index: number; reason: string }[] = [];
  const statusCounts: Record<string, number> = {};
  const pairSeen = new Set<string>();
  let duplicateLinks = 0;

  raw.forEach((r, i) => {
    const pid = s(pick(r, K.parent));
    if (!pid) {
      invalid_rows.push({ index: i, reason: "Parent Comment ID 누락" });
      return;
    }
    const statusRaw = (s(pick(r, K.mapStatus)) ?? "requires_review")
      .toLowerCase()
      .replace(/\s+/g, "_");
    const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : "requires_review";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const target = s(pick(r, K.target));
    if (target) {
      const key = `${pid}|${s(pick(r, K.segNo)) ?? ""}|${target}`;
      if (pairSeen.has(key)) duplicateLinks += 1;
      pairSeen.add(key);
    }
    segments.push({
      source_parent_comment_id: pid,
      response_segment_no: n(pick(r, K.segNo)) ?? i + 1,
      response_source_label: s(pick(r, K.segLabel)),
      response_text: s(pick(r, K.segText)),
      source_file_name: s(pick(r, K.fileName)),
      source_sheet: s(pick(r, K.sheet)),
      source_row: n(pick(r, K.rowIndex)),
      target_atomic_comment_id: target,
      mapping_status: status,
      mapping_method: s(pick(r, K.mapMethod)),
      confidence_score: f(pick(r, K.score)),
      evidence_terms: pick(r, K.evidence) ?? null,
    });
  });

  const confirmedTargets = new Set(
    segments
      .filter((x) => x.mapping_status === "confirmed_high" && x.target_atomic_comment_id)
      .map((x) => x.target_atomic_comment_id as string),
  );

  return {
    total_raw: raw.length,
    segments,
    invalid_rows,
    reviewed_source_groups: new Set(segments.map((x) => x.source_parent_comment_id)).size,
    atomic_comments_in_groups: 0, // V3 원자 코멘트와 교차 계산 후 채운다
    status_counts: statusCounts,
    confirmed_high: statusCounts["confirmed_high"] ?? 0,
    probable: statusCounts["probable"] ?? 0,
    requires_review: statusCounts["requires_review"] ?? 0,
    duplicate_ignored: statusCounts["duplicate_ignored"] ?? 0,
    confirmed_high_unique_targets: confirmedTargets.size,
    duplicate_links: duplicateLinks,
  };
}

/** V3 원자 코멘트 기준으로 응답 매핑을 교차 검증한다. */
export function crossCheckResponse(atomic: V3AtomicParse, resp: V3ResponseParse) {
  const idSet = new Set(atomic.rows.map((r) => r.source_comment_id));
  const parentChildren = new Map<string, number>();
  for (const r of atomic.rows) {
    parentChildren.set(
      r.source_parent_comment_id,
      (parentChildren.get(r.source_parent_comment_id) ?? 0) + 1,
    );
  }
  const reviewedParents = new Set(resp.segments.map((x) => x.source_parent_comment_id));
  let atomicInGroups = 0;
  let missingParents = 0;
  for (const p of reviewedParents) {
    const c = parentChildren.get(p);
    if (c === undefined) missingParents += 1;
    else atomicInGroups += c;
  }
  const confirmed = resp.segments.filter((x) => x.mapping_status === "confirmed_high");
  const resolved = confirmed.filter(
    (x) => x.target_atomic_comment_id && idSet.has(x.target_atomic_comment_id),
  );
  return {
    reviewed_source_groups: reviewedParents.size,
    atomic_comments_in_groups: atomicInGroups,
    missing_parents_in_v3: missingParents,
    confirmed_high_resolved: resolved.length,
    confirmed_high_unresolved: confirmed.length - resolved.length,
    confirmed_high_unique_targets: new Set(
      resolved.map((x) => x.target_atomic_comment_id as string),
    ).size,
  };
}

/** V3 원자 코멘트를 dry-run RPC 입력(부모 단위)으로 접는다. */
export function foldParents(rows: V3AtomicRow[]) {
  const map = new Map<string, { pid: string; children: { cid: string; txt: string }[] }>();
  for (const r of rows) {
    const e = map.get(r.source_parent_comment_id) ?? {
      pid: r.source_parent_comment_id,
      children: [],
    };
    e.children.push({ cid: r.source_comment_id, txt: r.ocs_comment ?? "" });
    map.set(r.source_parent_comment_id, e);
  }
  return Array.from(map.values());
}
