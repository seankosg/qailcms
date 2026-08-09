/**
 * ABD OCS Atomic V3 일회성 교정 어댑터 — 순수 함수만 둔다.
 *
 * 입력 1) OCS_Atomic_V3_Corrected_DB.json          — 교정 정본(그룹 + 원자 코멘트 + 첨부 메타)
 * 입력 2) OCS_Atomic_V2_to_V3_Delta_Audit.json     — V2→V3 변경 감사
 * 입력 3) OCS_Contractor_Response_Atomic_Mapping_V3.json — 응답 segment ↔ atomic 매핑
 * 입력 4) OCS_V3_Final_Import_Policy.json          — 최종 정책(해시 관문 + 기대값)
 *
 * 이 어댑터는 코멘트를 재파싱하지 않는다. 제공된 JSON 을 그대로 정본으로 읽고
 * 서버 스테이징 테이블 컬럼명에 1:1 로 대응시킨다.
 */

export type V3StageGroup = {
  group_id: string;
  source_parent_comment_id: string;
  ocs_number: string | null;
  drawing_number: string | null;
  source_file_name: string | null;
  source_sheet: string | null;
  source_row: number | null;
  item_count: number | null;
  split_status: string | null;
  group_contractor_response: string | null;
  v3_ocs_number: string | null;
};

export type V3StageComment = {
  source_comment_id: string;
  source_parent_comment_id: string;
  comment_group_id: string | null;
  atomic_item_no: number | null;
  atomic_item_count: number | null;
  split_status: string | null;
  comment_part: number | null;
  ocs_comment: string | null;
  assessed_code: string | null;
  contractor_response: string | null;
  ocs_number: string | null;
  drawing_number: string | null;
  source_file_name: string | null;
  source_sheet_name: string | null;
  source_row_index: number | null;
  abd_numbers: string[];
  link_status: string | null;
  link_scope: string | null;
  link_method: string | null;
  is_active: boolean;
  retired_reason: string | null;
  initial_complied: boolean;
  compliance_source: string | null;
  compliance_reason: string | null;
};

export type V3StageAttachment = {
  /** 정본 키. 과거 `attachment_id` 는 호환 alias 로만 허용한다. */
  source_attachment_id: string;
  /** 호환 alias — 항상 source_attachment_id 와 동일 값으로 채운다. */
  attachment_id: string;
  comment_id: string | null;
  source_parent_comment_id: string | null;
  comment_group_id: string | null;
  atomic_comment_id: string | null;
  attachment_scope: string | null;
  storage_path: string | null;
  content_hash: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  image_format: string | null;
  mime_type: string | null;
  source_image_index: number | null;
};

export type V3StageResponse = {
  group_id: string | null;
  source_parent_comment_id: string;
  response_segment_no: number;
  response_source_label: string | null;
  response_text: string | null;
  atomic_comment_id: string | null;
  mapping_status: string;
  mapping_method: string | null;
  confidence_score: number | null;
  source_file_name: string | null;
  source_sheet: string | null;
  source_row: number | null;
  generic_response: boolean;
};

export type V3AtomicParse = {
  summary: Record<string, unknown>;
  link_correction_summary: Record<string, unknown>;
  payload_sha256: string | null;
  groups: V3StageGroup[];
  comments: V3StageComment[];
  attachments: V3StageAttachment[];
  invalid_rows: { index: number; reason: string }[];
  duplicated_atomic_ids: string[];
  source_parent_count: number;
  active_count: number;
  inactive_count: number;
  linked_count: number;
  linked_multi_count: number;
  abd_link_associations: number;
  distinct_abd_numbers: number;
  residual_multi_marker_rows: number;
  attachment_scope_counts: Record<string, number>;
  attachment_invalid_rows: { index: number; reason: string }[];
  duplicated_attachment_ids: string[];
  duplicated_attachment_paths: string[];
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

export type V3ResponseParse = {
  total_raw: number;
  segments: V3StageResponse[];
  invalid_rows: { index: number; reason: string }[];
  reviewed_source_groups: number;
  atomic_comments_in_groups: number;
  status_counts: Record<string, number>;
  confirmed_high: number;
  probable: number;
  requires_review: number;
  duplicate_ignored: number;
  open_segments: number;
  open_groups: number;
  confirmed_high_unique_targets: number;
  duplicate_links: number;
};

export type V3PolicyParse = {
  policy_version: string | null;
  generated_at: string | null;
  atomic_v3_file: string | null;
  atomic_v3_sha256: string | null;
  response_mapping_file: string | null;
  response_mapping_sha256: string | null;
  open_segment_count: number;
  open_group_count: number;
  group_inherited_attachment_count: number;
  raw_data_ocs_change_count: number;
  group_response_decisions: number;
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
function b(v: unknown, dflt = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["true", "1", "y", "yes"].includes(v.trim().toLowerCase());
  if (typeof v === "number") return v !== 0;
  return dflt;
}
function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => s(x)).filter((x): x is string => !!x);
  const one = s(v);
  return one ? [one] : [];
}

