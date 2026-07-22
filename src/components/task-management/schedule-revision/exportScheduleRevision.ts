import XLSX from "xlsx-js-style";
import {
  DATE_NUMFMT,
  DATETIME_NUMFMT,
  isoToExcelSerial,
  isoTimestampToExcelSerial,
} from "@/lib/excel/styled-workbook";
import { dohaDateTime, dohaStampCompact } from "@/lib/time/doha";

// ── Styles ───────────────────────────────────────────────────────
const FONT = "Calibri";

const S_TITLE = {
  font: { name: FONT, sz: 14, bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: "FF1E3A5F" } },
  alignment: { vertical: "center", horizontal: "left" },
} as const;

const S_META = {
  font: { name: FONT, sz: 10, color: { rgb: "FF374151" } },
  fill: { fgColor: { rgb: "FFF3F4F6" } },
  alignment: { vertical: "center", horizontal: "left", wrapText: true },
} as const;

const border = (rgb = "FF1F2937") => ({
  top: { style: "thin", color: { rgb } },
  bottom: { style: "thin", color: { rgb } },
  left: { style: "thin", color: { rgb } },
  right: { style: "thin", color: { rgb } },
});

const S_HEADER_FLAT = {
  font: { name: FONT, sz: 11, bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: "FF334155" } },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: border(),
} as const;

// Distinct fills per stage group so groups read at a glance.
const STAGE_FILLS: Record<string, string> = {
  plan_start: "FF1D4ED8", // blue-700
  plan_end: "FF7C3AED", // violet-600
  forecast_end: "FFB45309", // amber-700
};
const STAGE_LEAF_FILLS: Record<string, string> = {
  plan_start: "FFDBEAFE", // blue-100
  plan_end: "FFEDE9FE", // violet-100
  forecast_end: "FFFEF3C7", // amber-100
};

const S_DATA = {
  font: { name: FONT, sz: 10, color: { rgb: "FF111827" } },
  alignment: { vertical: "center", horizontal: "left" },
  border: border("FFE5E7EB"),
} as const;

const S_DATA_CENTER = { ...S_DATA, alignment: { vertical: "center", horizontal: "center" } } as const;
const S_DATA_RIGHT = { ...S_DATA, alignment: { vertical: "center", horizontal: "right" } } as const;

const S_DIFF_POS = {
  ...S_DATA_RIGHT,
  font: { name: FONT, sz: 10, bold: true, color: { rgb: "FFB91C1C" } },
} as const;
const S_DIFF_NEG = {
  ...S_DATA_RIGHT,
  font: { name: FONT, sz: 10, bold: true, color: { rgb: "FF1D4ED8" } },
} as const;

function stageHeaderStyle(stage: string) {
  return {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: "FFFFFFFF" } },
    fill: { fgColor: { rgb: STAGE_FILLS[stage] ?? "FF334155" } },
    alignment: { vertical: "center", horizontal: "center", wrapText: true },
    border: border(),
  } as const;
}
function stageLeafStyle(stage: string) {
  return {
    font: { name: FONT, sz: 10, bold: true, color: { rgb: "FF111827" } },
    fill: { fgColor: { rgb: STAGE_LEAF_FILLS[stage] ?? "FFE5E7EB" } },
    alignment: { vertical: "center", horizontal: "center", wrapText: true },
    border: border("FFCBD5E1"),
  } as const;
}

// ── Types ────────────────────────────────────────────────────────
export type StageKey = "plan_start" | "plan_end" | "forecast_end";

export interface FlatCol {
  key: string;
  label: string;
  widthPx?: number;
  kind?: "text" | "date" | "datetime";
}
export interface StageLeaf {
  key: string; // e.g. plan_start_old_date
  label: string; // Old / New / Diff / Prev.Gap / Cur.Gap
  widthPx?: number;
  kind: "date" | "diff" | "gap";
}
export interface StageGroup {
  stage: StageKey;
  label: string;
  leaves: StageLeaf[];
}

