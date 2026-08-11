import { streamXlsxExport, type StreamExportColumn } from "@/lib/excel/stream-export";
import type { SplOcsComment, SplRspItem } from "@/lib/spl/ocs.functions";

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "").replace(/-/g, "");
const yn = (v: boolean) => (v ? "Yes" : "No");
const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");

const OCS_COLUMNS: StreamExportColumn[] = [
  { key: "ocs_number", label: "OCS No." },
  { key: "revision", label: "Rev." },
  { key: "sn", label: "S/N" },
  { key: "doc_revision", label: "Doc Rev." },
  { key: "atomic_item_no", label: "Item No." },
  { key: "comment_text", label: "Comment" },
  { key: "contractor_response", label: "Contractor Response" },
  { key: "assessed_code", label: "Assessed Code" },
  { key: "sign_off_status", label: "Sign-off Status" },
  { key: "complied", label: "Complied" },
  { key: "complied_by_name", label: "Complied By" },
  { key: "complied_at", label: "Complied At" },
  { key: "is_resolved", label: "Resolved" },
  { key: "resolved_reason", label: "Resolved Reason" },
  { key: "categories", label: "Categories" },
  { key: "rsp_links", label: "Linked RSP" },
  { key: "attachment_count", label: "Attachments" },
  { key: "source_file", label: "Source File" },
  { key: "source_sheet", label: "Source Sheet" },
  { key: "source_row", label: "Source Row" },
  { key: "is_user_created", label: "User Added" },
];

const OCS_WIDTHS: Record<string, number> = {
  ocs_number: 18,
  revision: 8,
  sn: 8,
  doc_revision: 10,
  atomic_item_no: 9,
  comment_text: 70,
  contractor_response: 50,
  assessed_code: 14,
  sign_off_status: 16,
  complied: 10,
  complied_by_name: 16,
  complied_at: 18,
  is_resolved: 10,
  resolved_reason: 28,
  categories: 24,
  rsp_links: 24,
  attachment_count: 12,
  source_file: 34,
  source_sheet: 18,
  source_row: 10,
  is_user_created: 11,
};

/** SPL OCS 코멘트를 Raw Data 형식(1행 = 1코멘트) XLSX 로 내려받는다. */
export async function exportSplOcsXlsx(splNumber: string, rows: SplOcsComment[], scopeLabel: string) {
  const data = rows.map((c) => ({
    ocs_number: c.ocs_number ?? "",
    revision: c.revision ?? "",
    sn: c.sn ?? "",
    doc_revision: c.doc_revision ?? "",
    atomic_item_no: c.atomic_item_no ?? "",
    comment_text: c.comment_text ?? "",
    contractor_response: c.contractor_response ?? "",
    assessed_code: c.assessed_code ?? "",
    sign_off_status: c.sign_off_status ?? "",
    complied: yn(c.complied),
    complied_by_name: c.complied_by_name ?? "",
    complied_at: c.complied_at ?? "",
    is_resolved: yn(c.is_resolved),
    resolved_reason: c.resolved_reason ?? "",
    categories: c.categories.map((x) => x.label).join(", "),
    rsp_links: c.rsp_links.map((x) => x.rsp_number).join(", "),
    attachment_count: c.attachments.length,
    source_file: c.source_file?.file_name ?? "",
    source_sheet: c.source_sheet ?? "",
    source_row: c.source_row ?? "",
    is_user_created: yn(c.is_user_created),
  }));

  await streamXlsxExport({
    filename: `SPL_OCS_${safe(splNumber)}_${stamp()}.xlsx`,
    sheetName: "OCS Comments",
    columns: OCS_COLUMNS,
    columnWidths: OCS_WIDTHS,
    datetimeFields: ["complied_at"],
    header: {
      title: `SPL OCS Comments — ${splNumber}`,
      metaRows: [
        `Exported: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Qatar" })} (Doha)`,
        `Source: SPL Raw Data / OCS panel`,
        `SPL Number: ${splNumber}`,
        `Scope: ${scopeLabel}`,
        `Rows: ${data.length}`,
      ],
      freezeCols: 3,
    },
    fetchPage: async (offset, limit) => ({
      rows: data.slice(offset, offset + limit),
      total: data.length,
    }),
  });
}

const RSP_COLUMNS: StreamExportColumn[] = [
  { key: "rsp_number", label: "RSP No." },
  { key: "description", label: "Description" },
  { key: "manufacturer", label: "Manufacturer" },
  { key: "model_or_unique_id", label: "Model / Unique ID" },
  { key: "unit", label: "Unit" },
  { key: "qty_required", label: "Qty Required" },
  { key: "qty_available", label: "Qty Available" },
  { key: "qty_short", label: "Qty Short" },
  { key: "ocs_links", label: "Linked OCS" },
  { key: "source_sheet", label: "Source Sheet" },
  { key: "source_row", label: "Source Row" },
  { key: "is_user_created", label: "User Added" },
];

const RSP_WIDTHS: Record<string, number> = {
  rsp_number: 18,
  description: 60,
  manufacturer: 24,
  model_or_unique_id: 26,
  unit: 10,
  qty_required: 13,
  qty_available: 13,
  qty_short: 11,
  ocs_links: 26,
  source_sheet: 18,
  source_row: 10,
  is_user_created: 11,
};

/** SPL RSP 항목을 Raw Data 형식(1행 = 1부품) XLSX 로 내려받는다. */
export async function exportSplRspXlsx(splNumber: string, rows: SplRspItem[], scopeLabel: string) {
  const data = rows.map((r) => ({
    rsp_number: r.rsp_number,
    description: r.description ?? "",
    manufacturer: r.manufacturer ?? "",
    model_or_unique_id: r.model_or_unique_id ?? "",
    unit: r.unit ?? "",
    qty_required: r.qty_required ?? "",
    qty_available: r.qty_available ?? "",
    qty_short: r.qty_short ?? "",
    ocs_links: r.ocs_links
      .map((l) => [l.ocs_number, l.sn ? `S/N ${l.sn}` : null].filter(Boolean).join(" "))
      .join(", "),
    source_sheet: r.source_sheet ?? "",
    source_row: r.source_row ?? "",
    is_user_created: yn(r.is_user_created),
  }));

  await streamXlsxExport({
    filename: `SPL_RSP_${safe(splNumber)}_${stamp()}.xlsx`,
    sheetName: "Recommended Spare Parts",
    columns: RSP_COLUMNS,
    columnWidths: RSP_WIDTHS,
    numFmtByKey: { qty_required: "#,##0.##", qty_available: "#,##0.##", qty_short: "#,##0.##" },
    header: {
      title: `SPL Recommended Spare Parts — ${splNumber}`,
      metaRows: [
        `Exported: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Qatar" })} (Doha)`,
        `Source: SPL Raw Data / RSP panel`,
        `SPL Number: ${splNumber}`,
        `Scope: ${scopeLabel}`,
        `Rows: ${data.length}`,
      ],
      freezeCols: 2,
    },
    fetchPage: async (offset, limit) => ({
      rows: data.slice(offset, offset + limit),
      total: data.length,
    }),
  });
}
