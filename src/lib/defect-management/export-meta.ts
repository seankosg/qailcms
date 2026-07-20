import { dohaDateTime } from "@/lib/time/doha";
import type { DefectServerFilter, DefectServerSort } from "@/hooks/useDefectItems";
import { DEFECT_COLUMNS } from "./columns";

// ── SHAW-style summary helpers ports ────────────────────────────────────────
// Mirrors src/lib/defect-excel-export.ts from `SHAW PROJECT CMS`.

const URL_PARAM_LABELS: Record<string, string> = {
  team: "Team",
  subcontractor: "Subcontractor",
  subsub: "Sub-Sub",
  hdecPic: "HDEC PIC",
  hdecEng: "HDEC Engineer",
  level: "Level",
  mainTrade: "Main Trade",
  subTrade: "Sub Trade",
  workType: "Work Type",
  classificationSource: "Classification",
  status: "Status",
  closureStatus: "Closure Status",
  issueNo: "Issue No",
  subcontractorIssueNo: "Subcontractor Issue No",
  priority: "Priority",
  hdecVerification: "HDEC Verification",
  building: "Building",
  roomGroup: "Room Group",
};

const FLAG_LABELS: Record<string, string> = {
  overdue: "Overdue",
  atRisk: "At-Risk",
  actualComplete: "Actual Rectified",
  closureComplete: "Closure Done",
  stage: "Stage",
  critical: "Critical",
};

function labelFor(field: string): string {
  const col = DEFECT_COLUMNS.find((c) => c.key === field);
  return col?.label ?? field;
}

export function inferSourceLabel(
  urlSearch: Record<string, unknown>,
  tab: string,
  includeInactive: boolean,
): string {
  const parts: string[] = [`Tab: ${tab}`];
  if (includeInactive) parts.push("include Inactive");
  for (const [key, label] of Object.entries(URL_PARAM_LABELS)) {
    const value = urlSearch[key];
    if (value == null || value === "") continue;
    parts.push(`${label}: ${String(value)}`);
  }
  for (const [key, label] of Object.entries(FLAG_LABELS)) {
    const value = urlSearch[key];
    if (value) parts.push(`${label}=${String(value)}`);
  }
  const dateField = urlSearch["dateField"] as string | undefined;
  const dateStart = urlSearch["dateStart"] as string | undefined;
  const dateEnd = urlSearch["dateEnd"] as string | undefined;
  if (dateField || dateStart || dateEnd) {
    const fieldLabel = dateField ? labelFor(dateField) : "Date";
    const range =
      `${dateStart || ""}${dateStart && dateEnd ? " → " : ""}${dateEnd || ""}` || "(any)";
    parts.push(`${fieldLabel}: ${range}`);
  }
  return `Snag Raw Data → ${parts.join(" · ")}`;
}

export function summarizeServerFilters(filters: DefectServerFilter[]): string {
  if (!filters.length) return "(none)";
  const parts: string[] = [];
  for (const f of filters) {
    const name = labelFor(f.column);
    const v = f.value as any;
    if (f.op === "in" && Array.isArray(v)) {
      if (!v.length) continue;
      parts.push(`${name}=[${v.join(", ")}]`);
    } else if (f.op === "text" && typeof v === "string" && v.trim()) {
      parts.push(`${name}="${v}"`);
    } else if (f.op === "empty") {
      parts.push(`${name}=(Empty)`);
    } else if (f.op === "date_range" && v && typeof v === "object") {
      parts.push(`${name}=${v.from || ""}${v.from && v.to ? "→" : ""}${v.to || ""}`);
    } else if (f.op === "num_range" && v && typeof v === "object") {
      parts.push(`${name}=${v.min ?? ""}${v.min != null && v.max != null ? "→" : ""}${v.max ?? ""}`);
    } else if (f.op === "bool") {
      parts.push(`${name}=${v ? "true" : "false"}`);
    } else if (v != null) {
      parts.push(`${name}=${String(v)}`);
    }
  }
  return parts.length ? parts.join(" · ") : "(none)";
}

export function summarizeServerSort(sort: DefectServerSort[]): string {
  if (!sort.length) return "(default)";
  return sort.map((s) => `${labelFor(s.column)} ${s.desc ? "↓" : "↑"}`).join(", ");
}

export interface DefectExportMeta {
  userName: string;
  userType: string;
}

export interface BuildHeaderBlockInput {
  format: "view" | "reimport";
  meta: DefectExportMeta;
  sourceLabel: string;
  search: string;
  filterSummary: string;
  sortSummary: string;
  sourceSuffix?: string;
}

export const REIMPORT_MARKER = "[Format: QAIL_SNAG_REIMPORT_V1]";

export function buildDefectHeaderBlock(input: BuildHeaderBlockInput): {
  title: string;
  metaRows: [string, string, string, string, string];
} {
  const exportedTs = dohaDateTime();
  const formatLabel =
    input.format === "reimport" ? `Re-import ready  ${REIMPORT_MARKER}` : "View-friendly";
  const source = input.sourceSuffix
    ? `${input.sourceLabel} · ${input.sourceSuffix}`
    : input.sourceLabel;
  const searchLabel = input.search?.trim() ? `"${input.search.trim()}"` : "(none)";
  return {
    title: `Snag List — Raw Data Export  (${formatLabel})`,
    metaRows: [
      `Exported: ${exportedTs}  by  ${input.meta.userName}${input.meta.userType ? ` (${input.meta.userType})` : ""}`,
      `Source: ${source}`,
      `Search: ${searchLabel}`,
      `Filters: ${input.filterSummary}`,
      `Sort: ${input.sortSummary}`,
    ],
  };
}

// Date / datetime field lists reused by the export writer to emit real Excel
// date serials for these keys.
export const DEFECT_DATE_FIELDS = [
  "data_date",
  "planned_start_date",
  "planned_rectified_date",
  "planned_closure_date",
  "actual_start_date",
  "actual_rectified_date",
  "actual_closure_date",
  "classified_at",
];

export const DEFECT_DATETIME_FIELDS = ["created_at", "updated_at"];