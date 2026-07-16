import ExcelJS from "exceljs";

export interface StreamExportColumn {
  key: string;
  label: string;
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
}

/**
 * Chunked XLSX export.
 * - Streams rows from `fetchPage` into an ExcelJS worksheet page-by-page.
 * - Drops each page after appending, keeping only the growing worksheet in memory.
 * - Yields to the event loop between chunks to keep the UI responsive.
 */
export async function streamXlsxExport(opts: StreamExportOptions): Promise<{ count: number }> {
  const CHUNK = opts.chunkSize ?? 1000;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName ?? "Sheet1", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = opts.columns.map((c) => ({ header: c.label, key: c.key }));

  let offset = 0;
  let total = Infinity;
  let fetched = 0;

  while (offset < total) {
    const { rows, total: t } = await opts.fetchPage(offset, CHUNK);
    if (!rows || rows.length === 0) break;
    total = Number.isFinite(t) ? t : fetched + rows.length;

    for (const r of rows) {
      const src = opts.transformRow ? opts.transformRow(r) : r;
      const arr = opts.columns.map((c) => normalizeCell(src[c.key]));
      ws.addRow(arr).commit?.();
    }

    offset += rows.length;
    fetched += rows.length;
    opts.onProgress?.(fetched, total);
    if (fetched >= total) break;
    // yield to event loop → paint toast, avoid main-thread starvation
    await new Promise((r) => setTimeout(r, 0));
  }

  const buf = await wb.xlsx.writeBuffer();
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