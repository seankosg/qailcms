// ABD OCS — staging 재현 가능한 canonical payload digest (규칙 버전 ocs-payload-digest/1).
// 브라우저(패키지 파싱 결과)와 서버(abd_ocs_v3_stage_* 테이블)가 동일 문자열을 만들어 동일 SHA-256 을 얻는다.
// 여기에는 OCS 의미 검증이 없다. 직렬화 규칙만 정의한다.
//
// 계약 (양측 동일)
//  1) dataset 순서: groups → comments → attachments → responses
//  2) 각 dataset 필드 목록·순서: 아래 *_FIELDS 상수
//  3) 행 정렬키: 직렬화된 행 문자열의 UTF-8 hex 오름차순 (ASCII 비교 → JS/SQL 동일)
//  4) 값 인코딩: null/미기재 = "~", 그 외 = ":" + escape(값)
//  5) 빈 문자열은 null 로 정규화한다 (staging loader 의 NULLIF(...,'') 와 동일)
//  6) content_hash 만 소문자화한다 (staging loader 와 동일). 그 외 trim/대소문자 변환 없음
//  7) 숫자는 정수 텍스트, boolean 은 true/false. 숫자 ↔ 문자열 상호 변환 없음
//  8) numeric(confidence_score) 는 표현 차이 위험으로 digest 대상에서 제외한다
import { sha256Hex } from "@/lib/abd/ocs-db-parser";
import type { V3AtomicParse, V3ResponseParse } from "@/lib/abd/ocs-v3-parser";

export const PAYLOAD_DIGEST_VERSION = "ocs-payload-digest/1";

export const GROUP_FIELDS = [
  "group_id",
  "source_parent_comment_id",
  "ocs_number",
  "drawing_number",
  "source_file_name",
  "source_sheet",
  "source_row",
  "item_count",
  "split_status",
  "group_contractor_response",
  "v3_ocs_number",
] as const;

export const COMMENT_FIELDS = [
  "source_comment_id",
  "source_parent_comment_id",
  "comment_group_id",
  "atomic_item_no",
  "atomic_item_count",
  "split_status",
  "comment_part",
  "ocs_comment",
  "assessed_code",
  "contractor_response",
  "ocs_number",
  "drawing_number",
  "source_file_name",
  "source_sheet_name",
  "source_row_index",
  "abd_numbers",
  "link_status",
  "link_scope",
  "link_method",
  "is_active",
  "retired_reason",
  "initial_complied",
  "compliance_source",
  "compliance_reason",
] as const;

export const ATTACHMENT_FIELDS = [
  "source_attachment_id",
  "comment_id",
  "source_parent_comment_id",
  "comment_group_id",
  "atomic_comment_id",
  "attachment_scope",
  "storage_path",
  "content_hash",
  "byte_size",
  "width",
  "height",
  "image_format",
  "mime_type",
  "source_image_index",
] as const;

export const RESPONSE_FIELDS = [
  "group_id",
  "source_parent_comment_id",
  "response_segment_no",
  "response_source_label",
  "response_text",
  "atomic_comment_id",
  "mapping_status",
  "mapping_method",
  "source_file_name",
  "source_sheet",
  "source_row",
  "generic_response",
] as const;

export const DATASETS = ["groups", "comments", "attachments", "responses"] as const;

const US = "\u001f";

/** 값 escape — 구분자·개행·역슬래시만 치환한다. */
export function escapeValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\u001f/g, "\\x1f").replace(/\n/g, "\\n");
}

function token(v: unknown): string {
  if (v === null || v === undefined) return "~";
  if (typeof v === "boolean") return `:${v ? "true" : "false"}`;
  if (typeof v === "number") return Number.isFinite(v) ? `:${String(v)}` : "~";
  if (Array.isArray(v)) return `:${v.map((x) => escapeValue(String(x))).join("\u001e")}`;
  const s = String(v);
  return s === "" ? "~" : `:${escapeValue(s)}`;
}

function line(row: Record<string, unknown>, fields: readonly string[]): string {
  return fields.map((f) => token(row[f])).join(US);
}

const enc = new TextEncoder();
const hexOf = (s: string): string =>
  Array.from(enc.encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

function section(name: string, rows: Record<string, unknown>[], fields: readonly string[]): string {
  const lines = rows.map((r) => line(r, fields));
  lines.sort((a, b) => {
    const ha = hexOf(a);
    const hb = hexOf(b);
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
  return `#${name}\t${rows.length}\n${lines.join("\n")}\n`;
}

export type StagingPayloadCounts = {
  groups: number;
  comments: number;
  attachments: number;
  responses: number;
};

export type StagingPayloadDigest = {
  digest_version: string;
  payload_sha256: string;
  counts: StagingPayloadCounts;
};

/** 패키지 파싱 결과(교정 적용본)로부터 staging 과 동일한 canonical digest 를 만든다. */
export async function computeStagingPayloadDigest(args: {
  atomic: V3AtomicParse;
  response: V3ResponseParse;
}): Promise<StagingPayloadDigest> {
  const groups = args.atomic.groups as unknown as Record<string, unknown>[];
  const comments = args.atomic.comments as unknown as Record<string, unknown>[];
  const attachments = (args.atomic.attachments as unknown as Record<string, unknown>[]).map((a) => ({
    ...a,
    content_hash: a["content_hash"] ? String(a["content_hash"]).toLowerCase() : null,
  }));
  const responses = args.response.segments as unknown as Record<string, unknown>[];

  const text =
    `${PAYLOAD_DIGEST_VERSION}\n` +
    section("groups", groups, GROUP_FIELDS) +
    section("comments", comments, COMMENT_FIELDS) +
    section("attachments", attachments, ATTACHMENT_FIELDS) +
    section("responses", responses, RESPONSE_FIELDS);

  return {
    digest_version: PAYLOAD_DIGEST_VERSION,
    payload_sha256: await sha256Hex(text),
    counts: {
      groups: groups.length,
      comments: comments.length,
      attachments: attachments.length,
      responses: responses.length,
    },
  };
}