const K = {
  atomic: ["Atomic Comment ID", "atomic_comment_id", "Comment ID", "comment_id"],
  parent: ["Source Parent Comment ID", "source_parent_comment_id", "Parent Comment ID"],
  group: ["Comment Group ID", "comment_group_id", "group_id", "Group Key"],
  itemNo: ["Atomic Item No", "atomic_item_no"],
  itemCount: ["Atomic Item Count", "atomic_item_count"],
  splitStatus: ["Atomic Split Status", "atomic_split_status", "split_status"],
  commentPart: ["Comment Part", "comment_part"],
  text: ["OCS Comment", "ocs_comment", "Atomic Comment", "atomic_comment"],
  assessed: ["Assessed Code", "assessed_code"],
  response: ["Contractor Response", "contractor_response"],
  ocsNumber: ["V3 OCS Number", "v3_ocs_number", "OCS Number", "ocs_number"],
  drawing: ["ABD Drawing Number", "drawing_number", "source_drawing_number"],
  fileName: ["Source File Name", "source_file_name"],
  sheet: ["Source Sheet", "source_sheet", "source_sheet_name"],
  rowIndex: ["Source Row", "source_row", "source_row_index"],
  abdNumbers: ["V3 ABD Numbers", "v3_abd_numbers"],
  abdNumber: ["V3 ABD Number", "v3_abd_number"],
  linkStatus: ["V3 Link Status", "v3_link_status"],
  linkScope: ["V3 Link Scope", "v3_link_scope"],
  linkMethod: ["V3 Link Method", "v3_link_method"],
  active: ["V3 Active", "v3_active", "is_active"],
  retired: ["V3 Retired Reason", "v3_retired_reason", "retired_reason"],
  complied: ["V3 Initial Complied", "v3_initial_complied"],
  complianceSource: ["V3 Compliance Source", "v3_compliance_source"],
  complianceReason: ["V3 Compliance Reason", "v3_compliance_reason"],
  segNo: ["response_segment_no", "Response Segment No"],
  segLabel: ["response_source_label", "Response Source Label"],
  segText: ["response_text", "Response Text"],
  mapStatus: ["mapping_status", "Mapping Status"],
  mapMethod: ["mapping_method", "Mapping Method"],
  score: ["confidence_score", "Confidence Score", "confidence"],
};

function listOf(json: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  const box = (json ?? {}) as Record<string, unknown>;
  for (const k of keys) if (Array.isArray(box[k])) return box[k] as Record<string, unknown>[];
  for (const k of ["rows", "data", "items"])
    if (Array.isArray(box[k])) return box[k] as Record<string, unknown>[];
  return [];
}

