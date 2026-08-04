/**
 * ABD OCS Atomic V2 어댑터 — 순수 함수만 둔다.
 *
 * 입력 1) 원자화 코멘트 JSON (OCS_Atomic_V2_DryRun.json 등)
 * 입력 2) 첨부↔코멘트 링크 JSON (OCS_Attachment_Comment_UI_Access_Links.json)
 *
 * 원본 키 표기가 파일마다 흔들리므로 별칭(alias) 목록으로 읽고,
 * 매핑되지 않은 키는 판정에 쓰지 않는다.
 */
import { canonicalJson, ocsNorm, sha256Hex } from "./ocs-db-parser";

export type OcsV2CommentRow = {
  source_comment_id: string;
  source_parent_comment_id: string;
  group_key: string;
  atomic_item_no: number | null;
  atomic_item_count: number | null;
  split_status: string;
  response_mapping_status: string;
  ocs_comment: string | null;
  assessed_code: string | null;
  contractor_response: string | null;
  comment_part: string | null;
  ocs_number: string | null;
  source_drawing_number: string | null;
  source_file_name: string | null;
  source_sheet_name: string | null;
  source_row_index: number | null;
  contractor_response_raw: string | null;
  source_row_hash: string;
};

export type OcsV2GroupRow = {
  group_key: string;
  source_parent_comment_id: string;
  ocs_number: string | null;
  source_drawing_number: string | null;
  source_file_name: string | null;
  source_sheet_name: string | null;
  source_row_index: number | null;
  atomic_item_count: number;
  contractor_response_raw: string | null;
  response_mapping_status: string;
};

export type OcsV2LinkRow = {
  source_attachment_id: string;
  source_comment_id: string;
  mapping_method: string;
  mapping_status: "confirmed" | "inherited" | "unresolved";
  sort_order: number | null;
};

export type OcsV2CommentParse = {
  total_raw: number;
  rows: OcsV2CommentRow[];
  groups: OcsV2GroupRow[];
  invalid_rows: { index: number; reason: string }[];
  duplicated_comment_ids: string[];
  single_rows: number;
  split_rows: number;
  /** 전역 DISTINCT — 배치 합산 금지, 파일 전체 기준 */
  source_parent_count: number;
  /** comment_groups 배열(또는 2건 이상 원자항목을 가진 그룹) 기준 */
  multi_group_count: number;
  /** 원자항목이 1건뿐인 부모 수 */
  single_parent_count: number;
};

export type OcsV2LinkParse = {
  total_raw: number;
  rows: OcsV2LinkRow[];
  invalid_rows: { index: number; reason: string }[];
  duplicated_pairs: number;
  distinct_attachments: number;
  distinct_comments: number;
  confirmed_high: number;
  group_inherited_access: number;
  unresolved_rows: number;
  status_counts: Record<string, number>;
};

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
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

const K = {
  comment: ["Atomic Comment ID", "atomic_comment_id", "Comment ID", "comment_id", "source_comment_id"],
  parent: [
    "Parent Comment ID",
    "parent_comment_id",
    "Source Parent Comment ID",
    "source_parent_comment_id",
    "Original Comment ID",
  ],
  group: ["Group Key", "group_key", "Comment Group Key", "comment_group_key"],
  itemNo: ["Atomic Item No", "atomic_item_no", "Item No", "item_no", "Numbered Item", "Seq"],
  itemCount: ["Atomic Item Count", "atomic_item_count", "Item Count", "item_count", "Items In Row"],
  splitStatus: ["Split Status", "split_status"],
  respStatus: ["Response Mapping Status", "response_mapping_status"],
  text: ["Atomic Comment", "atomic_comment", "OCS Comment", "ocs_comment", "Comment Text"],
  assessed: ["Assessed Code", "assessed_code"],
  response: ["Contractor Response", "contractor_response", "Mapped Response"],
  responseRaw: ["Contractor Response Raw", "contractor_response_raw", "Original Contractor Response"],
  part: ["Comment Part", "comment_part"],
  ocsNumber: ["OCS Number", "ocs_number"],
  drawing: ["ABD Drawing Number", "source_drawing_number", "Drawing Number"],
  fileName: ["Source File Name", "source_file_name"],
  sheet: ["Source Sheet", "source_sheet_name", "Source Sheet Name"],
  rowIndex: ["Source Row", "source_row_index", "Source Row Index"],
  attachment: ["Attachment ID", "attachment_id", "source_attachment_id", "Source Attachment ID"],
  mapMethod: ["Mapping Method", "mapping_method", "Link Method"],
  mapStatus: ["Mapping Status", "mapping_status", "Link Status"],
  sortOrder: ["Sort Order", "sort_order", "Image Index", "source_image_index"],
};

function rowsOf(json: unknown, extraKeys: string[] = []): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  const box = (json ?? {}) as Record<string, unknown>;
  for (const k of ["rows", "data", "items", "comments", "links", ...extraKeys]) {
    if (Array.isArray(box[k])) return box[k] as Record<string, unknown>[];
  }
  return [];
}

