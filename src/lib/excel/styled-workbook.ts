// Shared styled Excel workbook builder — supports both the default SHAW
// Raw Data style and a Gantt-flavored theme (column-group coloring, Data
// Date banner, and an optional right-side day-by-day Gantt calendar).

import XLSX from "xlsx-js-style";

// ---------------------------------------------------------------------------
// Conditional-formatting spec (applied post-build via exceljs in
// saveStyledWorkbook when the workbook was tagged with a spec).
// ---------------------------------------------------------------------------

export interface CfRule {
  /** Cell range in A1 notation, e.g. "U8:XX181" */
  ref: string;
  /** Excel formula (no leading '='). Uses top-left-of-range relative refs. */
  formula: string;
  fillRgb?: string;
  fontColorRgb?: string;
  bold?: boolean;
  /** Left/right vertical borders (medium). Used for Today/Data Date lines. */
  borderRgb?: string;
}

export interface WorkbookCfSpec {
  sheetName: string;
  rules: CfRule[];
}

const cfBySheet = new WeakMap<XLSX.WorkBook, WorkbookCfSpec>();

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
  /** Per-row style override — applied to all data columns (and Gantt cell background when no bar). */
  rowStyleOverride?: (row: Record<string, unknown>) => {
    fillRgb?: string;
    fontColorRgb?: string;
    bold?: boolean;
  } | null;
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
  /**
   * When "template", the gantt sheet is upgraded to a live template:
   *   • adds a `설정` sheet with start date / alarm threshold
   *   • D4 becomes `=설정!$B$3` (date), calendar row5/row6 become month/day formulas
   *   • derived columns (plan_days, plan_progress, progress_variance, slip_days,
   *     auto_judgment) are written as formulas
   *   • calendar bar fills are skipped (rendering happens via conditional formatting)
   *   • judgment / delta / bar / weekend / today CF rules are attached to the workbook
   *     (applied by `saveStyledWorkbook` via exceljs).
   * Requires `theme === "gantt"` and a `gantt` calendar range.
   */
  formulaMode?: "template";
  /** Optional settings sheet inputs. */
  settingsSheet?: {
    alarmThreshold?: number;
    deadlines?: Array<{ label: string; date: string }>;
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
    rowStyleOverride,
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
    const rowOv = rowStyleOverride?.(rowObj) ?? null;

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
      if (rowOv) {
        style = { ...style };
        if (rowOv.fillRgb) style.fill = { fgColor: { rgb: rowOv.fillRgb } };
        const baseFont = (style.font as Record<string, unknown>) ?? {};
        style.font = {
          ...baseFont,
          ...(rowOv.fontColorRgb ? { color: { rgb: rowOv.fontColorRgb } } : {}),
          ...(rowOv.bold ? { bold: true } : {}),
        };
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
        if (!fill && rowOv?.fillRgb) {
          fill = rowOv.fillRgb;
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

  if (opts.formulaMode === "template" && isGantt && gantt && ganttCount > 0) {
    applyGanttTemplate(wb, ws, {
      columns,
      rowCount: dataRows.length,
      ganttCount,
      dataDateRow,
      headerRowIdx,
      monthRowIdx,
      dataStart,
      startDateIso: gantt.startDate,
      dataDateIso: dataDateIso ?? gantt.startDate,
      settingsSheet: opts.settingsSheet,
    });
  }

  return wb;
}

export async function saveStyledWorkbook(
  wb: XLSX.WorkBook,
  fileName: string,
): Promise<void> {
  const cf = cfBySheet.get(wb);
  if (!cf) {
    XLSX.writeFile(wb, fileName);
    return;
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const outBuf = await applyCfViaExcelJs(buf, cf);
  const blob = new Blob([outBuf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function styledWorkbookToBuffer(wb: XLSX.WorkBook): Promise<ArrayBuffer> {
  const cf = cfBySheet.get(wb);
  const base = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  if (!cf) return base;
  return applyCfViaExcelJs(base, cf);
}

// ===========================================================================
// Gantt template upgrade helpers
// ===========================================================================

function colLetter(cIdx0: number): string {
  return XLSX.utils.encode_col(cIdx0);
}

function setFormulaCell(
  ws: XLSX.WorkSheet,
  r0: number,
  c0: number,
  formula: string,
  numFmt?: string,
) {
  const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
  const prev = (ws as Record<string, unknown>)[addr] as
    | { s?: Record<string, unknown> }
    | undefined;
  const prevStyle = (prev?.s as Record<string, unknown>) ?? {};
  const style = numFmt ? { ...prevStyle, numFmt } : prevStyle;
  (ws as Record<string, unknown>)[addr] = {
    t: "n",
    f: formula.startsWith("=") ? formula.slice(1) : formula,
    ...(numFmt ? { z: numFmt } : {}),
    s: style,
  };
}

function setFormulaCellText(
  ws: XLSX.WorkSheet,
  r0: number,
  c0: number,
  formula: string,
) {
  const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
  const prev = (ws as Record<string, unknown>)[addr] as
    | { s?: Record<string, unknown> }
    | undefined;
  const style = (prev?.s as Record<string, unknown>) ?? {};
  (ws as Record<string, unknown>)[addr] = {
    t: "s",
    f: formula.startsWith("=") ? formula.slice(1) : formula,
    v: "",
    s: style,
  };
}

function stripCellFill(ws: XLSX.WorkSheet, r0: number, c0: number) {
  const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
  const cell = (ws as Record<string, unknown>)[addr] as
    | { s?: Record<string, unknown> }
    | undefined;
  if (!cell?.s) return;
  const s = { ...(cell.s as Record<string, unknown>) };
  if ("fill" in s) delete s.fill;
  cell.s = s;
}

function applyGanttTemplate(
  wb: XLSX.WorkBook,
  ws: XLSX.WorkSheet,
  ctx: {
    columns: StyledColumn[];
    rowCount: number;
    ganttCount: number;
    dataDateRow: number;
    headerRowIdx: number;
    monthRowIdx: number;
    dataStart: number;
    startDateIso: string;
    dataDateIso: string;
    settingsSheet?: StyledSheetOptions["settingsSheet"];
  },
) {
  const {
    columns,
    rowCount,
    ganttCount,
    dataDateRow,
    headerRowIdx,
    monthRowIdx,
    dataStart,
  } = ctx;
  if (rowCount === 0 || ganttCount === 0) return;

  const settingsWs = buildSettingsSheet(
    ctx.dataDateIso,
    ctx.startDateIso,
    ganttCount,
    ctx.settingsSheet,
  );
  XLSX.utils.book_append_sheet(wb, settingsWs, "설정");

  // Data Date banner: split merged row, put date formula in D column.
  const merges = (ws["!merges"] ?? []) as XLSX.Range[];
  const filteredMerges = merges.filter(
    (m) => !(m.s.r === dataDateRow && m.e.r === dataDateRow),
  );
  const bannerLabelAddr = XLSX.utils.encode_cell({ r: dataDateRow, c: 0 });
  delete (ws as Record<string, unknown>)[bannerLabelAddr];
  setCell(ws, dataDateRow, 1, "Data Date ▶", {
    font: { name: FONT_KO, sz: 11, bold: true, color: { rgb: "FF1F4E79" } },
    alignment: { vertical: "center", horizontal: "right" },
  });
  setFormulaCell(ws, dataDateRow, 3, "=설정!$B$3", "yyyy-mm-dd");
  {
    const addr = XLSX.utils.encode_cell({ r: dataDateRow, c: 3 });
    const cell = (ws as Record<string, unknown>)[addr] as {
      s?: Record<string, unknown>;
    };
    if (cell) {
      cell.s = {
        ...(cell.s ?? {}),
        font: { name: FONT_KO, sz: 11, bold: true, color: { rgb: "FF0000FF" } },
        fill: { fgColor: { rgb: "FFFFF2CC" } },
        alignment: { vertical: "center", horizontal: "center" },
        numFmt: "yyyy-mm-dd",
      };
    }
  }
  filteredMerges.push({ s: { r: dataDateRow, c: 3 }, e: { r: dataDateRow, c: 5 } });
  ws["!merges"] = filteredMerges;

  const dRow1 = dataDateRow + 1;
  const D4 = `$D$${dRow1}`;
  const dayRow1 = headerRowIdx + 1;
  const firstDataRow1 = dataStart + 1;
  const lastDataRow1 = dataStart + rowCount;

  // Calendar header formulas (day + month rows)
  const firstCalCol0 = columns.length;
  const firstCalLetter = colLetter(firstCalCol0);
  const lastCalCol0 = columns.length + ganttCount - 1;
  const lastCalLetter = colLetter(lastCalCol0);

  for (let i = 0; i < ganttCount; i++) {
    const c = firstCalCol0 + i;
    const cL = colLetter(c);
    // First calendar day = 설정!$B$4 (chart start). Subsequent = prev+1.
    const dayFormula =
      i === 0 ? `=설정!$B$4` : `=${colLetter(c - 1)}${dayRow1}+1`;
    setFormulaCell(ws, headerRowIdx, c, dayFormula, "d");
    if (monthRowIdx >= 0) {
      const monthFormula = `=IF(OR(DAY(${cL}${dayRow1})=1,${cL}${dayRow1}=설정!$B$4),TEXT(${cL}${dayRow1},"m월"),"")`;
      setFormulaCellText(ws, monthRowIdx, c, monthFormula);
    }
  }

  // Derived column formulas
  const letters: Record<string, string> = {};
  columns.forEach((col, idx) => {
    letters[col.key] = colLetter(idx);
  });
  const K = letters.plan_start;
  const L = letters.plan_end;
  const O = letters.actual_progress;
  const R = letters.forecast_end;
  const J = letters.status_manual;
  const I = letters.row_type;
  const Q = letters.progress_variance;
  const T = letters.auto_judgment;
  const alarm = "설정!$B$8";

  const idxOf = (key: string) => columns.findIndex((c) => c.key === key);

  for (let ri = 0; ri < rowCount; ri++) {
    const r0 = dataStart + ri;
    const r1 = r0 + 1;
    if (letters.plan_days && K && L) {
      const f = `=IF(AND(ISNUMBER(${K}${r1}),ISNUMBER(${L}${r1})),${L}${r1}-${K}${r1}+1,"")`;
      setFormulaCell(ws, r0, idxOf("plan_days"), f, "0;-0;-");
    }
    if (letters.plan_progress && K && L) {
      const f = `=IF(OR(NOT(ISNUMBER(${K}${r1})),NOT(ISNUMBER(${L}${r1})),(${L}${r1}-${K}${r1}+1)=0),"",IF(${D4}<${K}${r1},0,MIN(1,(${D4}-${K}${r1}+1)/(${L}${r1}-${K}${r1}+1))))`;
      setFormulaCell(ws, r0, idxOf("plan_progress"), f, "0.0%;-0.0%;-");
    }
    if (letters.progress_variance && O && K && L) {
      const planProg = `IF(${D4}<${K}${r1},0,MIN(1,(${D4}-${K}${r1}+1)/(${L}${r1}-${K}${r1}+1)))`;
      const f = `=IF(AND(ISNUMBER(${O}${r1}),ISNUMBER(${K}${r1}),ISNUMBER(${L}${r1})),${O}${r1}-${planProg},"")`;
      setFormulaCell(ws, r0, idxOf("progress_variance"), f, "+0.0%;-0.0%;0.0%");
    }
    if (letters.slip_days && R && L) {
      const f = `=IF(AND(ISNUMBER(${R}${r1}),ISNUMBER(${L}${r1})),${R}${r1}-${L}${r1},"")`;
      setFormulaCell(ws, r0, idxOf("slip_days"), f, "+0;-0;-");
    }
    if (letters.auto_judgment && K && L && O) {
      const jRef = J ? `${J}${r1}` : `""`;
      const rRef = R ? `${R}${r1}` : `""`;
      const qRef = Q
        ? `${Q}${r1}`
        : `(${O}${r1}-IF(${D4}<${K}${r1},0,MIN(1,(${D4}-${K}${r1}+1)/(${L}${r1}-${K}${r1}+1))))`;
      const f = `=IF(OR(${jRef}="완료",${O}${r1}>=1),"완료",IF(AND(ISNUMBER(${rRef}),${rRef}>${L}${r1}),"지연",IF(${D4}>${L}${r1},"지연",IF(${qRef}<=${alarm},"지연",IF(AND(${D4}>=${K}${r1},${O}${r1}=0),"주의(미착수)",IF(${D4}>=${K}${r1},"진행","예정"))))))`;
      setFormulaCellText(ws, r0, idxOf("auto_judgment"), f);
    }
  }

  // Strip static fills on calendar body so CF can render
  for (let ri = 0; ri < rowCount; ri++) {
    for (let i = 0; i < ganttCount; i++) {
      stripCellFill(ws, dataStart + ri, firstCalCol0 + i);
    }
  }

  // Build CF rules
  const calRange = `${firstCalLetter}${firstDataRow1}:${lastCalLetter}${lastDataRow1}`;
  const dayCellRel = `${firstCalLetter}$${dayRow1}`;
  const Krel = K ? `$${K}${firstDataRow1}` : "";
  const Lrel = L ? `$${L}${firstDataRow1}` : "";
  const Orel = O ? `$${O}${firstDataRow1}` : "";
  const Rrel = R ? `$${R}${firstDataRow1}` : "";
  const Irel = I ? `$${I}${firstDataRow1}` : "";

  const rules: CfRule[] = [];
  if (K && L && O && I && R) {
    rules.push({
      ref: calRange,
      formula: `AND(${Irel}<>"항목",ISNUMBER(${Rrel}),${dayCellRel}=${Rrel})`,
      fillRgb: "FFFF6600",
      bold: true,
    });
    rules.push({
      ref: calRange,
      formula: `AND(${Irel}<>"항목",ISNUMBER(${Krel}),${dayCellRel}>=${Krel}+${Orel}*(${Lrel}-${Krel}+1),${dayCellRel}<=${Lrel},${dayCellRel}<${D4})`,
      fillRgb: "FFFFC7CE",
    });
    rules.push({
      ref: calRange,
      formula: `AND(${Irel}<>"항목",ISNUMBER(${Krel}),${dayCellRel}>=${Krel},${dayCellRel}<${Krel}+${Orel}*(${Lrel}-${Krel}+1))`,
      fillRgb: "FF548235",
    });
  }
  if (K && L && I) {
    rules.push({ ref: calRange, formula: `AND(${dayCellRel}=${Lrel},${Irel}="실행")`, fillRgb: "FF1F4E79" });
    rules.push({ ref: calRange, formula: `AND(${dayCellRel}=${Lrel},${Irel}="승인")`, fillRgb: "FF7030A0" });
    rules.push({ ref: calRange, formula: `AND(${dayCellRel}=${Lrel},${Irel}="대기")`, fillRgb: "FF808080" });
    rules.push({ ref: calRange, formula: `AND(${dayCellRel}>=${Krel},${dayCellRel}<=${Lrel},${Irel}="실행")`, fillRgb: "FFBDD7EE" });
    rules.push({ ref: calRange, formula: `AND(${dayCellRel}>=${Krel},${dayCellRel}<=${Lrel},${Irel}="승인")`, fillRgb: "FFD9C1F0" });
    rules.push({ ref: calRange, formula: `AND(${dayCellRel}>=${Krel},${dayCellRel}<=${Lrel},${Irel}="대기")`, fillRgb: "FFE7E6E6" });
  }
  rules.push({ ref: calRange, formula: `${dayCellRel}=${D4}`, fillRgb: "FFFFF2CC", borderRgb: "FFC00000" });
  rules.push({ ref: calRange, formula: `${dayCellRel}=TODAY()`, borderRgb: "FF808080" });
  rules.push({ ref: calRange, formula: `WEEKDAY(${dayCellRel})=6`, fillRgb: "FFF2F2F2" });

  if (T) {
    const tRange = `${T}${firstDataRow1}:${T}${lastDataRow1}`;
    const tRef = `$${T}${firstDataRow1}`;
    rules.push({ ref: tRange, formula: `${tRef}="지연"`, fillRgb: "FFF4CCCC", fontColorRgb: "FFC00000", bold: true });
    rules.push({ ref: tRange, formula: `${tRef}="주의(미착수)"`, fillRgb: "FFFCE5CD", fontColorRgb: "FFB45F06", bold: true });
    rules.push({ ref: tRange, formula: `${tRef}="완료"`, fillRgb: "FFD9EAD3", fontColorRgb: "FF38761D", bold: true });
  }
  if (Q && O && I) {
    const qRange = `${Q}${firstDataRow1}:${Q}${lastDataRow1}`;
    const qRef = `$${Q}${firstDataRow1}`;
    const oRef = `$${O}${firstDataRow1}`;
    const iRef = `$${I}${firstDataRow1}`;
    rules.push({
      ref: qRange,
      formula: `AND(ISNUMBER(${qRef}),${qRef}<0,${iRef}<>"항목")`,
      fontColorRgb: "FFC00000",
      bold: true,
    });
    rules.push({
      ref: qRange,
      formula: `AND(ISNUMBER(${qRef}),${qRef}>=0,${oRef}>0,${iRef}<>"항목")`,
      fontColorRgb: "FF38761D",
      bold: true,
    });
  }

  cfBySheet.set(wb, { sheetName: (wb.SheetNames[0] as string) ?? "Sheet1", rules });
}

function buildSettingsSheet(
  dataDateIso: string,
  startDateIso: string,
  ganttDays: number,
  cfg: StyledSheetOptions["settingsSheet"],
): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  const dataDateSerial = isoToExcelSerial(dataDateIso);
  const startSerial = isoToExcelSerial(startDateIso);
  const titleStyle = {
    font: { name: FONT_KO, sz: 14, bold: true, color: { rgb: "FF1F4E79" } },
  };
  const labelStyle = {
    font: { name: FONT_KO, sz: 10, bold: true, color: { rgb: "FF374151" } },
    fill: { fgColor: { rgb: "FFF3F4F6" } },
  };
  const valueStyle = {
    font: { name: FONT_KO, sz: 10, color: { rgb: "FF111827" } },
  };
  const noteStyle = {
    font: { name: FONT_KO, sz: 9, italic: true, color: { rgb: "FF6B7280" } },
  };
  setCell(ws, 0, 0, "Gantt 차트 설정", titleStyle);

  // B3 = Data Date
  setCell(ws, 2, 0, "Data Date", labelStyle);
  if (dataDateSerial != null) {
    const addr = XLSX.utils.encode_cell({ r: 2, c: 1 });
    (ws as Record<string, unknown>)[addr] = {
      t: "n",
      v: dataDateSerial,
      z: "yyyy-mm-dd",
      s: {
        ...valueStyle,
        numFmt: "yyyy-mm-dd",
        font: { ...(valueStyle.font as Record<string, unknown>), bold: true, color: { rgb: "FF0000FF" } },
        fill: { fgColor: { rgb: "FFFFF2CC" } },
      },
    };
  }
  setCell(ws, 2, 2, "판정·진도율 기준일. 변경 시 알람/진행률 재계산", noteStyle);

  // B4 = 차트 시작일
  setCell(ws, 3, 0, "차트 시작일", labelStyle);
  if (startSerial != null) {
    const addr = XLSX.utils.encode_cell({ r: 3, c: 1 });
    (ws as Record<string, unknown>)[addr] = {
      t: "n",
      v: startSerial,
      z: "yyyy-mm-dd",
      s: { ...valueStyle, numFmt: "yyyy-mm-dd" },
    };
  }
  setCell(ws, 3, 2, "타임라인 첫 칸 날짜. 변경 시 타임라인 전체 이동", noteStyle);

  // B5 = 차트 일수 (원본 템플릿 배치)
  setCell(ws, 4, 0, "차트 일수", labelStyle);
  setCell(ws, 4, 1, ganttDays, valueStyle);
  setCell(ws, 4, 2, "타임라인 총 일수 (원본 기본 153일)", noteStyle);

  // B8 = 진도차 알람 임계값 (원본 템플릿 배치)
  setCell(ws, 7, 0, "진도차 알람 기준", labelStyle);
  setCell(ws, 7, 1, cfg?.alarmThreshold ?? -0.05, {
    ...valueStyle,
    numFmt: "0.0%",
    fill: { fgColor: { rgb: "FFFFF2CC" } },
  });
  setCell(ws, 7, 2, "실적-계획 진도차가 이 값 이하이면 '지연' 판정·알람 (기본 -5%p)", noteStyle);

  // 데드라인 (5~7행 자리): 옵션 값이 있을 때만 채움
  const dls = cfg?.deadlines ?? [];
  for (let i = 0; i < dls.length && i < 2; i++) {
    setCell(ws, 5 + i, 0, `데드라인 ${i + 1}`, labelStyle);
    const dl = dls[i];
    const serial = isoToExcelSerial(dl.date);
    if (serial != null) {
      const addr = XLSX.utils.encode_cell({ r: 5 + i, c: 1 });
      (ws as Record<string, unknown>)[addr] = {
        t: "n",
        v: serial,
        z: "yyyy-mm-dd",
        s: { ...valueStyle, numFmt: "yyyy-mm-dd" },
      };
    }
    setCell(ws, 5 + i, 2, dl.label, noteStyle);
  }

  setCell(ws, 10, 0, "범례 (타임라인)", labelStyle);
  const legend: Array<[string, string]> = [
    ["계획 구간 — 실행", "FFBDD7EE"],
    ["계획 구간 — 승인·협의", "FFD9C1F0"],
    ["계획 구간 — 외부 대기", "FFE7E6E6"],
    ["실적 진척 (실적진도율만큼)", "FF548235"],
    ["지연 갭 (Data Date까지 미진척)", "FFFFC7CE"],
    ["계획 완료일 (실행)", "FF1F4E79"],
    ["예상 완료일 (슬립)", "FFFF6600"],
    ["Data Date", "FFFFF2CC"],
    ["금요일 (KSA 휴일)", "FFF2F2F2"],
  ];
  legend.forEach(([text, rgb], i) => {
    setCell(ws, 11 + i, 0, text, valueStyle);
    setCell(ws, 11 + i, 1, "", { fill: { fgColor: { rgb } } });
  });

  ws["!cols"] = [{ wch: 26 }, { wch: 18 }, { wch: 60 }];
  ws["!ref"] = `A1:C${11 + legend.length}`;
  return ws;
}

async function applyCfViaExcelJs(
  input: ArrayBuffer,
  spec: WorkbookCfSpec,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(input);
  const ws = wb.getWorksheet(spec.sheetName);
  if (!ws) return input;
  spec.rules.forEach((r, idx) => {
    const style: Record<string, unknown> = {};
    if (r.fillRgb) {
      style.fill = {
        type: "pattern",
        pattern: "solid",
        bgColor: { argb: r.fillRgb },
        fgColor: { argb: r.fillRgb },
      };
    }
    if (r.fontColorRgb || r.bold) {
      style.font = {
        ...(r.fontColorRgb ? { color: { argb: r.fontColorRgb } } : {}),
        ...(r.bold ? { bold: true } : {}),
      };
    }
    if (r.borderRgb) {
      const side = { style: "medium", color: { argb: r.borderRgb } };
      style.border = { left: side, right: side };
    }
    ws.addConditionalFormatting({
      ref: r.ref,
      rules: [
        {
          type: "expression",
          formulae: [r.formula],
          priority: idx + 1,
          style,
        },
      ],
    });
  });
  const out = await wb.xlsx.writeBuffer();
  return out as ArrayBuffer;
}