function objOf(json: unknown, keys: string[]): Record<string, unknown> {
  const box = (json ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = box[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return {};
}

/** 4.1 — Atomic V3 정본 (그룹 / 원자 코멘트 / 첨부) */
export function parseV3Atomic(json: unknown): V3AtomicParse {
  const box = (json ?? {}) as Record<string, unknown>;
  const rawGroups = listOf(json, ["comment_groups", "groups"]);
  const rawComments = listOf(json, ["atomic_comments", "comments", "atomic_rows"]);
  const rawAtt = listOf(json, ["attachments", "attachment_metadata"]);

  const invalid_rows: { index: number; reason: string }[] = [];
  let residual = 0;

  const groups: V3StageGroup[] = rawGroups.map((r) => ({
    group_id: s(pick(r, ["group_id", "Comment Group ID"])) ?? "",
    source_parent_comment_id: s(pick(r, K.parent)) ?? "",
    ocs_number: s(pick(r, ["ocs_number", "OCS Number"])),
    drawing_number: s(pick(r, K.drawing)),
    source_file_name: s(pick(r, K.fileName)),
    source_sheet: s(pick(r, K.sheet)),
    source_row: n(pick(r, K.rowIndex)),
    item_count: n(pick(r, ["item_count", "Item Count"])),
    split_status: s(pick(r, K.splitStatus)),
    group_contractor_response: s(
      pick(r, ["group_contractor_response", "Group Contractor Response"]),
    ),
    v3_ocs_number: s(pick(r, ["v3_ocs_number", "V3 OCS Number"])),
  }));

  const comments: V3StageComment[] = [];
  rawComments.forEach((r, i) => {
    const cid = s(pick(r, K.atomic));
    if (!cid) {
      invalid_rows.push({ index: i, reason: "Atomic Comment ID 누락" });
      return;
    }
    const pid = s(pick(r, K.parent)) ?? cid;
    const text = s(pick(r, K.text));
    if (countNumberMarkers(text) > 1) residual += 1;
    const numbers = arr(r["V3 ABD Numbers"] ?? r["v3_abd_numbers"]);
    const abd = numbers.length > 0 ? numbers : arr(pick(r, K.abdNumber));
    comments.push({
      source_comment_id: cid,
      source_parent_comment_id: pid,
      comment_group_id: s(pick(r, K.group)),
      atomic_item_no: n(pick(r, K.itemNo)),
      atomic_item_count: n(pick(r, K.itemCount)),
      split_status: s(pick(r, K.splitStatus)),
      comment_part: n(pick(r, K.commentPart)),
      ocs_comment: text,
      assessed_code: s(pick(r, K.assessed)),
      contractor_response: s(pick(r, K.response)),
      ocs_number: s(pick(r, K.ocsNumber)),
      drawing_number: s(pick(r, K.drawing)),
      source_file_name: s(pick(r, K.fileName)),
      source_sheet_name: s(pick(r, K.sheet)),
      source_row_index: n(pick(r, K.rowIndex)),
      abd_numbers: abd,
      // 복수 ABD 연결은 linked_multi 로 정규화한다 (다대다 링크표 대상)
      link_status: abd.length > 1 ? "linked_multi" : s(pick(r, K.linkStatus)),
      link_scope: s(pick(r, K.linkScope)),
      link_method: s(pick(r, K.linkMethod)),
      is_active: b(r["V3 Active"] ?? r["v3_active"] ?? r["is_active"], true),
      retired_reason: s(pick(r, K.retired)),
      initial_complied: b(r["V3 Initial Complied"] ?? r["v3_initial_complied"], false),
      compliance_source: s(pick(r, K.complianceSource)),
      compliance_reason: s(pick(r, K.complianceReason)),
    });
  });

  const attachments: V3StageAttachment[] = [];
  const attachment_invalid_rows: { index: number; reason: string }[] = [];
  const attIdSeen = new Set<string>();
  const attIdDup = new Set<string>();
  const attPathSeen = new Set<string>();
  const attPathDup = new Set<string>();

  rawAtt.forEach((r, i) => {
    const sid = s(pick(r, ["source_attachment_id", "Source Attachment ID"]));
    const alias = s(pick(r, ["attachment_id", "Attachment ID"]));
    if (sid && alias && sid !== alias) {
      attachment_invalid_rows.push({
        index: i,
        reason: `source_attachment_id(${sid}) 와 attachment_id(${alias}) 가 다릅니다.`,
      });
      return;
    }
    const id = sid ?? alias;
    if (!id) {
      attachment_invalid_rows.push({ index: i, reason: "source_attachment_id 누락" });
      return;
    }
    if (attIdSeen.has(id)) attIdDup.add(id);
    attIdSeen.add(id);
    // 로컬 패키징 도구 계약: storage_path 가 없으면 relative_path 를 쓰고,
    // Storage 정본 경로에서는 접두사 "images/" 를 정확히 한 번만 제거한다.
    const rawPath =
      s(pick(r, ["storage_path", "Storage Path"])) ??
      s(pick(r, ["relative_path", "Relative Path"]));
    const storagePath = rawPath
      ? rawPath.startsWith("images/")
        ? rawPath.slice("images/".length)
        : rawPath
      : null;
    if (storagePath) {
      if (attPathSeen.has(storagePath)) attPathDup.add(storagePath);
      attPathSeen.add(storagePath);
    }
    attachments.push({
      source_attachment_id: id,
      attachment_id: id,
      comment_id: s(pick(r, ["comment_id", "Comment ID"])),
      source_parent_comment_id: s(pick(r, K.parent)),
      comment_group_id: s(pick(r, ["comment_group_id", "Comment Group ID"])),
      atomic_comment_id: s(pick(r, ["atomic_comment_id", "Atomic Comment ID"])),
      attachment_scope: s(pick(r, ["attachment_scope", "Attachment Scope"])),
      storage_path: storagePath,
      content_hash:
        (s(pick(r, ["content_hash", "Content Hash", "sha256"])) ?? "").toLowerCase() || null,
      byte_size: n(pick(r, ["byte_size", "Byte Size", "size"])),
      width: n(pick(r, ["width", "width_px", "Width"])),
      height: n(pick(r, ["height", "height_px", "Height"])),
      image_format: s(pick(r, ["image_format", "Image Format"])),
      mime_type: s(pick(r, ["mime_type", "Mime Type"])),
      source_image_index: n(pick(r, ["source_image_index", "Source Image Index"])),
    });
  });

  const seen = new Set<string>();
  const dup = new Set<string>();
  const parents = new Set<string>();
  const abdSet = new Set<string>();
  let active = 0;
  let linked = 0;
  let linkedMulti = 0;
  let assoc = 0;
  for (const c of comments) {
    if (seen.has(c.source_comment_id)) dup.add(c.source_comment_id);
    seen.add(c.source_comment_id);
    parents.add(c.source_parent_comment_id);
    if (c.is_active) {
      active += 1;
      assoc += c.abd_numbers.length;
      for (const x of c.abd_numbers) abdSet.add(x);
      if (c.link_status === "linked") linked += 1;
      if (c.link_status === "linked_multi" || c.abd_numbers.length > 1) linkedMulti += 1;
    }
  }

  const scopeCounts: Record<string, number> = {};
  for (const a of attachments) {
    const k = a.attachment_scope ?? "unknown";
    scopeCounts[k] = (scopeCounts[k] ?? 0) + 1;
  }

  return {
    summary: objOf(json, ["summary"]),
    link_correction_summary: objOf(json, ["v3_link_correction_summary"]),
    payload_sha256: s(box["v3_corrected_payload_sha256"]),
    groups,
    comments,
    attachments,
    invalid_rows,
    duplicated_atomic_ids: Array.from(dup),
    source_parent_count: parents.size,
    active_count: active,
    inactive_count: comments.length - active,
    linked_count: linked,
    linked_multi_count: linkedMulti,
    abd_link_associations: assoc,
    distinct_abd_numbers: abdSet.size,
    residual_multi_marker_rows: residual,
    attachment_scope_counts: scopeCounts,
    attachment_invalid_rows,
    duplicated_attachment_ids: Array.from(attIdDup),
    duplicated_attachment_paths: Array.from(attPathDup),
  };
}

/** 4.2 — V2→V3 Delta Audit */
export function parseV3Delta(json: unknown): V3DeltaParse {
  const sum = objOf(json, ["summary", "meta", "totals"]);
  const rows = listOf(json, ["changed_parents", "changes", "delta_rows"]);
  const changedIds = new Set<string>();
  for (const r of rows) {
    const pid = s(pick(r, K.parent)) ?? s(pick(r, K.atomic));
    if (pid) changedIds.add(pid);
  }
  const g = (keys: string[]) => n(pick(sum, keys)) ?? 0;
  const v2 = g(["v2_atomic_comments", "v2_atomic", "v2_count"]);
  const v3 = g(["v3_atomic_comments", "v3_atomic", "v3_count"]);
  const parents = g(["source_parents", "source_parent_count"]);
  const changedCount = g(["changed_source_parents", "changed_parents"]) || changedIds.size;
  return {
    source_parents: parents,
    v2_atomic: v2,
    v3_atomic: v3,
    delta: g(["atomic_comment_delta", "delta"]) || v3 - v2,
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
const OPEN_STATUS = new Set(["probable", "requires_review"]);

/** 4.3 — Contractor Response Atomic Mapping */
export function parseV3ResponseMapping(json: unknown): V3ResponseParse {
  const raw = listOf(json, ["mappings", "segments", "response_segments", "response_mappings"]);
  const segments: V3StageResponse[] = [];
  const invalid_rows: { index: number; reason: string }[] = [];
  const statusCounts: Record<string, number> = {};
  const pairSeen = new Set<string>();
  let duplicateLinks = 0;

  raw.forEach((r, i) => {
    const pid = s(pick(r, K.parent));
    if (!pid) {
      invalid_rows.push({ index: i, reason: "source_parent_comment_id 누락" });
      return;
    }
    const statusRaw = (s(pick(r, K.mapStatus)) ?? "requires_review")
      .toLowerCase()
      .replace(/\s+/g, "_");
    const status = ALLOWED_STATUS.has(statusRaw) ? statusRaw : "requires_review";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const target = s(pick(r, ["atomic_comment_id", "target_atomic_comment_id"]));
    const segNo = n(pick(r, K.segNo)) ?? i + 1;
    if (target) {
      const key = `${pid}|${segNo}|${target}`;
      if (pairSeen.has(key)) duplicateLinks += 1;
      pairSeen.add(key);
    }
    segments.push({
      group_id: s(pick(r, ["comment_group_id", "group_id"])),
      source_parent_comment_id: pid,
      response_segment_no: segNo,
      response_source_label: s(pick(r, K.segLabel)),
      response_text: s(pick(r, K.segText)),
      atomic_comment_id: target,
      mapping_status: status,
      mapping_method: s(pick(r, K.mapMethod)),
      confidence_score: f(pick(r, K.score)),
      source_file_name: s(pick(r, K.fileName)),
      source_sheet: s(pick(r, K.sheet)),
      source_row: n(pick(r, K.rowIndex)),
      generic_response: b(r["generic_response"], false),
    });
  });

  const open = segments.filter((x) => OPEN_STATUS.has(x.mapping_status));
  const confirmedTargets = new Set(
    segments
      .filter((x) => x.mapping_status === "confirmed_high" && x.atomic_comment_id)
      .map((x) => x.atomic_comment_id as string),
  );

  return {
    total_raw: raw.length,
    segments,
    invalid_rows,
    reviewed_source_groups: new Set(segments.map((x) => x.source_parent_comment_id)).size,
    atomic_comments_in_groups: 0,
    status_counts: statusCounts,
    confirmed_high: statusCounts["confirmed_high"] ?? 0,
    probable: statusCounts["probable"] ?? 0,
    requires_review: statusCounts["requires_review"] ?? 0,
    duplicate_ignored: statusCounts["duplicate_ignored"] ?? 0,
    open_segments: open.length,
    open_groups: new Set(open.map((x) => x.source_parent_comment_id)).size,
    confirmed_high_unique_targets: confirmedTargets.size,
    duplicate_links: duplicateLinks,
  };
}

/** 4.4 — 최종 Import 정책 */
export function parseV3Policy(json: unknown): V3PolicyParse {
  const box = (json ?? {}) as Record<string, unknown>;
  const inputs = objOf(json, ["inputs"]);
  const decisions = objOf(json, ["decisions"]);
  const open = (decisions["open_contractor_response"] ?? {}) as Record<string, unknown>;
  const att = (decisions["group_attachments"] ?? {}) as Record<string, unknown>;
  const imp = (decisions["v3_import"] ?? {}) as Record<string, unknown>;
  const decisionsList = Array.isArray(box["group_response_decisions"])
    ? (box["group_response_decisions"] as unknown[])
    : [];
  return {
    policy_version: s(box["policy_version"]),
    generated_at: s(box["generated_at"]),
    atomic_v3_file: s(inputs["atomic_v3_file"]),
    atomic_v3_sha256: s(inputs["atomic_v3_sha256"]),
    response_mapping_file: s(inputs["response_mapping_file"]),
    response_mapping_sha256: s(inputs["response_mapping_sha256"]),
    open_segment_count: n(open["open_segment_count"] ?? open["segment_count"]) ?? 0,
    open_group_count: n(open["parent_group_count"]) ?? 0,
    group_inherited_attachment_count: n(att["group_inherited_attachment_count"]) ?? 0,
    raw_data_ocs_change_count: n(imp["raw_data_ocs_one_time_change_count"]) ?? 0,
    group_response_decisions: decisionsList.length,
  };
}

/** 4종 파일 상호 검증 — SHA-256 관문 + 수치 교차 대조 */
export function crossValidate(input: {
  atomic: V3AtomicParse | null;
  atomicHash: string | null;
  delta: V3DeltaParse | null;
  resp: V3ResponseParse | null;
  respHash: string | null;
  policy: V3PolicyParse | null;
}) {
  const { atomic, atomicHash, delta, resp, respHash, policy } = input;
  const issues: string[] = [];

  if (policy && atomicHash && policy.atomic_v3_sha256 && policy.atomic_v3_sha256 !== atomicHash) {
    issues.push(
      `Atomic V3 SHA-256 불일치 (정책 ${policy.atomic_v3_sha256.slice(0, 12)}… / 파일 ${atomicHash.slice(0, 12)}…)`,
    );
  }
  if (
    policy &&
    respHash &&
    policy.response_mapping_sha256 &&
    policy.response_mapping_sha256 !== respHash
  ) {
    issues.push(
      `Response Mapping SHA-256 불일치 (정책 ${policy.response_mapping_sha256.slice(0, 12)}… / 파일 ${respHash.slice(0, 12)}…)`,
    );
  }
  if (atomic && delta) {
    if (delta.v3_atomic && delta.v3_atomic !== atomic.comments.length)
      issues.push(`Delta v3_atomic ${delta.v3_atomic} ≠ Atomic 행 ${atomic.comments.length}`);
    if (delta.source_parents && delta.source_parents !== atomic.source_parent_count)
      issues.push(
        `Delta source_parents ${delta.source_parents} ≠ Atomic parents ${atomic.source_parent_count}`,
      );
  }
  if (resp && policy) {
    if (policy.open_segment_count && policy.open_segment_count !== resp.open_segments)
      issues.push(`Policy open segments ${policy.open_segment_count} ≠ 매핑 ${resp.open_segments}`);
    if (policy.open_group_count && policy.open_group_count !== resp.open_groups)
      issues.push(`Policy open groups ${policy.open_group_count} ≠ 매핑 ${resp.open_groups}`);
  }

  let atomicInGroups = 0;
  let missingParents = 0;
  let confirmedResolved = 0;
  let confirmedUnresolved = 0;
  if (atomic && resp) {
    const idSet = new Set(
      atomic.comments.filter((c) => c.is_active).map((c) => c.source_comment_id),
    );
    const byParent = new Map<string, number>();
    for (const c of atomic.comments)
      byParent.set(c.source_parent_comment_id, (byParent.get(c.source_parent_comment_id) ?? 0) + 1);
    for (const p of new Set(resp.segments.map((x) => x.source_parent_comment_id))) {
      const c = byParent.get(p);
      if (c === undefined) missingParents += 1;
      else atomicInGroups += c;
    }
    for (const seg of resp.segments) {
      if (seg.mapping_status !== "confirmed_high") continue;
      if (seg.atomic_comment_id && idSet.has(seg.atomic_comment_id)) confirmedResolved += 1;
      else confirmedUnresolved += 1;
    }
    if (missingParents > 0) issues.push(`매핑 부모 ${missingParents}건이 Atomic V3 에 없음`);
    if (confirmedUnresolved > 0)
      issues.push(`confirmed_high 대상 코멘트 누락 ${confirmedUnresolved}건`);
  }

  return {
    issues,
    atomic_comments_in_groups: atomicInGroups,
    missing_parents_in_v3: missingParents,
    confirmed_high_resolved: confirmedResolved,
    confirmed_high_unresolved: confirmedUnresolved,
  };
}
