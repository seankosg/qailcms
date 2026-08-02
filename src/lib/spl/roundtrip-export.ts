import XLSX from "xlsx-js-style";
import type { SplCatalogEntry } from "./rows.functions";
import { dohaStampCompact } from "@/lib/time/doha";
import { styleRoundtripSheet, type RtColMeta } from "@/lib/excel/roundtrip-style";

/**
 * SPL 왕복 임포트 양식 Export.
 * 임포트 파서와 동일한 4행 헤더 구조(r1 타이틀 / r2 밴드 / r3 단계명 / r4 Plan·Actual)를 유지하며,
 * 내보낸 파일을 그대로 재임포트하면 변경 0건이어야 한다.
 */

const TITLE_NOTE =
  "채움 규칙:  주황=식별정보(Aconex)   초록=회신정보(Aconex 자동, 수기입력 금지)   연노랑=실적 입력칸   흰색=계획 입력칸";

const BAND_LABEL: Record<string, string> = {
  REQUIRED_DOC: "Required Doc",
  DOCUMENTATION: "Documentation Stage",
  PO: "PO Stage",
};

type Col =
  | { kind: "item"; header: string; field: string }
  | { kind: "status"; header: string }
  | {
      kind: "stage";
      header: string;
      sub: string;
      stage_code: string;
      field: string;
      band: string;
      authority: "HDEC" | "ACONEX";
    };

/** 임포트 원본 파일과 동일한 컬럼 배열을 카탈로그로부터 결정적으로 재현한다. */
export function buildSplColumns(catalog: SplCatalogEntry[]): Col[] {
  const cols: Col[] = [
    { kind: "item", header: "DIS", field: "dis" },
    { kind: "item", header: "SERVICE", field: "service" },
    { kind: "item", header: "DOCUMENT TITLE", field: "title" },
    { kind: "item", header: "SPL NUMBER", field: "spl_number" },
    { kind: "item", header: "TEAM", field: "team" },
    { kind: "item", header: "HDEC PIC", field: "pic" },
    { kind: "item", header: "HDEC ENG", field: "eng" },
    { kind: "item", header: "SUPPLIER", field: "supplier" },
  ];
  const sorted = [...catalog].sort((a, b) => a.sort_order - b.sort_order);
  for (const s of sorted) {
    // 원본 배치 재현: Approval date 앞에 Approval Status, RFQ Draft 앞에 PO 담당자 2열
    if (s.stage_code === "APPROVAL_DATE") cols.push({ kind: "status", header: "Approval Status" });
    if (s.stage_code === "RFQ_DRAFT") {
      cols.push({ kind: "item", header: "HDEC PIC (PO)", field: "pic_po" });
      cols.push({ kind: "item", header: "HDEC ENG (PO)", field: "eng_po" });
    }
    if (s.value_type === "flag") {
      cols.push({ kind: "stage", header: s.label, sub: "", stage_code: s.stage_code, field: "flag_value", band: s.band, authority: s.actual_authority });
    } else if (s.value_type === "single") {
      cols.push({ kind: "stage", header: s.label, sub: "Plan\nDate", stage_code: s.stage_code, field: "plan_start", band: s.band, authority: s.actual_authority });
      cols.push({
        kind: "stage",
        header: s.label,
        sub: s.actual_authority === "ACONEX" ? "Actual\nDate\n(Aconex)" : "Actual\nDate",
        stage_code: s.stage_code,
        field: "actual_start",
        band: s.band,
        authority: s.actual_authority,
      });
    } else {
      const base = { kind: "stage" as const, header: s.label, stage_code: s.stage_code, band: s.band, authority: s.actual_authority };
      cols.push({ ...base, sub: "Plan\nStart", field: "plan_start" });
      cols.push({ ...base, sub: "Actual\nStart", field: "actual_start" });
      cols.push({ ...base, sub: "Plan\nFinish", field: "plan_finish" });
      cols.push({ ...base, sub: "Actual\nFinish", field: "actual_finish" });
    }
  }
  return cols;
}

export interface SplExportPayload {
  catalog: SplCatalogEntry[];
  items: any[];
  progress: any[];
}

const PLOT_SHEET: Record<string, string> = { C: "SPL Plot 3", D: "SPL Plot 4" };

export function buildSplRoundtripWorkbook(payload: SplExportPayload): XLSX.WorkBook {
  const cols = buildSplColumns(payload.catalog);
  const byItem = new Map<string, Map<string, any>>();
  for (const p of payload.progress) {
    let m = byItem.get(p.item_id);
    if (!m) {
      m = new Map();
      byItem.set(p.item_id, m);
    }
    m.set(p.stage_code, p);
  }

  const wb = XLSX.utils.book_new();
  for (const plot of ["C", "D"] as const) {
    const rows = payload.items
      .filter((i) => (i.plot ?? "").toUpperCase() === plot)
      .sort((a, b) => String(a.spl_number).localeCompare(String(b.spl_number)));

    const aoa: any[][] = [];
    const r1: any[] = new Array(cols.length).fill(null);
    r1[0] = `PLOT-${plot}   SPARE PARTS (SPL) — SUBMISSION & PO STATUS`;
    r1[8] = TITLE_NOTE;
    aoa.push(r1);

    const r2: any[] = new Array(cols.length).fill(null);
    let prevBand = "";
    cols.forEach((c, idx) => {
      if (c.kind !== "stage") return;
      const band = payload.catalog.find((s) => s.stage_code === c.stage_code)?.band ?? "";
      if (band && band !== prevBand) {
        // PO 밴드는 원본과 동일하게 담당자 2열부터 시작
        const start = band === "PO" ? idx - 2 : idx;
        r2[start] = BAND_LABEL[band];
        prevBand = band;
      }
    });
    aoa.push(r2);

    aoa.push(cols.map((c, i) => (c.kind === "stage" && i > 0 && cols[i - 1].kind === "stage" && (cols[i - 1] as any).stage_code === c.stage_code ? null : c.header)));
    aoa.push(cols.map((c) => (c.kind === "stage" ? c.sub || null : null)));

    for (const it of rows) {
      const stages = byItem.get(it.id);
      aoa.push(
        cols.map((c) => {
          if (c.kind === "item") return it[c.field] ?? null;
          if (c.kind === "status") return it.approval_status_raw ?? null;
          const sp = stages?.get(c.stage_code);
          const v = sp?.[c.field];
          return v == null || v === "" ? null : String(v).slice(0, 10);
        }),
      );
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    styleRoundtripSheet(ws, cols as unknown as RtColMeta[], rows.length, 4);
    XLSX.utils.book_append_sheet(wb, ws, PLOT_SHEET[plot]);
  }
  return wb;
}

export function downloadSplRoundtripWorkbook(payload: SplExportPayload): string {
  const wb = buildSplRoundtripWorkbook(payload);
  const name = `SPL_Status_${dohaStampCompact()}.xlsx`;
  XLSX.writeFile(wb, name);
  return name;
}