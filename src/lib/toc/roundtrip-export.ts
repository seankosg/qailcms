import XLSX from "xlsx-js-style";
import type { TocCatalogEntry, TocRow } from "./rows.functions";
import { dohaStampCompact } from "@/lib/time/doha";
import { styleRoundtripSheet, type RtColMeta } from "@/lib/excel/roundtrip-style";
import { TOC_BANDS } from "./columns";

/**
 * TOC(Handover) 왕복 임포트 양식 Export.
 * 임포트 파서와 같은 4행 헤더 구조(r1 타이틀 / r2 밴드 / r3 단계명 / r4 Plan·Actual·Status)를 쓰며,
 * 내보낸 파일을 그대로 재임포트하면 변경 0건이어야 한다.
 *
 * 양식에 없는 항목(= 임포트로 바꿀 수 없는 항목): 단계 N/A 표시, 단계 비고, 교육 세션 자체,
 * 판정·준비도·밴드 상태(정본 파생).
 */

const TITLE_NOTE =
  "채움 규칙:  주황=식별정보(수정 시 주의)   초록=IFM·CMS 정보(수기입력 금지)   연노랑=실적 입력칸   흰색=계획 입력칸";

const BAND_LABEL: Record<string, string> = Object.fromEntries(TOC_BANDS.map((b) => [b.band, b.label]));

export type TocRtCol =
  | { kind: "item"; header: string; field: string; numeric?: boolean; date?: boolean; locked?: boolean }
  | { kind: "status"; header: string; field: string }
  | {
      kind: "stage";
      header: string;
      sub: string;
      stage_code: string;
      field: "plan_start" | "actual_start" | "plan_finish" | "actual_finish" | "code_value";
      band: string;
      authority: "HDEC" | "ACONEX";
      /** 정본이 다른 표(교육 세션)라서 임포트로 쓸 수 없는 칸 */
      readOnly?: boolean;
    };

/** 식별·속성 열 (파서와 공유하는 결정적 정의) */
export const TOC_ITEM_COLS: Extract<TocRtCol, { kind: "item" }>[] = [
  { kind: "item", header: "ITEM KEY", field: "item_key", locked: true },
  { kind: "item", header: "PLOT", field: "plot" },
  { kind: "item", header: "ITEM NO", field: "item_no" },
  { kind: "item", header: "MAIN SYSTEM", field: "main_system" },
  { kind: "item", header: "SUB SYSTEM", field: "sub_system" },
  { kind: "item", header: "LOCATION", field: "location" },
  { kind: "item", header: "TRADE", field: "team_raw" },
  { kind: "item", header: "TEAM", field: "team" },
  { kind: "item", header: "SUPPLIER", field: "supplier" },
  { kind: "item", header: "HDEC PIC", field: "pic" },
  { kind: "item", header: "HDEC ENG", field: "eng" },
  { kind: "item", header: "T&C QTY", field: "tac_qty_total", numeric: true },
  { kind: "item", header: "T&C ISSUED", field: "tac_qty_issued", numeric: true },
  { kind: "item", header: "ABD QTY", field: "abd_qty_total", numeric: true },
  { kind: "item", header: "ABD CODE A", field: "abd_qty_code_a", numeric: true },
  { kind: "item", header: "TOC REF", field: "toc_ref" },
  { kind: "item", header: "EXPECTED H/O", field: "expected_ho_date", date: true },
];

