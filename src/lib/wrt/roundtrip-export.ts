import * as XLSX from "xlsx";
import type { WrtCatalogEntry } from "./rows.functions";
import { dohaStampCompact } from "@/lib/time/doha";

/**
 * WRT 왕복 임포트 양식 Export.
 * 임포트 파서와 동일한 4행 헤더 구조(r1 타이틀 / r2 밴드 / r3 단계명 / r4 Plan·Actual)를 유지하며,
 * 내보낸 파일을 그대로 재임포트하면 변경 0건이어야 한다.
 */

const TITLE_NOTE =
  "채움 규칙:  주황=식별정보(Aconex)   초록=회신정보(Aconex 자동, 수기입력 금지)   연노랑=실적 입력칸   흰색=계획 입력칸";

const BAND_LABEL: Record<string, string> = {
  COMMERCIAL: "Commercial Stage",
  DRAFT_APPROVAL: "Draft Approval Stage",
  SUBMISSION: "Submission Stage",
};

type Col =
  | { kind: "item"; header: string; field: string }
  | { kind: "stage"; header: string; sub: string; stage_code: string; field: string };

/** 임포트 원본 파일과 동일한 컬럼 배열을 카탈로그로부터 결정적으로 재현한다. */
export function buildWrtColumns(catalog: WrtCatalogEntry[]): Col[] {
  const cols: Col[] = [
    { kind: "item", header: "DIS", field: "dis" },
    { kind: "item", header: "SERVICE", field: "service" },
    { kind: "item", header: "DOCUMENT TITLE", field: "title" },
    { kind: "item", header: "WRT NUMBER", field: "wrt_number" },
    { kind: "item", header: "TEAM", field: "team" },
    { kind: "item", header: "HDEC PIC", field: "pic" },
    { kind: "item", header: "HDEC ENG", field: "eng" },
  ];
  const sorted = [...catalog].sort((a, b) => a.sort_order - b.sort_order);
  for (const s of sorted) {
    // 원본 배치 재현: 회신일 앞에 라운드별 회신 코드, Document Preparation 앞에 Latest Status / Final Approved
    if (s.stage_code === "RESPONSE_DATE_R1")
      cols.push({ kind: "item", header: "Response by dar (R1)", field: "r1_response_code_raw" });
    if (s.stage_code === "RESPONSE_DATE_R2")
      cols.push({ kind: "item", header: "Response by dar (R2)", field: "r2_response_code_raw" });
    if (s.stage_code === "DOC_PREPARATION") {
      cols.push({ kind: "item", header: "Latest Status", field: "latest_status_raw" });
      cols.push({ kind: "item", header: "Final Approved (A)", field: "final_approved_raw" });
    }
    if (s.value_type === "flag") {
      cols.push({ kind: "stage", header: s.label, sub: "", stage_code: s.stage_code, field: "flag_value" });
    } else if (s.value_type === "single") {
      cols.push({ kind: "stage", header: s.label, sub: "Plan\nDate", stage_code: s.stage_code, field: "plan_start" });
      cols.push({
        kind: "stage",
        header: s.label,
        sub: s.actual_authority === "ACONEX" ? "Actual\nDate\n(Aconex)" : "Actual\nDate",
        stage_code: s.stage_code,
        field: "actual_start",
      });
    } else {
      cols.push({ kind: "stage", header: s.label, sub: "Plan\nStart", stage_code: s.stage_code, field: "plan_start" });
      cols.push({ kind: "stage", header: s.label, sub: "Actual\nStart", stage_code: s.stage_code, field: "actual_start" });
      cols.push({ kind: "stage", header: s.label, sub: "Plan\nFinish", stage_code: s.stage_code, field: "plan_finish" });
      cols.push({ kind: "stage", header: s.label, sub: "Actual\nFinish", stage_code: s.stage_code, field: "actual_finish" });
    }
  }
  return cols;
}

export type WrtExportPayload = {
  catalog: WrtCatalogEntry[];
  items: any[];
  progress: any[];
};

const PLOT_SHEET: Record<string, string> = { C: "WRT Plot 3", D: "WRT Plot 4" };

export function buildWrtRoundtripWorkbook(payload: WrtExportPayload): XLSX.WorkBook {
  const cols = buildWrtColumns(payload.catalog);
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
  for (const plot of ["D", "C"] as const) {
    const rows = payload.items
      .filter((i) => (i.plot ?? "").toUpperCase() === plot)
      .sort((a, b) => String(a.wrt_number).localeCompare(String(b.wrt_number)));

    const aoa: any[][] = [];
    const r1: any[] = new Array(cols.length).fill(null);
    r1[0] = `PLOT-${plot}   WARRANTY (WRT) — SUBMISSION & APPROVAL STATUS`;
    r1[8] = TITLE_NOTE;
    aoa.push(r1);

    // 밴드행: 각 밴드 첫 컬럼 + Approval Status(= Latest Status 열)
    const r2: any[] = new Array(cols.length).fill(null);
    let prevBand = "";
    cols.forEach((c, idx) => {
      if (c.kind === "item" && c.field === "latest_status_raw") {
        r2[idx] = "Approval Status";
        return;
      }
      if (c.kind !== "stage") return;
      const band = payload.catalog.find((s) => s.stage_code === c.stage_code)?.band ?? "";
      if (band && band !== prevBand) {
        r2[idx] = BAND_LABEL[band];
        prevBand = band;
      }
    });
    aoa.push(r2);

    aoa.push(
      cols.map((c, i) =>
        c.kind === "stage" && i > 0 && cols[i - 1].kind === "stage" && (cols[i - 1] as any).stage_code === c.stage_code
          ? null
          : c.header,
      ),
    );
    aoa.push(cols.map((c) => (c.kind === "stage" ? c.sub || null : null)));

    for (const it of rows) {
      const stages = byItem.get(it.id);
      aoa.push(
        cols.map((c) => {
          if (c.kind === "item") return it[c.field] ?? null;
          const sp = stages?.get(c.stage_code);
          const v = sp?.[c.field];
          return v == null || v === "" ? null : String(v).slice(0, 10);
        }),
      );
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((c) => ({ wch: c.kind === "item" ? 18 : 12 }));
    XLSX.utils.book_append_sheet(wb, ws, PLOT_SHEET[plot]);
  }
  return wb;
}

export function downloadWrtRoundtripWorkbook(payload: WrtExportPayload): string {
  const wb = buildWrtRoundtripWorkbook(payload);
  const name = `WRT_Status_${dohaStampCompact()}.xlsx`;
  XLSX.writeFile(wb, name);
  return name;
}