export interface ExportOptions {
  fileName?: string;
  sheetName?: string;
  title?: string;
  metaLines?: string[];
  flatColumns: FlatCol[];
  stageGroups: StageGroup[];
  rows: Record<string, unknown>[];
  freezeCols?: number;
}

// ── Cell writers ─────────────────────────────────────────────────
function put(
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
  } else {
    ws[addr] = { t: "s", v: String(v), s: style };
  }
}
function putDate(
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

function pxToWch(px: number | undefined, fallbackLabel: string): number {
  const base =
    px && Number.isFinite(px) ? Math.round(px / 7) : Math.max(10, fallbackLabel.length + 2);
  return Math.max(8, Math.min(60, base));
}

// ── Builder ──────────────────────────────────────────────────────
export function buildScheduleRevisionWorkbook(opts: ExportOptions): XLSX.WorkBook {
  const {
    flatColumns,
    stageGroups,
    rows,
    title = "Schedule Revision",
    sheetName = "Schedule Revision",
    freezeCols = 1,
    metaLines = [],
  } = opts;

  const stageLeavesFlat = stageGroups.flatMap((g) =>
    g.leaves.map((l) => ({ ...l, stage: g.stage })),
  );
  const totalCols = flatColumns.length + stageLeavesFlat.length;
  const colCount = Math.max(totalCols, 2);

  // Layout rows
  const banner = [
    `Exported: ${dohaDateTime()}   Rows: ${rows.length.toLocaleString()}   Columns: ${totalCols}`,
    ...metaLines,
  ];
  const titleRow = 0;
  const metaStart = 1;
  const metaEnd = metaStart + banner.length - 1;
  const spacer = metaEnd + 1;
  const headTop = spacer + 1; // stage group header (row 1 of 2)
  const headBot = headTop + 1; // leaf header (row 2 of 2)
  const dataStart = headBot + 1;

  // Prime AOA
  const aoa: unknown[][] = [];
  aoa[titleRow] = [title];
  for (let i = 0; i < banner.length; i++) aoa[metaStart + i] = [banner[i]];
  aoa[spacer] = [];
  aoa[headTop] = new Array(totalCols).fill("");
  aoa[headBot] = new Array(totalCols).fill("");
  for (let i = 0; i < rows.length; i++) aoa[dataStart + i] = new Array(totalCols).fill("");
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  const cols: XLSX.ColInfo[] = [];
  flatColumns.forEach((c) => cols.push({ wch: pxToWch(c.widthPx, c.label) }));
  stageLeavesFlat.forEach((l) => cols.push({ wch: pxToWch(l.widthPx, l.label) }));
  ws["!cols"] = cols;

  // Row heights
  const rowsInfo: XLSX.RowInfo[] = [];
  rowsInfo[titleRow] = { hpt: 26 };
  for (let i = metaStart; i <= metaEnd; i++) rowsInfo[i] = { hpt: 16 };
  rowsInfo[spacer] = { hpt: 6 };
  rowsInfo[headTop] = { hpt: 24 };
  rowsInfo[headBot] = { hpt: 26 };
  for (let i = 0; i < rows.length; i++) rowsInfo[dataStart + i] = { hpt: 20 };
  ws["!rows"] = rowsInfo;

  // Merges: title banner + meta lines across all cols; stage group header spans its leaves;
  // flat columns span both header rows.
  const merges: XLSX.Range[] = [];
  merges.push({ s: { r: titleRow, c: 0 }, e: { r: titleRow, c: colCount - 1 } });
  for (let i = 0; i < banner.length; i++) {
    merges.push({ s: { r: metaStart + i, c: 0 }, e: { r: metaStart + i, c: colCount - 1 } });
  }
  // flat columns span headTop..headBot
  flatColumns.forEach((_, idx) => {
    merges.push({ s: { r: headTop, c: idx }, e: { r: headBot, c: idx } });
  });
  // stage group merges
  let cursor = flatColumns.length;
  stageGroups.forEach((g) => {
    if (g.leaves.length > 0) {
      merges.push({ s: { r: headTop, c: cursor }, e: { r: headTop, c: cursor + g.leaves.length - 1 } });
    }
    cursor += g.leaves.length;
  });
  ws["!merges"] = merges;

  // Freeze panes below leaf header
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

  // Title + meta styles (apply to every cell in the merged row so borders render)
  for (let c = 0; c < colCount; c++) put(ws, titleRow, c, c === 0 ? title : "", S_TITLE);
  for (let i = 0; i < banner.length; i++) {
    for (let c = 0; c < colCount; c++) {
      put(ws, metaStart + i, c, c === 0 ? banner[i] : "", S_META);
    }
  }

  // Flat headers
  flatColumns.forEach((col, idx) => {
    put(ws, headTop, idx, col.label, S_HEADER_FLAT);
    // headBot cell exists but merged with top; still stamp same style for renderers
    put(ws, headBot, idx, "", S_HEADER_FLAT);
  });

  // Stage group + leaf headers
  cursor = flatColumns.length;
  stageGroups.forEach((g) => {
    const gStyle = stageHeaderStyle(g.stage);
    const leafStyle = stageLeafStyle(g.stage);
    put(ws, headTop, cursor, g.label, gStyle);
    for (let i = 1; i < g.leaves.length; i++) put(ws, headTop, cursor + i, "", gStyle);
    g.leaves.forEach((leaf, i) => put(ws, headBot, cursor + i, leaf.label, leafStyle));
    cursor += g.leaves.length;
  });

  // Data cells
  rows.forEach((row, ri) => {
    const r = dataStart + ri;
    // Zebra striping
    const zebraFill = ri % 2 === 1 ? { fgColor: { rgb: "FFF9FAFB" } } : undefined;
    const withZebra = (base: Record<string, unknown>) =>
      zebraFill ? { ...base, fill: zebraFill } : base;

    flatColumns.forEach((col, ci) => {
      const raw = row[col.key];
      const style = withZebra(S_DATA);
      if (raw == null || raw === "") {
        put(ws, r, ci, "", style);
        return;
      }
      if (col.kind === "date") {
        const s = isoToExcelSerial(String(raw));
        if (s != null) return putDate(ws, r, ci, s, style, DATE_NUMFMT);
      } else if (col.kind === "datetime") {
        const s = isoTimestampToExcelSerial(String(raw));
        if (s != null) return putDate(ws, r, ci, s, style, DATETIME_NUMFMT);
      }
      put(ws, r, ci, raw, style);
    });

    let c = flatColumns.length;
    stageGroups.forEach((g) => {
      g.leaves.forEach((leaf) => {
        const raw = row[leaf.key];
        if (raw == null || raw === "") {
          put(ws, r, c, "", withZebra(S_DATA_CENTER));
        } else if (leaf.kind === "date") {
          const s = isoToExcelSerial(String(raw));
          if (s != null) {
            putDate(ws, r, c, s, withZebra(S_DATA_CENTER), DATE_NUMFMT);
          } else {
            put(ws, r, c, raw, withZebra(S_DATA_CENTER));
          }
        } else if (leaf.kind === "diff") {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            const base = n > 0 ? S_DIFF_POS : n < 0 ? S_DIFF_NEG : S_DATA_RIGHT;
            put(ws, r, c, n, withZebra(base));
          } else {
            put(ws, r, c, raw, withZebra(S_DATA_RIGHT));
          }
        } else {
          // gap
          const n = Number(raw);
          if (Number.isFinite(n)) put(ws, r, c, n, withZebra(S_DATA_RIGHT));
          else put(ws, r, c, raw, withZebra(S_DATA_RIGHT));
        }
        c += 1;
      });
    });
  });

  const lastCol = XLSX.utils.encode_col(colCount - 1);
  const lastRow = Math.max(dataStart + rows.length - 1, headBot);
  ws["!ref"] = `A1:${lastCol}${lastRow + 1}`;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

export function saveScheduleRevisionWorkbook(wb: XLSX.WorkBook, fileName?: string): void {
  const name = fileName ?? `Task__Schedule_Revision__${dohaStampCompact()}.xlsx`;
  XLSX.writeFile(wb, name);
}