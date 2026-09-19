import * as XLSX from "xlsx";

/**
 * 설비 T&C 잔여 파일(`Plot-D_Remaining Works Status` 시트) 파서.
 *
 * 규칙(프로젝트 임포트 규칙 준수):
 *  - 헤더는 **텍스트로만** 찾는다. 위치·순서·인덱스로 가정하지 않는다.
 *  - 병합셀 좌측 라벨(System)은 forward-fill.
 *  - 합계 행·빈 행은 제외하고 사유별로 센다.
 *  - 값의 형태가 정의와 다르면(수량 열에 숫자 비율 80% 미달) 해당 열을 미매핑으로 강등한다.
 *  - 파일의 `SOW_Mech` 열은 대응표가 비었을 때 쓰는 **후보**로만 읽는다(연결 근거는 대응표).
 */

export type MechQtyField = "not_raised" | "ur" | "code_c" | "code_b" | "code_a";

/** 낮은 단계부터 (미착수 < 검토중 < Code B < Code A). Code C 는 반려로 별도. */
export const MECH_STATUS_ORDER = ["Not Submitted", "UR IFM", "Code B", "Code A"] as const;

export interface ParsedMechRow {
  sheet_name: string;
  excel_row: number;
  source_system: string;
  source_description: string;
  /** 파일의 SOW_Mech 열 (대응표 후보) */
  sow_candidate: string | null;
  cms_code: string | null;
  qty_total: number | null;
  qty: Record<MechQtyField, number | null>;
  /** 원문 (Closed / Open) */
  status_raw: string | null;
  /** 대표 상태: Closed → T&C 완료, Open → 수량 기준 가장 낮은 단계 */
  is_closed: boolean;
  toc_status: string | null;
  /** TARGET DATE (YYYY-MM-DD) */
  target_finish: string | null;
}

export interface ParsedMechFile {
  file_name: string;
  sheet_name: string;
  rows: ParsedMechRow[];
  skipped: Array<{ reason: string; count: number }>;
  total_scanned: number;
  /** 헤더를 못 찾았거나 형태 검증에서 강등된 열 */
  unmapped_headers: string[];
  /** Closed 인데 미완료 수량이 남아 있는 등 모순 행 */
  inconsistent: Array<{ excel_row: number; source: string; message: string }>;
}

