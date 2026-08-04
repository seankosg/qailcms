/**
 * OCS 코멘트 원본(`OCS_Final_DB_Data.json`) 어댑터 — Stage B.
 *
 * 순수 함수만 둔다. UI(dry-run 표시)와 서버 입력 validator 가 동일 계약을 사용한다.
 * 원본 키를 그대로 읽고, 매핑되지 않은 나머지 키는 손실 없이 `source_extra` 로 보존한다.
 */
export type OcsCommentRow = {
  source_comment_id: string;
  ocs_number: string | null;
  ocs_number_norm: string | null;
  source_drawing_number: string | null;
  drawing_number_norm: string | null;
  ocs_sn: string | null;
  file_revision: string | null;
  comment_revision: string | null;
  comment_part: string | null;
  ocs_comment: string | null;
  assessed_code: string | null;
  contractor_response: string | null;
  sign_off_status: string | null;
  source_file_name: string | null;
  source_sheet_name: string | null;
  source_row_index: number | null;
  source_file_hash: string | null;
  source_modified_at: string | null;
  source_imported_at: string | null;
  validation_note: string | null;
  discipline: string | null;
  service: string | null;
  plot: string | null;
  project: string | null;
  source_extra: Record<string, unknown>;
  /** canonical JSON SHA-256 — unchanged/updated 판정용 (계산 후 채움) */
  source_row_hash: string;
};

export type OcsCommentParse = {
  total_raw: number;
  rows: OcsCommentRow[];
  duplicated_comment_ids: string[];
  missing_comment_id: number;
  invalid_rows: { index: number; reason: string }[];
};

/** DB 정본 `public.abd_ocs_norm` 과 동일 규칙: 대문자화 + 모든 공백 제거 + 하이픈 유지 */
export function ocsNorm(v: string | null | undefined): string | null {
  if (v == null) return null;
  const out = String(v).replace(/\s+/g, "").toUpperCase();
  return out === "" ? null : out;
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
function iso(v: unknown): string | null {
  const raw = s(v);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const MAPPED_KEYS = [
  "Comment ID",
  "OCS Number",
  "ABD Drawing Number",
  "OCS S/N",
  "OCS File Revision Raw",
  "OCS File Revision",
  "Comment Revision",
  "Comment Part",
  "OCS Comment",
  "Assessed Code",
  "Contractor Response",
  "Sign-Off Status",
  "Source File Name",
  "Source Sheet",
  "Source Row",
  "File Hash",
  "Source Modified At",
  "Imported At",
  "Validation Note",
  "Discipline",
  "Service",
  "Plot",
  "Project",
] as const;

/** canonical JSON: 키 사전순 직렬화 (source_row_hash 산출 입력) */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const buf = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", buf as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hashInput(row: OcsCommentRow): Record<string, unknown> {
  const { source_row_hash: _ignored, ...rest } = row;
  return rest as Record<string, unknown>;
}

/** 구조 검사 + 필드 매핑. 해시는 `attachRowHashes` 로 별도 계산한다. */
export function parseOcsCommentJson(json: unknown): OcsCommentParse {
  const box = (json ?? {}) as Record<string, unknown>;
  const raw = (Array.isArray(json) ? json : (box["rows"] ?? [])) as Record<string, unknown>[];
  const invalid_rows: { index: number; reason: string }[] = [];
  const rows: OcsCommentRow[] = [];
  let missing_comment_id = 0;

  raw.forEach((r, i) => {
    const source_comment_id = s(r?.["Comment ID"]);
    if (!source_comment_id) {
      missing_comment_id += 1;
      invalid_rows.push({ index: i, reason: "Comment ID 누락" });
      return;
    }
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r ?? {})) {
      if (!(MAPPED_KEYS as readonly string[]).includes(k)) extra[k] = v;
    }
    const ocs_number = s(r?.["OCS Number"]);
    const source_drawing_number = s(r?.["ABD Drawing Number"]);
    rows.push({
      source_comment_id,
      ocs_number,
      ocs_number_norm: ocsNorm(ocs_number),
      source_drawing_number,
      drawing_number_norm: ocsNorm(source_drawing_number),
      ocs_sn: s(r?.["OCS S/N"]),
      file_revision: s(r?.["OCS File Revision Raw"]) ?? s(r?.["OCS File Revision"]),
      comment_revision: s(r?.["Comment Revision"]),
      comment_part: s(r?.["Comment Part"]),
      ocs_comment: s(r?.["OCS Comment"]),
      assessed_code: s(r?.["Assessed Code"]),
      contractor_response: s(r?.["Contractor Response"]),
      sign_off_status: s(r?.["Sign-Off Status"]),
      source_file_name: s(r?.["Source File Name"]),
      source_sheet_name: s(r?.["Source Sheet"]),
      source_row_index: n(r?.["Source Row"]),
      source_file_hash: s(r?.["File Hash"]),
      source_modified_at: iso(r?.["Source Modified At"]),
      source_imported_at: iso(r?.["Imported At"]),
      validation_note: s(r?.["Validation Note"]),
      discipline: s(r?.["Discipline"]),
      service: s(r?.["Service"]),
      plot: s(r?.["Plot"]),
      project: s(r?.["Project"]),
      source_extra: extra,
      source_row_hash: "",
    });
  });

  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.source_comment_id)) dup.add(r.source_comment_id);
    seen.add(r.source_comment_id);
  }

  return {
    total_raw: raw.length,
    rows,
    duplicated_comment_ids: Array.from(dup),
    missing_comment_id,
    invalid_rows,
  };
}

/** 정본 source 필드 canonical JSON 의 SHA-256 을 각 행에 채운다. */
export async function attachRowHashes(rows: OcsCommentRow[]): Promise<OcsCommentRow[]> {
  const out: OcsCommentRow[] = [];
  for (const r of rows) out.push({ ...r, source_row_hash: await sha256Hex(canonicalJson(hashInput(r))) });
  return out;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
