import { supabase } from "@/integrations/supabase/client";
import {
  SPARE_PART_COLUMNS,
  APPROVAL_CODES,
  type SparePartColumnDef,
} from "./columns";

export type BulkEditInputType =
  | "select"
  | "date"
  | "text"
  | "textarea"
  | "boolean"
  | "number";

export interface BulkEditableField {
  /** DB 컬럼명 (spare_parts_raw) */
  field: string;
  /** UI 표시 라벨 */
  label: string;
  /** 입력 컨트롤 종류 */
  inputType: BulkEditInputType;
  /** select 옵션 */
  options?: { value: string; label: string }[];
  /** 필드 피커에서 사용할 그룹명 */
  group: string;
}

export interface BulkUpdateRequest {
  /** 업데이트할 doc_ref 배열 */
  ids: string[];
  field: string;
  value: string | number | boolean | null;
  extraUpdates?: Record<string, string | number | boolean | null>;
}

export interface BulkUpdateResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: { id: string; message: string }[];
}

/** SHAW 스타일 chunk 크기. Apply / Delete 공용. */
export const BULK_CHUNK_ROWS = 500;
const UPDATE_CHUNK = 100;

export function chunkArray<T>(arr: T[], size = BULK_CHUNK_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 라벨용 그룹명 사전 */
const GROUP_LABELS: Record<SparePartColumnDef["group"], string> = {
  id: "Identification",
  approval: "Approval",
  vendor: "Vendor",
  qty: "Quantity",
  cost: "Cost",
  delivery: "Delivery",
  avail: "Availability",
  spl: "SPL",
  stage: "Procurement Stage",
  issue: "Issue",
  remark: "Remarks",
  system: "System",
};

/** 자동 계산되거나 편집 부적절한 컬럼 — Bulk Edit 대상에서 제외 */
const EXCLUDED: ReadonlySet<string> = new Set([
  "doc_ref",
  "rfq_progress",
  "quotation_progress",
  "po_progress",
  "delivery_progress",
]);

/** 긴 텍스트로 취급할 필드 (textarea 팝오버) */
const TEXTAREA_FIELDS: ReadonlySet<string> = new Set([
  "remarks",
  "proc_remarks",
  "action",
  "physical_remarks",
  "doc_others",
  "approval_status",
]);

function toInputType(c: SparePartColumnDef): BulkEditInputType {
  if (c.type === "boolean") return "boolean";
  if (c.type === "date") return "date";
  if (c.type === "number" || c.type === "cost") return "number";
  if (c.type === "badge") return "select";
  if (TEXTAREA_FIELDS.has(c.key)) return "textarea";
  return "text";
}

function optionsFor(c: SparePartColumnDef): { value: string; label: string }[] | undefined {
  if (c.key === "approval_code") return APPROVAL_CODES.map((v) => ({ value: v, label: v }));
  if (c.key === "plot") return ["C", "D"].map((v) => ({ value: v, label: v }));
  return undefined;
}

/** SPARE_PART_COLUMNS로부터 그룹별 Bulk Edit 대상 필드 목록을 생성 */
export function getBulkEditableFields(): BulkEditableField[] {
  const out: BulkEditableField[] = [];
  for (const c of SPARE_PART_COLUMNS) {
    if (EXCLUDED.has(c.key)) continue;
    out.push({
      field: c.key,
      label: c.label,
      inputType: toInputType(c),
      options: optionsFor(c),
      group: GROUP_LABELS[c.group] ?? c.group,
    });
  }
  return out;
}

/**
 * Bulk update — spare_parts_raw 대상.
 * SHAW의 applyBulkUpdate 최소 구현: chunk 단위 update, 로그 없음.
 */
export async function applyBulkUpdate(req: BulkUpdateRequest): Promise<BulkUpdateResult> {
  const { ids, field, value, extraUpdates } = req;
  const result: BulkUpdateResult = { attempted: ids.length, succeeded: 0, failed: 0, errors: [] };
  if (ids.length === 0) return result;

  const payload: Record<string, unknown> = { [field]: value, ...(extraUpdates ?? {}) };

  for (const slice of chunkArray(ids, UPDATE_CHUNK)) {
    const { data, error } = await (supabase as any)
      .from("spare_parts_raw")
      .update(payload)
      .in("doc_ref", slice)
      .select("doc_ref");
    if (error) {
      result.failed += slice.length;
      slice.forEach((id) => result.errors.push({ id, message: error.message }));
      continue;
    }
    const okCount = (data ?? []).length;
    result.succeeded += okCount;
    result.failed += slice.length - okCount;
  }
  return result;
}