function norm(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function txt(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" || t === "-" ? null : t;
}

function num(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function excelDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (typeof v === "string") {
    const t = v.trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // 15/Sep/26, 15-Sep-2026
    m = t.match(/^(\d{1,2})[/\-\s]([A-Za-z]{3,})[/\-\s](\d{2,4})$/);
    if (m) {
      const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const mi = months.indexOf(m[2]!.slice(0, 3).toLowerCase());
      if (mi >= 0) {
        const yr = Number(m[3]);
        const y = yr < 100 ? 2000 + yr : yr;
        return `${y}-${String(mi + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
      }
    }
  }
  return null;
}

/** 수량 기준 대표 상태 — 가장 낮은 단계. Code-C 수량이 있으면 반려. */
export function representativeMechStatus(q: Record<MechQtyField, number | null>): string | null {
  if ((q.code_c ?? 0) > 0) return "Code C";
  if ((q.not_raised ?? 0) > 0) return "Not Submitted";
  if ((q.ur ?? 0) > 0) return "UR IFM";
  if ((q.code_b ?? 0) > 0) return "Code B";
  if ((q.code_a ?? 0) > 0) return "Code A";
  return null;
}

const QTY_HEADERS: Array<{ field: MechQtyField; labels: string[] }> = [
  { field: "not_raised", labels: ["not raised", "notraised"] },
  { field: "ur", labels: ["u/r", "ur"] },
  { field: "code_c", labels: ["code-c", "code c"] },
  { field: "code_b", labels: ["code-b", "code b"] },
  { field: "code_a", labels: ["code-a", "code a"] },
];

export async function parseMechTcFile(file: File): Promise<ParsedMechFile> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => norm(n).includes("remaining works status") && !norm(n).includes("plot-c")) ??
    wb.SheetNames.find((n) => norm(n).includes("remaining works status")) ??
    null;
  if (!sheetName) {
    throw new Error(
      `'Remaining Works Status' 시트를 찾지 못했습니다. 파일의 시트: ${wb.SheetNames.join(", ")}`,
    );
  }
  const ws = wb.Sheets[sheetName]!;
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const cell = (r: number, c: number): unknown => ws[XLSX.utils.encode_cell({ r, c })]?.v ?? null;

  const unmapped = new Set<string>();
  const skipCounts = new Map<string, number>();
  const skip = (reason: string) => skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
  const inconsistent: ParsedMechFile["inconsistent"] = [];

  // ── 헤더 행 탐색: 'System' 텍스트가 있는 행. 하위 헤더는 그 다음 행.
  let hdrRow = -1;
  let systemCol = -1;
  outer: for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (norm(cell(r, c)) === "system") {
        hdrRow = r;
        systemCol = c;
        break outer;
      }
    }
  }
  if (hdrRow < 0) {
    throw new Error(`시트 "${sheetName}": 'System' 헤더를 찾지 못했습니다. 설비 T&C 파일 양식이 맞는지 확인하세요.`);
  }
  const subRow = hdrRow + 1;

  let descCol = -1;
  let sowCol = -1;
  let cmsCol = -1;
  let totalCol = -1;
  let statusCol = -1;
  let targetCol = -1;
  const qtyCols = new Map<MechQtyField, number>();

  for (let c = range.s.c; c <= range.e.c; c++) {
    const top = norm(cell(hdrRow, c));
    const sub = norm(cell(subRow, c));
    for (const label of [top, sub]) {
      if (label === "") continue;
      if (descCol < 0 && (label.includes("equipment / system description") || label === "description")) descCol = c;
      if (sowCol < 0 && label.includes("sow_mech")) sowCol = c;
      if (cmsCol < 0 && label.includes("cms code")) cmsCol = c;
      if (totalCol < 0 && (label === "q'ty" || label === "qty" || label === "q’ty")) totalCol = c;
      if (statusCol < 0 && label === "status") statusCol = c;
      if (targetCol < 0 && label.includes("target date")) targetCol = c;
      for (const q of QTY_HEADERS) {
        if (!qtyCols.has(q.field) && q.labels.includes(label)) qtyCols.set(q.field, c);
      }
    }
  }
  if (descCol < 0) throw new Error(`시트 "${sheetName}": 'Equipment / System Description' 열을 찾지 못했습니다.`);
  if (statusCol < 0) unmapped.add("Status");
  if (targetCol < 0) unmapped.add("TARGET DATE");
  if (sowCol < 0) unmapped.add("SOW_Mech (연결 후보)");
  if (cmsCol < 0) unmapped.add("CMS Code");
  if (totalCol < 0) unmapped.add("Q'ty");
  for (const q of QTY_HEADERS) if (!qtyCols.has(q.field)) unmapped.add(`수량 · ${q.labels[0]}`);

  // ── 본문 수집
  type Raw = { r: number; system: string; desc: string };
  const raws: Raw[] = [];
  let curSystem = "";
  let scanned = 0;
  for (let r = subRow + 1; r <= range.e.r; r++) {
    scanned += 1;
    const sysLabel = txt(cell(r, systemCol));
    if (sysLabel) curSystem = sysLabel;
    const desc = txt(cell(r, descCol));
    const rowVals: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const t = txt(cell(r, c));
      if (t) rowVals.push(t);
    }
    if (rowVals.length === 0) {
      skip("빈 행");
      continue;
    }
    if (rowVals.some((v) => norm(v) === "total")) {
      skip("합계 행");
      continue;
    }
    if (!desc) {
      skip("설명 없음");
      continue;
    }
    raws.push({ r, system: curSystem, desc });
  }

  // ── 형태 검증(임계 80%): 수량 열에 숫자 비율이 낮으면 미매핑으로 강등
  const demoted = new Set<MechQtyField>();
  for (const [field, col] of qtyCols) {
    let filled = 0;
    let numeric = 0;
    for (const raw of raws) {
      const v = cell(raw.r, col);
      if (v == null || String(v).trim() === "") continue;
      filled += 1;
      if (num(v) != null) numeric += 1;
    }
    if (filled > 0 && numeric / filled < 0.8) {
      demoted.add(field);
      const samples = raws
        .map((raw) => txt(cell(raw.r, col)))
        .filter((v): v is string => v != null)
        .slice(0, 3);
      unmapped.add(
        `수량 · ${field} — 숫자 비율 ${Math.round((numeric / filled) * 100)}% (모집단 ${filled}건, 예: ${samples.join(", ")})`,
      );
    }
  }
  let targetDemoted = false;
  if (targetCol >= 0) {
    let filled = 0;
    let dates = 0;
    const bad: string[] = [];
    for (const raw of raws) {
      const v = cell(raw.r, targetCol);
      if (v == null || String(v).trim() === "") continue;
      filled += 1;
      if (excelDate(v) != null) dates += 1;
      else if (bad.length < 3) bad.push(String(v));
    }
    if (filled > 0 && dates / filled < 0.8) {
      targetDemoted = true;
      unmapped.add(
        `TARGET DATE — 날짜 비율 ${Math.round((dates / filled) * 100)}% (모집단 ${filled}건, 예: ${bad.join(", ")})`,
      );
    }
  }

  const rows: ParsedMechRow[] = [];
  for (const raw of raws) {
    const statusRaw = statusCol >= 0 ? txt(cell(raw.r, statusCol)) : null;
    const q: Record<MechQtyField, number | null> = {
      not_raised: null,
      ur: null,
      code_c: null,
      code_b: null,
      code_a: null,
    };
    for (const [field, col] of qtyCols) {
      if (demoted.has(field)) continue;
      q[field] = num(cell(raw.r, col));
    }
    const isClosed = norm(statusRaw) === "closed";
    const byQty = representativeMechStatus(q);
    const source = [raw.system, raw.desc].filter(Boolean).join(" / ");
    if (isClosed && byQty != null && byQty !== "Code A") {
      inconsistent.push({
        excel_row: raw.r + 1,
        source,
        message: `Status=Closed 인데 미완료 수량이 남아 있습니다 (${byQty})`,
      });
    }
    rows.push({
      sheet_name: sheetName,
      excel_row: raw.r + 1,
      source_system: raw.system,
      source_description: raw.desc,
      sow_candidate: sowCol >= 0 ? txt(cell(raw.r, sowCol)) : null,
      cms_code: cmsCol >= 0 ? txt(cell(raw.r, cmsCol)) : null,
      qty_total: totalCol >= 0 ? num(cell(raw.r, totalCol)) : null,
      qty: q,
      status_raw: statusRaw,
      is_closed: isClosed,
      // Closed 는 T&C 완료(단계 상태)로만 처리하고 toc_status 는 건드리지 않는다.
      toc_status: isClosed ? null : byQty,
      target_finish: targetCol >= 0 && !targetDemoted ? excelDate(cell(raw.r, targetCol)) : null,
    });
  }

  return {
    file_name: file.name,
    sheet_name: sheetName,
    rows,
    skipped: Array.from(skipCounts.entries()).map(([reason, count]) => ({ reason, count })),
    total_scanned: scanned,
    unmapped_headers: Array.from(unmapped),
    inconsistent,
  };
}
