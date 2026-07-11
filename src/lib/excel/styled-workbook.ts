// Shared styled Excel workbook builder — SHAW Defect Raw Data export parity.
// Adds a title banner, meta block, styled header row, bordered data cells,
// auto column widths, frozen panes, and real Excel date cells.

import XLSX from "xlsx-js-style";

// ---------------------------------------------------------------------------
// Date helpers (mirrors SHAW excel-date-cell.ts)
// ---------------------------------------------------------------------------

export const DATE_NUMFMT = "dd-mmm";
export const DATETIME_NUMFMT = "dd-mmm-yyyy hh:mm";

export function isoToExcelSerial(iso: string | null | undefined): number | null {
  if (iso == null) return null;
  const s = String(iso).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const utc = Date.UTC(y, mo - 1, d);
  const epoch = Date.UTC(1899, 11, 30);
  const days = Math.round((utc - epoch) / 86400000);
  if (!Number.isFinite(days) || days <= 0) return null;
  return days;
}

export function isoTimestampToExcelSerial(iso: string | null | undefined): number | null {
  if (iso == null) return null;
  const s = String(iso).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const v = (t - epoch) / 86400000;
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------

const FONT_NAME = "Calibri";

export const STYLE_TITLE = {
  font: { name: FONT_NAME, sz: 14, bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: "FF1E3A5F" } },
  alignment: { vertical: "center", horizontal: "left" },
} as const;

export const STYLE_META_LABEL = {
  font: { name: FONT_NAME, sz: 10, bold: true, color: { rgb: "FF374151" } },
  fill: { fgColor: { rgb: "FFF3F4F6" } },
  alignment: { vertical: "center", horizontal: "left" },
} as const;

export const STYLE_META_VALUE = {
  font: { name: FONT_NAME, sz: 10, color: { rgb: "FF111827" } },
  fill: { fgColor: { rgb: "FFF3F4F6" } },
  alignment: { vertical: "center", horizontal: "left", wrapText: true },
} as const;

export const STYLE_HEADER = {
  font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: "FF334155" } },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: {
    top: { style: "thin", color: { rgb: "FF1F2937" } },
    bottom: { style: "thin", color: { rgb: "FF1F2937" } },
    left: { style: "thin", color: { rgb: "FF1F2937" } },
    right: { style: "thin", color: { rgb: "FF1F2937" } },
  },
} as const;

export const STYLE_DATA = {
  font: { name: FONT_NAME, sz: 10, color: { rgb: "FF111827" } },
  alignment: { vertical: "center", horizontal: "left" },
  border: {
    top: { style: "thin", color: { rgb: "FFE5E7EB" } },
    bottom: { style: "thin", color: { rgb: "FFE5E7EB" } },
    left: { style: "thin", color: { rgb: "FFE5E7EB" } },
    right: { style: "thin", color: { rgb: "FFE5E7EB" } },
  },
} as const;

// ---------------------------------------------------------------------------
// Cell writers
// ---------------------------------------------------------------------------

function setCell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  value: unknown,
  style: Record<string, unknown>,
) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const v = value == null ? "" : value;
  if (typeof v === "number" && Number.isFinite(v)) {
    ws[addr] = { t: "n", v, s: style };
  } else if (typeof v === "boolean") {
    ws[addr] = { t: "s", v: v ? "Yes" : "No", s: style };
  } else {
    ws[addr] = { t: "s", v: String(v), s: style };
  }
}

function setDateCell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  serial: number,
  style: Record<string, unknown>,
  numFmt: string,
) {
  const addr = XLSX.utils.encode_cell({ r, c });
  ws[addr] = { t: "n", v: serial, z: numFmt, s: { ...style, numFmt } };
}

// ---------------------------------------------------------------------------
// Column type/width descriptor
// ---------------------------------------------------------------------------

export type ColumnKind = "text" | "number" | "date" | "datetime" | "boolean";

export interface StyledColumn {
  key: string;
  label: string;
  kind?: ColumnKind;
  /** px width from column config; converted to Excel wch (chars) */
  widthPx?: number;
}

