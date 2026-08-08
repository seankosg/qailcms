// 임포트 시 필드 단위 로그를 만들기 위한 공용 헬퍼.
import { dohaDateOnly } from "@/lib/time/doha";

export type FieldLogOutcome =
  | "applied"
  | "unchanged"
  | "derived"
  | "auto_filled"
  | "corrected"
  | "skipped_empty"
  | "skipped_clear_blocked"
  | "skipped_no_permission"
  | "rejected_invalid"
  | "rejected_conflict"
  | "info";

export type FieldLogKind = "task_management" | "defect" | "abd" | "spl";

export interface PendingFieldLog {
  upload_id?: string;
  kind: FieldLogKind;
  raw_row_no: number | null;
  field_name: string;
  outcome: FieldLogOutcome;
  raw_value: string | null;
  applied_value: string | null;
  previous_value: string | null;
  reason_code: string | null;
  reason_detail: string | null;
}

export const stringifyForLog = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  // T-4: 로그 표시용 날짜도 도하 wall-clock 기준(하루 밀림 방지).
  if (v instanceof Date) return dohaDateOnly(v);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

export const valuesEqual = (a: unknown, b: unknown): boolean => {
  const sa = stringifyForLog(a);
  const sb = stringifyForLog(b);
  if (sa === null && sb === null) return true;
  if (sa === null || sb === null) return false;
  return sa.trim() === sb.trim();
};

export interface BuildFieldLogArgs {
  rawRowNo: number | null;
  field: string;
  outcome: FieldLogOutcome;
  raw?: unknown;
  applied?: unknown;
  previous?: unknown;
  code?: string | null;
  detail?: string | null;
}

export const buildFieldLog = (
  kind: FieldLogKind,
  a: BuildFieldLogArgs,
): PendingFieldLog => ({
  kind,
  raw_row_no: a.rawRowNo,
  field_name: a.field,
  outcome: a.outcome,
  raw_value: stringifyForLog(a.raw),
  applied_value: stringifyForLog(a.applied),
  previous_value: stringifyForLog(a.previous),
  reason_code: a.code ?? null,
  reason_detail: a.detail ?? null,
});

/** 입력값과 기존값을 비교. 'applied'(변경), 'unchanged'(동일), 'empty'(둘 다 빈값) 반환 */
export const classifyChange = (
  incoming: unknown,
  existing: unknown,
): "applied" | "unchanged" | "empty" => {
  const inE = incoming === null || incoming === undefined || incoming === "";
  const exE = existing === null || existing === undefined || existing === "";
  if (inE && exE) return "empty";
  if (valuesEqual(incoming, existing)) return "unchanged";
  return "applied";
};

export interface FlushFieldLogsResult {
  ok: boolean;
  attempted: number;
  persisted: number;
  error: string | null;
}

/** import_field_logs로 chunk 삽입. 실패해도 예외를 던지지 않고 결과를 반환한다(호출자가 판정). */
export async function flushFieldLogs(
  supabase: any,
  uploadId: string,
  userId: string | null | undefined,
  logs: PendingFieldLog[],
  chunkSize = 1000,
): Promise<FlushFieldLogsResult> {
  if (!uploadId || logs.length === 0)
    return { ok: true, attempted: logs.length, persisted: 0, error: null };
  const rows = logs.map((b) => ({
    upload_id: uploadId,
    kind: b.kind,
    raw_row_no: b.raw_row_no,
    field_name: b.field_name,
    outcome: b.outcome,
    raw_value: b.raw_value,
    applied_value: b.applied_value,
    previous_value: b.previous_value,
    reason_code: b.reason_code,
    reason_detail: b.reason_detail,
    created_by: userId ?? null,
  }));
  let persisted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("import_field_logs").insert(slice);
    if (error) {
      console.warn("[import_field_logs] insert failed", error);
      return {
        ok: false,
        attempted: rows.length,
        persisted,
        error: error.message ?? String(error),
      };
    }
    persisted += slice.length;
  }
  return { ok: true, attempted: rows.length, persisted, error: null };
}