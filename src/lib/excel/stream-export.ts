import ExcelJS from "exceljs";

export interface StreamExportColumn {
  key: string;
  label: string;
}

/**
 * SHAW-style styled header block written above the data grid.
 *
 * Layout (mirrors `SHAW PROJECT CMS` defect export):
 *   Row 1: Title            (merged, dark blue fill, white bold)
 *   Row 2: Exported by ...  (label style, gray fill)
 *   Row 3: Source: ...      (value style)
 *   Row 4: Search: ...      (value style)
 *   Row 5: Filters: ...     (value style)
 *   Row 6: Sort: ...        (value style)
 *   Row 7: (blank spacer)
 *   Row 8: Column headers   (dark slate fill, white bold, bordered)
 *   Row 9+: Data            (Calibri 10, thin light borders)
 */
export interface StyledHeaderBlock {
  title: string;
  /** Exactly 5 strings: Exported / Source / Search / Filters / Sort */
  metaRows: [string, string, string, string, string];
  /** How many leading columns to freeze horizontally (default 3). */
  freezeCols?: number;
}

export interface StreamExportOptions {
  filename: string;
  sheetName?: string;
  columns: StreamExportColumn[];
  chunkSize?: number;
  /** Fetch one page. Return rows and total. Empty rows terminates. */
  fetchPage: (
    offset: number,
    limit: number,
  ) => Promise<{ rows: Record<string, any>[]; total: number }>;
  transformRow?: (r: Record<string, any>) => Record<string, any>;
  onProgress?: (fetched: number, total: number) => void;
  /** Optional SHAW-style styled header block. When set, replaces the plain
   *  ws.columns header row with a rich title/meta/header block. */
  header?: StyledHeaderBlock;
  /** Column keys whose ISO string values should be written as Excel date
   *  serials with a yyyy-mm-dd number format. */
  dateFields?: string[];
  /** Column keys whose ISO timestamp values should be written as Excel date
   *  serials with a yyyy-mm-dd hh:mm number format. */
  datetimeFields?: string[];
  /** Optional per-column widths (Excel wch character units). */
  columnWidths?: Record<string, number>;
  /** Optional per-column numFmt overrides. Applied on top of date/datetime. */
  numFmtByKey?: Record<string, string>;
  /** Optional per-cell background fill (ARGB, e.g. "FFFFC7CE"). */
  cellFillFor?: (
    key: string,
    value: unknown,
    row: Record<string, any>,
  ) => string | null | undefined;
  /** Optional per-row background fill (ARGB). Applied to every cell in the row
   *  unless the cell override returns a value. */
  rowFillFor?: (row: Record<string, any>) => string | null | undefined;
  /** When "buffer", skip download and return the workbook bytes instead. */
  output?: "download" | "buffer";
  /** Additional fully-materialized sheets appended after the main sheet.
   *  Uses the same SHAW-style header/data styling. */
  extraSheets?: {
    name: string;
    columns: StreamExportColumn[];
    rows: Record<string, any>[];
    header?: StyledHeaderBlock;
    columnWidths?: Record<string, number>;
  }[];
}

// ── SHAW-style palette (Calibri) ────────────────────────────────────────────
const FONT_NAME = "Calibri";
const FILL_TITLE = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1E3A5F" } };
const FILL_META = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF3F4F6" } };
const FILL_HEADER = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF334155" } };
const BORDER_HEADER = {
  top: { style: "thin" as const, color: { argb: "FF1F2937" } },
  bottom: { style: "thin" as const, color: { argb: "FF1F2937" } },
  left: { style: "thin" as const, color: { argb: "FF1F2937" } },
  right: { style: "thin" as const, color: { argb: "FF1F2937" } },
};
const BORDER_DATA = {
  top: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  bottom: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  left: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  right: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
};

export const DATE_NUMFMT = "yyyy-mm-dd";
export const DATETIME_NUMFMT = "yyyy-mm-dd hh:mm";

function isoToDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}
function isoTimestampToDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Chunked XLSX export with optional SHAW-style styled header block.
 * - Streams rows from `fetchPage` into an ExcelJS worksheet page-by-page.
 * - Drops each page after appending, keeping only the growing worksheet in memory.
 * - Yields to the event loop between chunks to keep the UI responsive.
 */
export async function streamXlsxExport(
  opts: StreamExportOptions,
): Promise<{ count: number; buffer?: Uint8Array }> {
  const CHUNK = opts.chunkSize ?? 1000;
  const dateSet = new Set(opts.dateFields ?? []);
  const dtSet = new Set(opts.datetimeFields ?? []);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName ?? "Sheet1");

  const colCount = Math.max(opts.columns.length, 2);
  const headerRowIdx = opts.header ? 8 : 1;
  const freezeCols = Math.min(opts.header?.freezeCols ?? 3, opts.columns.length);

  if (opts.header) {
    // Row 1 — Title (no merge; style every column so the banner still spans)
    for (let c = 1; c <= colCount; c++) {
      const cell = ws.getCell(1, c);
      cell.value = c === 1 ? opts.header.title : "";
      cell.font = { name: FONT_NAME, size: 14, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = FILL_TITLE;
      cell.alignment = { vertical: "middle", horizontal: "left" };
    }
    ws.getRow(1).height = 24;

    // Rows 2..6 — meta lines (no merge; style every column)
    for (let i = 0; i < 5; i++) {
      const r = 2 + i;
      for (let c = 1; c <= colCount; c++) {
        const cell = ws.getCell(r, c);
        cell.value = c === 1 ? (opts.header.metaRows[i] ?? "") : "";
        cell.font = {
          name: FONT_NAME,
          size: 10,
          bold: i === 0,
          color: { argb: i === 0 ? "FF374151" : "FF111827" },
        };
        cell.fill = FILL_META;
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      }
      ws.getRow(r).height = 16;
    }

    // Row 7 — spacer
    ws.getRow(7).height = 6;

    // Row 8 — styled column headers
    for (let c = 0; c < opts.columns.length; c++) {
      const cell = ws.getCell(8, c + 1);
      cell.value = opts.columns[c].label;
      cell.font = { name: FONT_NAME, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = FILL_HEADER;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = BORDER_HEADER;
    }
    ws.getRow(8).height = 28;

    ws.views = [
      {
        state: "frozen",
        xSplit: freezeCols,
        ySplit: 8,
        topLeftCell: ws.getCell(9, freezeCols + 1).address,
        activeCell: ws.getCell(9, freezeCols + 1).address,
      },
    ];
  } else {
    // Fallback: plain header on row 1
    for (let c = 0; c < opts.columns.length; c++) {
      const cell = ws.getCell(1, c + 1);
      cell.value = opts.columns[c].label;
      cell.font = { bold: true };
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  // Column widths
  for (let c = 0; c < opts.columns.length; c++) {
    const k = opts.columns[c].key;
    ws.getColumn(c + 1).width = opts.columnWidths?.[k] ?? 18;
  }

  let offset = 0;
  let total = Infinity;
  let fetched = 0;
  let dataRowIdx = headerRowIdx; // last row written

  while (offset < total) {
    const { rows, total: t } = await opts.fetchPage(offset, CHUNK);
    if (!rows || rows.length === 0) break;
    total = Number.isFinite(t) ? t : fetched + rows.length;

    for (const r of rows) {
      const src = opts.transformRow ? opts.transformRow(r) : r;
      dataRowIdx += 1;
      const row = ws.getRow(dataRowIdx);
      const rowFill = opts.rowFillFor?.(src) ?? null;
      for (let c = 0; c < opts.columns.length; c++) {
        const key = opts.columns[c].key;
        const raw = src[key];
        const cell = row.getCell(c + 1);
        // Prefer date serial values for date/datetime columns.
        if (dateSet.has(key)) {
          const d = isoToDate(raw);
          if (d) {
            cell.value = d;
            cell.numFmt = opts.numFmtByKey?.[key] ?? DATE_NUMFMT;
          } else {
            cell.value = normalizeCell(raw) as any;
          }
        } else if (dtSet.has(key)) {
          const d = isoTimestampToDate(raw);
          if (d) {
            cell.value = d;
            cell.numFmt = opts.numFmtByKey?.[key] ?? DATETIME_NUMFMT;
          } else {
            cell.value = normalizeCell(raw) as any;
          }
        } else {
          cell.value = normalizeCell(raw) as any;
          const fmt = opts.numFmtByKey?.[key];
          if (fmt) cell.numFmt = fmt;
        }
        if (opts.header) {
          cell.font = { name: FONT_NAME, size: 10, color: { argb: "FF111827" } };
          cell.alignment = { vertical: "middle", horizontal: "left" };
          cell.border = BORDER_DATA;
        }
        const cellFill = opts.cellFillFor?.(key, raw, src);
        const fillArgb = cellFill ?? rowFill;
        if (fillArgb) {
          cell.fill = {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: fillArgb },
          };
        }
      }
      row.height = 20;
      row.commit?.();
    }

    offset += rows.length;
    fetched += rows.length;
    opts.onProgress?.(fetched, total);
    if (fetched >= total) break;
    // yield to event loop → paint toast, avoid main-thread starvation
    await new Promise((r) => setTimeout(r, 0));
  }

  for (const extra of opts.extraSheets ?? []) {
    const ws2 = wb.addWorksheet(extra.name);
    const colCount2 = Math.max(extra.columns.length, 2);
    let r = 0;
    if (extra.header) {
      for (let c = 1; c <= colCount2; c++) {
        const cell = ws2.getCell(1, c);
        cell.value = c === 1 ? extra.header.title : "";
        cell.font = { name: FONT_NAME, size: 14, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = FILL_TITLE;
      }
      ws2.getRow(1).height = 24;
      for (let i = 0; i < 5; i++) {
        for (let c = 1; c <= colCount2; c++) {
          const cell = ws2.getCell(2 + i, c);
          cell.value = c === 1 ? (extra.header.metaRows[i] ?? "") : "";
          cell.font = { name: FONT_NAME, size: 10, bold: i === 0, color: { argb: "FF111827" } };
          cell.fill = FILL_META;
        }
        ws2.getRow(2 + i).height = 16;
      }
      ws2.getRow(7).height = 6;
      r = 7;
    }
    r += 1;
    for (let c = 0; c < extra.columns.length; c++) {
      const cell = ws2.getCell(r, c + 1);
      cell.value = extra.columns[c].label;
      cell.font = { name: FONT_NAME, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = FILL_HEADER;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = BORDER_HEADER;
    }
    ws2.getRow(r).height = 24;
    ws2.views = [{ state: "frozen", ySplit: r }];
    for (let c = 0; c < extra.columns.length; c++) {
      ws2.getColumn(c + 1).width = extra.columnWidths?.[extra.columns[c].key] ?? 18;
    }
    for (const src of extra.rows) {
      r += 1;
      const row = ws2.getRow(r);
      for (let c = 0; c < extra.columns.length; c++) {
        const cell = row.getCell(c + 1);
        cell.value = normalizeCell(src[extra.columns[c].key]) as any;
        cell.font = { name: FONT_NAME, size: 10, color: { argb: "FF111827" } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = BORDER_DATA;
      }
      row.height = 18;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  if (opts.output === "buffer") {
    return { count: fetched, buffer: new Uint8Array(buf as ArrayBuffer) };
  }
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, opts.filename);
  return { count: fetched };
}

function normalizeCell(v: unknown): unknown {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return v as any;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // release memory async so the browser has time to consume the URL
  setTimeout(() => URL.revokeObjectURL(url), 0);
}