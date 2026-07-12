// Shared styled Excel workbook builder — supports both the default SHAW
// Raw Data style and a Gantt-flavored theme (column-group coloring, Data
// Date banner, and an optional right-side day-by-day Gantt calendar).

import XLSX from "xlsx-js-style";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export const DATE_NUMFMT = "dd-mmm";
export const DATETIME_NUMFMT = "dd-mmm-yyyy hh:mm";
export const GANTT_DATE_NUMFMT = "mm-dd-yy";

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

function daysBetween(startIso: string, endIso: string): string[] {
  const s = new Date(startIso + "T00:00:00Z");
  const e = new Date(endIso + "T00:00:00Z");
  const out: string[] = [];
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return out;
  const cur = new Date(s);
  while (cur.getTime() <= e.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function isoInRange(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

// ---------------------------------------------------------------------------
// Style presets — default (SHAW) theme
// ---------------------------------------------------------------------------

const FONT_NAME = "Calibri";
const FONT_KO = "Malgun Gothic";

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
// Style presets — Gantt theme (matches upload template)
// ---------------------------------------------------------------------------

export type ColumnGroupTag = "basic" | "plan" | "actual" | "progress";

const GANTT_TITLE = {
  font: { name: FONT_KO, sz: 14, bold: true, color: { rgb: "FF1F4E79" } },
  alignment: { vertical: "center", horizontal: "left" },
} as const;

const GANTT_DATA_DATE = {
  font: { name: FONT_KO, sz: 11, bold: true, color: { rgb: "FF0000FF" } },
  fill: { fgColor: { rgb: "FFFFF2CC" } },
  alignment: { vertical: "center", horizontal: "center" },
} as const;

const GANTT_HEADER_FILL: Record<ColumnGroupTag, string> = {
  basic: "FF1F4E79",
  plan: "FF1F4E79",
  actual: "FF548235",
  progress: "FF2E75B6",
};

const GANTT_DATA_FILL: Record<ColumnGroupTag, string | null> = {
  basic: null,
  plan: "FFF2F2F2",
  actual: "FFEBF6EB",
  progress: "FFDEEBF7",
};

const GANTT_BAR = {
  plan: "FFBDD7EE",
  actual: "FF548235",
  slip: "FFFFC7CE",
  weekend: "FFF2F2F2",
} as const;

function gHeaderStyle(group: ColumnGroupTag) {
  return {
    font: { name: FONT_KO, sz: 8.5, bold: true, color: { rgb: "FFFFFFFF" } },
    fill: { fgColor: { rgb: GANTT_HEADER_FILL[group] } },
    alignment: { vertical: "center", horizontal: "center", wrapText: true },
    border: {
      top: { style: "thin", color: { rgb: "FF1F2937" } },
      bottom: { style: "thin", color: { rgb: "FF1F2937" } },
      left: { style: "thin", color: { rgb: "FF1F2937" } },
      right: { style: "thin", color: { rgb: "FF1F2937" } },
    },
  } as Record<string, unknown>;
}

function gDataStyle(group: ColumnGroupTag, overrideFill?: string | null) {
  const bg = overrideFill ?? GANTT_DATA_FILL[group] ?? null;
  const style: Record<string, unknown> = {
    font: { name: FONT_KO, sz: 8.5, color: { rgb: "FF000000" } },
    alignment: { vertical: "center", horizontal: "center", wrapText: true },
    border: {
      top: { style: "thin", color: { rgb: "FFE5E7EB" } },
      bottom: { style: "thin", color: { rgb: "FFE5E7EB" } },
      left: { style: "thin", color: { rgb: "FFE5E7EB" } },
      right: { style: "thin", color: { rgb: "FFE5E7EB" } },
    },
  };
  if (bg) style.fill = { fgColor: { rgb: bg } };
  return style;
}

function gGanttCellStyle(fillRgb: string | null, todayCol: boolean) {
  const style: Record<string, unknown> = {
    font: { name: FONT_KO, sz: 7, color: { rgb: "FF444444" } },
    alignment: { vertical: "center", horizontal: "center" },
    border: {
      top: { style: "hair", color: { rgb: "FFE5E7EB" } },
      bottom: { style: "hair", color: { rgb: "FFE5E7EB" } },
      left: todayCol
        ? { style: "medium", color: { rgb: "FFC00000" } }
        : { style: "hair", color: { rgb: "FFE5E7EB" } },
      right: todayCol
        ? { style: "medium", color: { rgb: "FFC00000" } }
        : { style: "hair", color: { rgb: "FFE5E7EB" } },
    },
  };
  if (fillRgb) style.fill = { fgColor: { rgb: fillRgb } };
  return style;
}

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
  metaLines?: string[];
  columns: StyledColumn[];
  rows: Record<string, unknown>[];
  sheetName?: string;
  freezeCols?: number;
  meta?: { userName?: string; note?: string };

  /** Gantt theme swaps title/header styles and colors data rows by column group. */
  theme?: "default" | "gantt";
  /** Maps a column key to its Gantt group (drives header + data-fill color). */
  columnGroup?: (key: string) => ColumnGroupTag;
  /** ISO date shown in the "Data Date ▶" banner and used as Today marker. */
  dataDate?: string;
  /** Per-column numFmt override (e.g. plan_days → "0;-0;-"). */
  numFmtByKey?: Record<string, string>;
  /** Per-cell fill override (RGB without '#') — e.g. Risk=High → orange. */
  cellFillOverride?: (
    key: string,
    value: unknown,
    row: Record<string, unknown>,
  ) => string | null;
  /** Right-side day-by-day Gantt calendar. */
  gantt?: {
    startDate: string;
    endDate: string;
    rowDates: (row: Record<string, unknown>) => {
      planStart?: string | null;
      planEnd?: string | null;
      actualStart?: string | null;
      actualFinish?: string | null;
      forecastEnd?: string | null;
      done?: boolean;
    };
  };
}

export function buildStyledWorkbook(opts: StyledSheetOptions): XLSX.WorkBook {
  const {
    title,
    columns,
    rows,
    sheetName = "Sheet1",
    freezeCols = 1,
    meta,
    theme = "default",
    columnGroup,
    dataDate,
    numFmtByKey,
    cellFillOverride,
    gantt,
  } = opts;
  const isGantt = theme === "gantt";

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const exportedTs = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const banner: string[] = [
    `Exported: ${exportedTs}${meta?.userName ? `  by  ${meta.userName}` : ""}`,
    `Rows: ${rows.length.toLocaleString()}   Columns: ${columns.length}`,
  ];
  if (meta?.note) banner.push(meta.note);
  const metaAll = [...banner, ...(opts.metaLines ?? [])];

  const ganttDays = gantt ? daysBetween(gantt.startDate, gantt.endDate) : [];
  const ganttCount = ganttDays.length;
  const dataDateIso = dataDate ?? null;

  const headerRow = columns.map((c) => c.label);
  const dataRows = rows.map((r) => columns.map((c) => r[c.key] ?? ""));

  const totalCols = headerRow.length + ganttCount;
  const colCount = Math.max(totalCols, 2);
  const lastColLetter = XLSX.utils.encode_col(colCount - 1);

  // Layout
  const metaStart = 1;
  const metaEnd = metaStart + metaAll.length - 1;
  const dataDateRow = isGantt && dataDateIso ? metaEnd + 1 : -1;
  const spacerRow = (dataDateRow >= 0 ? dataDateRow : metaEnd) + 1;
  const monthRowIdx = isGantt ? spacerRow + 1 : -1;
  const headerRowIdx = (monthRowIdx >= 0 ? monthRowIdx : spacerRow) + 1;
  const dataStart = headerRowIdx + 1;

  const aoa: unknown[][] = [];
  aoa[0] = [title];
  for (let i = 0; i < metaAll.length; i++) aoa[metaStart + i] = [metaAll[i]];
  if (dataDateRow >= 0) aoa[dataDateRow] = [`Data Date ▶  ${dataDateIso}`];
  aoa[spacerRow] = [];
  if (monthRowIdx >= 0) aoa[monthRowIdx] = [];
  aoa[headerRowIdx] = headerRow;
  for (let i = 0; i < dataRows.length; i++) aoa[dataStart + i] = dataRows[i];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const merges: XLSX.Range[] = [];
  for (let r = 0; r <= metaEnd; r++) {
    merges.push({ s: { r, c: 0 }, e: { r, c: colCount - 1 } });
  }
  if (dataDateRow >= 0) {
    merges.push({ s: { r: dataDateRow, c: 0 }, e: { r: dataDateRow, c: colCount - 1 } });
  }

  const cols: XLSX.ColInfo[] = columns.map((c) => ({ wch: pxToWch(c.widthPx, c.label) }));
  for (let i = 0; i < ganttCount; i++) cols.push({ wch: 2.3 });
  ws["!cols"] = cols;

  const rowsInfo: XLSX.RowInfo[] = [];
  rowsInfo[0] = { hpt: 24 };
  for (let i = metaStart; i <= metaEnd; i++) rowsInfo[i] = { hpt: 16 };
  if (dataDateRow >= 0) rowsInfo[dataDateRow] = { hpt: 20 };
  rowsInfo[spacerRow] = { hpt: 6 };
  if (monthRowIdx >= 0) rowsInfo[monthRowIdx] = { hpt: 16 };
  rowsInfo[headerRowIdx] = { hpt: isGantt ? 32 : 28 };
  for (let i = 0; i < dataRows.length; i++) rowsInfo[dataStart + i] = { hpt: isGantt ? 22 : 20 };
  ws["!rows"] = rowsInfo;

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

  // Title + meta
  setCell(ws, 0, 0, title, isGantt ? (GANTT_TITLE as Record<string, unknown>) : STYLE_TITLE);
  for (let i = 0; i < metaAll.length; i++) {
    setCell(ws, metaStart + i, 0, metaAll[i], i === 0 ? STYLE_META_LABEL : STYLE_META_VALUE);
  }
  if (dataDateRow >= 0 && dataDateIso) {
    setCell(ws, dataDateRow, 0, `Data Date ▶  ${dataDateIso}`, GANTT_DATA_DATE as Record<string, unknown>);
  }

  // Data column headers
  for (let c = 0; c < headerRow.length; c++) {
    if (isGantt && columnGroup) {
      const g = columnGroup(columns[c].key);
      setCell(ws, headerRowIdx, c, headerRow[c], gHeaderStyle(g));
      if (monthRowIdx >= 0) {
        setCell(ws, monthRowIdx, c, "", gHeaderStyle(g));
        merges.push({ s: { r: monthRowIdx, c }, e: { r: headerRowIdx, c } });
      }
    } else {
      setCell(ws, headerRowIdx, c, headerRow[c], STYLE_HEADER);
    }
  }

  // Gantt calendar header
  if (ganttCount > 0) {
    const monNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let i = 0; i < ganttCount; i++) {
      const iso = ganttDays[i];
      const c = headerRow.length + i;
      const serial = isoToExcelSerial(iso);
      if (serial == null) continue;
      const dt = new Date(iso + "T00:00:00Z");
      const dom = dt.getUTCDate();
      const isMonthStart = dom === 1 || i === 0;
      const isToday = dataDateIso === iso;

      if (monthRowIdx >= 0) {
        if (isMonthStart || isToday) {
          setCell(ws, monthRowIdx, c, monNames[dt.getUTCMonth()], {
            font: { name: FONT_KO, sz: 8, bold: true, color: { rgb: "FF1F4E79" } },
            fill: { fgColor: { rgb: "FFFFFFFF" } },
            alignment: { vertical: "center", horizontal: "center" },
          });
        } else {
          setCell(ws, monthRowIdx, c, "", {
            fill: { fgColor: { rgb: "FFFFFFFF" } },
          });
        }
      }
      const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      ws[addr] = {
        t: "n",
        v: serial,
        z: "d",
        s: {
          font: { name: FONT_KO, sz: 7, bold: isToday, color: { rgb: isToday ? "FFC00000" : "FF444444" } },
          fill: { fgColor: { rgb: isToday ? "FFFFF2CC" : "FFFFFFFF" } },
          alignment: { vertical: "center", horizontal: "center" },
          numFmt: "d",
        },
      };
    }
  }

  // Data + gantt bars
  for (let r = 0; r < dataRows.length; r++) {
    const rowObj = rows[r];

    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const raw = dataRows[r][c];
      const group = isGantt && columnGroup ? columnGroup(col.key) : null;
      const overrideFill = cellFillOverride?.(col.key, raw, rowObj) ?? null;
      let style: Record<string, unknown>;
      if (isGantt && group) {
        style = gDataStyle(group, overrideFill);
      } else if (overrideFill) {
        style = { ...STYLE_DATA, fill: { fgColor: { rgb: overrideFill } } };
      } else {
        style = STYLE_DATA;
      }
      const explicitFmt = numFmtByKey?.[col.key];

      if (raw === "" || raw == null) {
        setCell(ws, dataStart + r, c, "", style);
        continue;
      }
      if (col.kind === "date") {
        const serial = isoToExcelSerial(String(raw));
        if (serial != null) {
          setDateCell(
            ws,
            dataStart + r,
            c,
            serial,
            style,
            explicitFmt ?? (isGantt ? GANTT_DATE_NUMFMT : DATE_NUMFMT),
          );
          continue;
        }
      } else if (col.kind === "datetime") {
        const serial = isoTimestampToExcelSerial(String(raw));
        if (serial != null) {
          setDateCell(ws, dataStart + r, c, serial, style, explicitFmt ?? DATETIME_NUMFMT);
          continue;
        }
      } else if (col.kind === "number") {
        const num = Number(raw);
        if (Number.isFinite(num)) {
          if (explicitFmt) {
            const addr = XLSX.utils.encode_cell({ r: dataStart + r, c });
            ws[addr] = { t: "n", v: num, z: explicitFmt, s: { ...style, numFmt: explicitFmt } };
          } else {
            setCell(ws, dataStart + r, c, num, style);
          }
          continue;
        }
      }
      setCell(ws, dataStart + r, c, raw, style);
    }

    if (ganttCount > 0 && gantt) {
      const d = gantt.rowDates(rowObj) ?? {};
      const done = !!d.done;
      const inProgressEnd = !d.actualFinish && d.actualStart ? dataDateIso : null;
      for (let i = 0; i < ganttCount; i++) {
        const iso = ganttDays[i];
        const cc = headerRow.length + i;
        const isToday = dataDateIso === iso;
        const dow = new Date(iso + "T00:00:00Z").getUTCDay();

        let fill: string | null = null;
        if (
          !done &&
          d.planEnd &&
          d.forecastEnd &&
          iso > d.planEnd &&
          iso <= d.forecastEnd
        ) {
          fill = GANTT_BAR.slip;
        }
        if (!fill && d.actualStart) {
          const actEnd = d.actualFinish ?? inProgressEnd ?? null;
          if (actEnd && isoInRange(iso, d.actualStart, actEnd)) {
            fill = GANTT_BAR.actual;
          }
        }
        if (!fill && d.planStart && d.planEnd && isoInRange(iso, d.planStart, d.planEnd)) {
          fill = GANTT_BAR.plan;
        }
        if (!fill && dow === 5) {
          fill = GANTT_BAR.weekend;
        }
        setCell(ws, dataStart + r, cc, "", gGanttCellStyle(fill, isToday));
      }
    }
  }

  ws["!merges"] = merges;

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