import { supabase } from "@/integrations/supabase/client";
import { ABD_COLUMNS, type AbdGroupKey } from "./columns";
import { isDfActualBlocked, isDfActualField, OCS_DF_BLOCK_MESSAGE } from "./ocs-df-guard";
import {
  buildStyledWorkbook,
  saveStyledWorkbook,
  type ColumnKind,
} from "@/lib/excel/styled-workbook";

export interface ExportColumn {
  key: string;
  label: string;
}

export const DELETE_CHUNK = 200;
export const UPDATE_CHUNK = 100;

export interface BulkUpdateRequest {
  ids: string[]; // abd_items_raw.id (uuid)
  field: string;
  value: string | number | boolean | null;
}

export interface BulkUpdateResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: { id: string; message: string }[];
}

export async function applyAbdBulkUpdate(
  req: BulkUpdateRequest,
): Promise<BulkUpdateResult> {
  const { ids, field, value } = req;
  const result: BulkUpdateResult = {
    attempted: ids.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  if (ids.length === 0) return result;

  // OCS 미완료 도면은 Draft Finish 실적일을 채울 수 없다 (비우기는 허용).
  let targetIds = ids;
  if (isDfActualField(field) && value !== null && value !== "") {
    const blocked = new Set<string>();
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const slice = ids.slice(i, i + UPDATE_CHUNK);
      const { data: rows } = await (supabase as any)
        .from("abd_items_raw")
        .select(
          "id, ocs_check, ocs_total, ocs_complied," +
            [1, 2, 3]
              .flatMap((n) => [
                `r${n}_draft_start_actual`,
                `r${n}_draft_finish_actual`,
                `r${n}_submission_actual`,
                `r${n}_dar_actual`,
                `r${n}_response_result`,
              ])
              .join(","),
        )
        .in("id", slice);
      for (const r of (rows ?? []) as any[]) if (isDfActualBlocked(r, field)) blocked.add(String(r.id));
    }
    if (blocked.size > 0) {
      targetIds = ids.filter((id) => !blocked.has(id));
      result.failed += blocked.size;
      blocked.forEach((id) => result.errors.push({ id, message: OCS_DF_BLOCK_MESSAGE }));
    }
  }

  for (let i = 0; i < targetIds.length; i += UPDATE_CHUNK) {
    const slice = targetIds.slice(i, i + UPDATE_CHUNK);
    const payload: Record<string, unknown> = {
      [field]: value,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await (supabase as any)
      .from("abd_items_raw")
      .update(payload)
      .in("id", slice)
      .select("id");
    if (error) {
      result.failed += slice.length;
      slice.forEach((id) =>
        result.errors.push({ id, message: error.message }),
      );
      continue;
    }
    const okCount = (data ?? []).length;
    result.succeeded += okCount;
    result.failed += slice.length - okCount;
  }
  return result;
}

export async function applyAbdBulkHardDelete(
  ids: string[],
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const slice = ids.slice(i, i + DELETE_CHUNK);
    const { data, error } = await (supabase as any)
      .from("abd_items_raw")
      .delete()
      .in("id", slice)
      .select("id");
    if (error) {
      failed += slice.length;
      continue;
    }
    deleted += (data ?? []).length;
  }
  return { deleted, failed };
}

// ── Bulk-editable field definitions ─────────────────────────────────────
export interface BulkEditableField {
  field: string;
  label: string;
  inputType: "text" | "select" | "date" | "number";
  isPercent?: boolean;
  isBoolean?: boolean;
  options?: { value: string; label: string }[];
  group: string;
}

const GROUP_LABELS: Record<AbdGroupKey, string> = {
  identity: "Identity",
  content: "Content",
  latest: "Latest",
  round1: "Round 1",
  round2: "Round 2",
  round3: "Round 3",
  segments: "Segments",
  flags: "Flags",
  audit: "Audit",
};

/** 컬럼 정의에 editorType 이 없을 때 타입으로 에디터를 유추한다. */
function resolveAbdEditorType(c: (typeof ABD_COLUMNS)[number]): BulkEditableField["inputType"] {
  if (c.editorType) return c.editorType;
  if (c.boolish) return "select";
  if (c.type === "date") return "date";
  if (c.type === "number") return "number";
  if (c.type === "badge" && c.options?.length) return "select";
  return "text";
}

/**
 * 일괄 수정 가능한 필드 = 파생(트리거 계산) 컬럼을 제외한 모든 저장 컬럼.
 */
export function getAbdBulkEditableFields(): BulkEditableField[] {
  const out: BulkEditableField[] = [];
  for (const c of ABD_COLUMNS) {
    if (c.derived) continue;
    const inputType = resolveAbdEditorType(c);
    out.push({
      field: c.key,
      label: c.label,
      inputType,
      isBoolean: c.boolish,
      options: c.boolish
        ? [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]
        : c.options?.map((v) => ({ value: v, label: v })),
      group: GROUP_LABELS[c.group] ?? c.group,
    });
  }
  return out;
}

// ── Export helpers ──────────────────────────────────────────────────────
export function exportRowsToXlsx({
  rows,
  columns,
  fileName,
}: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
  fileName: string;
}) {
  const styled = columns.map((c) => {
    const def = ABD_COLUMNS.find((d) => d.key === c.key);
    let kind: ColumnKind = "text";
    if (def) {
      if (def.type === "date") kind = "date";
      else if (def.type === "number") kind = "number";
    }
    return { key: c.key, label: c.label, kind, widthPx: def?.width };
  });
  const wb = buildStyledWorkbook({
    title: "ABD — Selected Rows",
    columns: styled,
    rows,
    sheetName: "ABD",
    freezeCols: 1,
  });
  saveStyledWorkbook(wb, fileName);
}

function formatCell(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export async function copyRowsAsTsv({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
}): Promise<{ rowCount: number; colCount: number }> {
  const lines: string[] = [];
  lines.push(columns.map((c) => c.label).join("\t"));
  for (const r of rows) {
    lines.push(
      columns
        .map((c) =>
          String(formatCell(r[c.key]))
            .replace(/\t/g, " ")
            .replace(/\r?\n/g, " "),
        )
        .join("\t"),
    );
  }
  await navigator.clipboard.writeText(lines.join("\n"));
  return { rowCount: rows.length, colCount: columns.length };
}