function pxToWch(px: number | undefined, fallbackLabel: string): number {
  const base = px && Number.isFinite(px) ? Math.round(px / 7) : Math.max(10, fallbackLabel.length + 2);
  return Math.max(8, Math.min(60, base));
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface StyledSheetOptions {
  title: string;
  /** Extra meta lines rendered under the title (e.g. Exported / Source / Filters). */
  metaLines?: string[];
  columns: StyledColumn[];
  rows: Record<string, unknown>[];
  sheetName?: string;
  /** Freeze N left columns (default: 1). */
  freezeCols?: number;
  /** User info shown in the meta banner. */
  meta?: { userName?: string; note?: string };
}

export function buildStyledWorkbook(opts: StyledSheetOptions): XLSX.WorkBook {
  const { title, columns, rows, sheetName = "Sheet1", freezeCols = 1, meta } = opts;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const exportedTs = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const banner: string[] = [
    `Exported: ${exportedTs}${meta?.userName ? `  by  ${meta.userName}` : ""}`,
    `Rows: ${rows.length.toLocaleString()}   Columns: ${columns.length}`,
  ];
  if (meta?.note) banner.push(meta.note);
  const extras = opts.metaLines ?? [];
  const metaAll = [...banner, ...extras];

  const headerRow = columns.map((c) => c.label);
  const dataRows = rows.map((r) => columns.map((c) => r[c.key] ?? ""));

  const colCount = Math.max(headerRow.length, 2);
  const lastColLetter = XLSX.utils.encode_col(colCount - 1);

  // Layout: row 0 = title, rows 1..N = meta, then blank spacer, then header row, then data.
  const metaStart = 1;
  const metaEnd = metaStart + metaAll.length - 1; // inclusive
  const spacerRow = metaEnd + 1;
  const headerRowIdx = spacerRow + 1;
  const dataStart = headerRowIdx + 1;

  const aoa: unknown[][] = [];
  aoa[0] = [title];
  for (let i = 0; i < metaAll.length; i++) aoa[metaStart + i] = [metaAll[i]];
  aoa[spacerRow] = [];
  aoa[headerRowIdx] = headerRow;
  for (let i = 0; i < dataRows.length; i++) aoa[dataStart + i] = dataRows[i];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Merge title + meta rows across all columns.
  const merges: XLSX.Range[] = [];
  for (let r = 0; r <= metaEnd; r++) {
    merges.push({ s: { r, c: 0 }, e: { r, c: colCount - 1 } });
  }
  ws["!merges"] = merges;

  // Column widths.
  ws["!cols"] = columns.map((c) => ({ wch: pxToWch(c.widthPx, c.label) }));

  // Row heights.
  const rowsInfo: XLSX.RowInfo[] = [];
  rowsInfo[0] = { hpt: 24 };
  for (let i = metaStart; i <= metaEnd; i++) rowsInfo[i] = { hpt: 16 };
  rowsInfo[spacerRow] = { hpt: 6 };
  rowsInfo[headerRowIdx] = { hpt: 28 };
  for (let i = 0; i < dataRows.length; i++) rowsInfo[dataStart + i] = { hpt: 20 };
  ws["!rows"] = rowsInfo;

  // Freeze panes.
  const xSplit = Math.min(Math.max(0, freezeCols), colCount);
  (ws as any)["!freeze"] = { xSplit, ySplit: dataStart };
  (ws as any)["!views"] = [
    {
      state: "frozen",
      xSplit,
      ySplit: dataStart,
      topLeftCell: XLSX.utils.encode_cell({ r: dataStart, c: xSplit }),
      activePane: "bottomRight",
    },
  ];

  // Styling.
  setCell(ws, 0, 0, title, STYLE_TITLE);
  for (let i = 0; i < metaAll.length; i++) {
    setCell(ws, metaStart + i, 0, metaAll[i], i === 0 ? STYLE_META_LABEL : STYLE_META_VALUE);
  }
  for (let c = 0; c < headerRow.length; c++) {
    setCell(ws, headerRowIdx, c, headerRow[c], STYLE_HEADER);
  }
  for (let r = 0; r < dataRows.length; r++) {
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const raw = dataRows[r][c];
      if (raw === "" || raw == null) {
        setCell(ws, dataStart + r, c, "", STYLE_DATA);
        continue;
      }
      if (col.kind === "date") {
        const serial = isoToExcelSerial(String(raw));
        if (serial != null) {
          setDateCell(ws, dataStart + r, c, serial, STYLE_DATA, DATE_NUMFMT);
          continue;
        }
      } else if (col.kind === "datetime") {
        const serial = isoTimestampToExcelSerial(String(raw));
        if (serial != null) {
          setDateCell(ws, dataStart + r, c, serial, STYLE_DATA, DATETIME_NUMFMT);
          continue;
        }
      } else if (col.kind === "number") {
        const num = Number(raw);
        if (Number.isFinite(num)) {
          setCell(ws, dataStart + r, c, num, STYLE_DATA);
          continue;
        }
      }
      setCell(ws, dataStart + r, c, raw, STYLE_DATA);
    }
  }

  const lastRow = dataStart + dataRows.length - 1;
  ws["!ref"] = `A1:${lastColLetter}${Math.max(lastRow + 1, headerRowIdx + 1)}`;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

export function saveStyledWorkbook(wb: XLSX.WorkBook, fileName: string) {
  XLSX.writeFile(wb, fileName);
}

export async function styledWorkbookToBuffer(wb: XLSX.WorkBook): Promise<ArrayBuffer> {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}