/** 임포트 양식 컬럼 배열 — Export/파서 양쪽에서 같은 함수로 만든다. */
export function buildTocColumns(catalog: TocCatalogEntry[]): TocRtCol[] {
  const cols: TocRtCol[] = [...TOC_ITEM_COLS];
  cols.push({ kind: "status", header: "TOC STATUS", field: "toc_status" });

  for (const s of [...catalog].sort((a, b) => a.sort_order - b.sort_order)) {
    const authority: "HDEC" | "ACONEX" = s.actual_authority === "HDEC" ? "HDEC" : "ACONEX";
    const readOnly = s.band === "TRAINING";
    const base = { kind: "stage" as const, header: s.label, stage_code: s.stage_code, band: s.band, authority, readOnly };
    if (s.value_type === "range") {
      cols.push({ ...base, sub: "Plan\nStart", field: "plan_start" });
      cols.push({ ...base, sub: "Actual\nStart", field: "actual_start" });
    }
    cols.push({ ...base, sub: "Plan\nDate", field: "plan_finish" });
    cols.push({
      ...base,
      sub: authority === "HDEC" ? "Actual\nDate" : "Actual\nDate\n(IFM·CMS)",
      field: "actual_finish",
    });
    cols.push({ ...base, sub: "Status\nCode", field: "code_value" });
  }
  return cols;
}

const PLOT_SHEET: Record<string, string> = { C: "TOC Plot 3", D: "TOC Plot 4" };
export const TOC_SHEET_PLOT: Record<string, "C" | "D"> = { "TOC PLOT 3": "C", "TOC PLOT 4": "D" };

export interface TocExportPayload {
  catalog: TocCatalogEntry[];
  rows: TocRow[];
}

export function buildTocRoundtripWorkbook(payload: TocExportPayload): XLSX.WorkBook {
  const cols = buildTocColumns(payload.catalog);
  const wb = XLSX.utils.book_new();

  for (const plot of ["C", "D"] as const) {
    const rows = payload.rows
      .filter((r) => (r.plot ?? "").toUpperCase() === plot)
      .sort((a, b) => String(a.item_key).localeCompare(String(b.item_key)));

    const aoa: unknown[][] = [];
    const r1: unknown[] = new Array(cols.length).fill(null);
    r1[0] = `PLOT-${plot}   HANDOVER (TOC) — READINESS & HANDOVER STATUS`;
    r1[8] = TITLE_NOTE;
    aoa.push(r1);

    const r2: unknown[] = new Array(cols.length).fill(null);
    let prevBand = "";
    cols.forEach((c, idx) => {
      if (c.kind !== "stage") return;
      if (c.band && c.band !== prevBand) {
        r2[idx] = BAND_LABEL[c.band] ?? c.band;
        prevBand = c.band;
      }
    });
    aoa.push(r2);

    aoa.push(
      cols.map((c, i) => {
        const prev = cols[i - 1];
        if (c.kind === "stage" && prev && prev.kind === "stage" && prev.stage_code === c.stage_code) return null;
        return c.header;
      }),
    );
    aoa.push(cols.map((c) => (c.kind === "stage" ? c.sub : null)));

    for (const row of rows) {
      aoa.push(
        cols.map((c) => {
          if (c.kind === "item" || c.kind === "status") {
            const v = (row as unknown as Record<string, unknown>)[c.field];
            if (v == null || v === "") return null;
            if (c.kind === "item" && c.date) return String(v).slice(0, 10);
            return v as string | number;
          }
          const cell = row.stages[c.stage_code];
          if (!cell) return null;
          if (c.field === "code_value") return cell.cv ?? null;
          const key = { plan_start: "ps", actual_start: "as", plan_finish: "pf", actual_finish: "af" }[c.field] as
            | "ps"
            | "as"
            | "pf"
            | "af";
          const v = cell[key];
          return v ? String(v).slice(0, 10) : null;
        }),
      );
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    styleRoundtripSheet(ws, cols as unknown as RtColMeta[], rows.length, 2);
    XLSX.utils.book_append_sheet(wb, ws, PLOT_SHEET[plot]);
  }
  return wb;
}

export function downloadTocRoundtripWorkbook(payload: TocExportPayload): string {
  const wb = buildTocRoundtripWorkbook(payload);
  const name = `TOC_Status_${dohaStampCompact()}.xlsx`;
  XLSX.writeFile(wb, name);
  return name;
}