export function parseOcsV2CommentJson(json: unknown): OcsV2CommentParse {
  const raw = rowsOf(json, ["atomic_comments"]);
  const box = (json ?? {}) as Record<string, unknown>;
  const declaredGroups = Array.isArray(box["comment_groups"])
    ? (box["comment_groups"] as unknown[]).length
    : null;
  const rows: OcsV2CommentRow[] = [];
  const invalid_rows: { index: number; reason: string }[] = [];

  raw.forEach((r, i) => {
    const sid = s(pick(r, K.comment));
    if (!sid) {
      invalid_rows.push({ index: i, reason: "Atomic Comment ID 누락" });
      return;
    }
    const pid = s(pick(r, K.parent)) ?? sid;
    const itemNo = n(pick(r, K.itemNo));
    const itemCount = n(pick(r, K.itemCount));
    const gkey = s(pick(r, K.group)) ?? `G:${pid}`;
    rows.push({
      source_comment_id: sid,
      source_parent_comment_id: pid,
      group_key: gkey,
      atomic_item_no: itemNo,
      atomic_item_count: itemCount,
      split_status:
        s(pick(r, K.splitStatus)) ?? (sid === pid && (itemCount ?? 1) <= 1 ? "single" : "atomic"),
      response_mapping_status: s(pick(r, K.respStatus)) ?? "inherited",
      ocs_comment: s(pick(r, K.text)),
      assessed_code: s(pick(r, K.assessed)),
      contractor_response: s(pick(r, K.response)),
      comment_part: s(pick(r, K.part)),
      ocs_number: s(pick(r, K.ocsNumber)),
      source_drawing_number: s(pick(r, K.drawing)),
      source_file_name: s(pick(r, K.fileName)),
      source_sheet_name: s(pick(r, K.sheet)),
      source_row_index: n(pick(r, K.rowIndex)),
      contractor_response_raw: s(pick(r, K.responseRaw)) ?? s(pick(r, K.response)),
      source_row_hash: "",
    });
  });

  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.source_comment_id)) dup.add(r.source_comment_id);
    seen.add(r.source_comment_id);
  }

  const byGroup = new Map<string, OcsV2CommentRow[]>();
  for (const r of rows) {
    const list = byGroup.get(r.group_key) ?? [];
    list.push(r);
    byGroup.set(r.group_key, list);
  }
  const groups: OcsV2GroupRow[] = Array.from(byGroup.entries()).map(([group_key, list]) => {
    const head = list[0] as OcsV2CommentRow;
    return {
      group_key,
      source_parent_comment_id: head.source_parent_comment_id,
      ocs_number: head.ocs_number,
      source_drawing_number: head.source_drawing_number,
      source_file_name: head.source_file_name,
      source_sheet_name: head.source_sheet_name,
      source_row_index: head.source_row_index,
      atomic_item_count: head.atomic_item_count ?? list.length,
      contractor_response_raw: head.contractor_response_raw,
      response_mapping_status: list.some((x) => x.response_mapping_status === "mapped")
        ? "mapped"
        : list.some((x) => x.response_mapping_status === "inherited")
          ? "inherited"
          : "unmapped",
    };
  });

  const single = rows.filter((r) => r.source_comment_id === r.source_parent_comment_id).length;

  const byParent = new Map<string, number>();
  for (const r of rows) byParent.set(r.source_parent_comment_id, (byParent.get(r.source_parent_comment_id) ?? 0) + 1);
  const single_parent_count = Array.from(byParent.values()).filter((c) => c === 1).length;
  const multi_derived = Array.from(byParent.values()).filter((c) => c > 1).length;

  return {
    total_raw: raw.length,
    rows,
    groups,
    invalid_rows,
    duplicated_comment_ids: Array.from(dup),
    single_rows: single,
    split_rows: rows.length - single,
    source_parent_count: byParent.size,
    multi_group_count: declaredGroups ?? multi_derived,
    single_parent_count,
  };
}

export function parseOcsV2LinkJson(json: unknown): OcsV2LinkParse {
  const raw = rowsOf(json, ["attachment_links", "ui_access_links"]);
  const rows: OcsV2LinkRow[] = [];
  const invalid_rows: { index: number; reason: string }[] = [];
  const seen = new Set<string>();
  let dup = 0;
  const statusCounts: Record<string, number> = {};

  raw.forEach((r, i) => {
    const said = s(pick(r, K.attachment));
    const scid = s(pick(r, K.comment));
    if (!said || !scid) {
      invalid_rows.push({ index: i, reason: "Attachment ID 또는 Comment ID 누락" });
      return;
    }
    const key = `${said}|${scid}`;
    if (seen.has(key)) {
      dup += 1;
      return;
    }
    seen.add(key);
    const st = (s(pick(r, K.mapStatus)) ?? "confirmed").toLowerCase();
    statusCounts[st] = (statusCounts[st] ?? 0) + 1;
    rows.push({
      source_attachment_id: said,
      source_comment_id: scid,
      mapping_method: s(pick(r, K.mapMethod)) ?? "ui_access_link",
      mapping_status: st.includes("inherit")
        ? "inherited"
        : st.includes("unresolved")
          ? "unresolved"
          : "confirmed",
      sort_order: n(pick(r, K.sortOrder)),
    });
  });

  return {
    total_raw: raw.length,
    rows,
    invalid_rows,
    duplicated_pairs: dup,
    distinct_attachments: new Set(rows.map((r) => r.source_attachment_id)).size,
    distinct_comments: new Set(rows.map((r) => r.source_comment_id)).size,
    confirmed_high: rows.filter((r) => r.mapping_status === "confirmed").length,
    group_inherited_access: rows.filter((r) => r.mapping_status === "inherited").length,
    unresolved_rows: rows.filter((r) => r.mapping_status === "unresolved").length,
    status_counts: statusCounts,
  };
}

/** 원자 코멘트 canonical JSON 의 SHA-256 을 각 행에 채운다. */
export async function attachV2RowHashes(rows: OcsV2CommentRow[]): Promise<OcsV2CommentRow[]> {
  const out: OcsV2CommentRow[] = [];
  for (const r of rows) {
    const { source_row_hash: _drop, ...rest } = r;
    out.push({ ...r, source_row_hash: await sha256Hex(canonicalJson(rest)) });
  }
  return out;
}

export { ocsNorm };
