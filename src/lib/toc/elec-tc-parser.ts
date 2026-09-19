import * as XLSX from "xlsx";

/**
 * 전기 T&C 잔여 파일(`Detail Status (YYMMDD)` 시트) 파서.
 *
 * 규칙(프로젝트 임포트 규칙 준수):
 *  - 헤더는 **텍스트로만** 찾는다. 위치·순서·인덱스로 가정하지 않는다.
 *  - `System` 행을 블록 머리로 보고 블록마다 헤더를 다시 찾는다.
 *  - 병합셀은 좌측 라벨 forward-fill.
 *  - `Total` 행과 값이 전혀 없는 행은 제외하고 사유별로 센다.
 *  - Completion 하위 헤더는 날짜여야 한다. 날짜가 아닌 열은 미매핑으로 남긴다.
 *  - Status 값은 원문을 보존하고, 사전에 없는 토큰은 추측하지 않고 보고한다.
 */

export type ElecStatusToken = "NS" | "UR" | "B" | "A" | "C";

/** 낮은 단계부터 (미착수 < 검토중 < Code B < Code A). Code C 는 반려로 별도. */
const RANK: Record<Exclude<ElecStatusToken, "C">, number> = { NS: 0, UR: 1, B: 2, A: 3 };

export const ELEC_STATUS_TO_TOC: Record<ElecStatusToken, string> = {
  NS: "Not Submitted",
  UR: "UR IFM",
  B: "Code B",
  A: "Code A",
  C: "Code C",
};

export interface ParsedElecRow {
  sheet_name: string;
  excel_row: number;
  source_system: string;
  source_sub: string;
  source_description: string;
  /** 파일 원문 (화면·로그에 그대로 보여준다) */
  status_raw: string | null;
  statuses: ElecStatusToken[];
  /** 대표 상태 = 가장 낮은 단계 (C 가 있으면 Code C) */
  toc_status: string | null;
  /** 숫자가 들어 있는 Completion 열 중 가장 늦은 열의 날짜 (YYYY-MM-DD) */
  target_finish: string | null;
  /** 각 Completion 열의 잔여 수량 (표시용) */
  completion: Array<{ date: string; qty: number }>;
  remaining_detail: string | null;
}

export interface ParsedElecFile {
  file_name: string;
  sheet_name: string;
  rows: ParsedElecRow[];
  /** 제외 사유별 건수 (항등식 검산용) */
  skipped: Array<{ reason: string; count: number }>;
  total_scanned: number;
  unmapped_headers: string[];
  unknown_status_tokens: Array<{ token: string; count: number; samples: string[] }>;
}

function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function txt(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" || t === "-" ? null : t;
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
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

function parseStatus(raw: string | null): { tokens: ElecStatusToken[]; unknown: string[] } {
  if (!raw) return { tokens: [], unknown: [] };
  const tokens: ElecStatusToken[] = [];
  const unknown: string[] = [];
  for (const part of raw.split(/[,/|\n]+/)) {
    const t = part.trim();
    if (t === "") continue;
    const u = t.toUpperCase();
    if (u === "0" || u === "O" || u === "CODE A" || u === "A") tokens.push("A");
    else if (u === "B" || u === "CODE B") tokens.push("B");
    else if (u === "C" || u === "CODE C") tokens.push("C");
    else if (u === "NS" || u === "NOT START" || u === "N/S") tokens.push("NS");
    else if (u === "UR" || u === "U/R") tokens.push("UR");
    else unknown.push(t);
  }
  return { tokens: Array.from(new Set(tokens)), unknown };
}

/** 여러 값이 섞이면 가장 낮은 단계. C 가 있으면 반려(Code C). */
export function representativeStatus(tokens: ElecStatusToken[]): string | null {
  if (tokens.length === 0) return null;
  if (tokens.includes("C")) return ELEC_STATUS_TO_TOC.C;
  const others = tokens.filter((t): t is Exclude<ElecStatusToken, "C"> => t !== "C");
  if (others.length === 0) return null;
  const lowest = others.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
  return ELEC_STATUS_TO_TOC[lowest];
}

export async function parseElecTcFile(file: File): Promise<ParsedElecFile> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheetName =
    wb.SheetNames.filter((n) => norm(n).startsWith("detail status")).sort().reverse()[0] ?? null;
  if (!sheetName) {
    throw new Error(
      `'Detail Status' 로 시작하는 시트를 찾지 못했습니다. 파일의 시트: ${wb.SheetNames.join(", ")}`,
    );
  }
  const ws = wb.Sheets[sheetName]!;
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const cell = (r: number, c: number): unknown => {
    const v = ws[XLSX.utils.encode_cell({ r, c })];
    return v?.v ?? null;
  };

  const skipCounts = new Map<string, number>();
  const skip = (reason: string) => skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
  const unmapped = new Set<string>();
  const unknownTokens = new Map<string, { count: number; samples: string[] }>();

  const rows: ParsedElecRow[] = [];
  let scanned = 0;

  // 블록 머리('System' 라벨) 위치를 모두 찾는다.
  const heads: Array<{ hdrRow: number; systemCol: number }> = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (norm(cell(r, c)) === "system") {
        heads.push({ hdrRow: r, systemCol: c });
        break;
      }
    }
  }
  if (heads.length === 0) {
    throw new Error(`시트 "${sheetName}": 'System' 헤더를 찾지 못했습니다. 전기 T&C 파일 양식이 맞는지 확인하세요.`);
  }

  for (let bi = 0; bi < heads.length; bi++) {
    const { hdrRow, systemCol } = heads[bi]!;
    const endRow = bi + 1 < heads.length ? heads[bi + 1]!.hdrRow - 1 : range.e.r;
    const subRow = hdrRow + 1; // 하위 헤더 (Status / Completion 날짜 등)
    const systemLabel = txt(cell(hdrRow, systemCol + 1)) ?? "";

    // 열 매핑: 텍스트 헤더만 사용
    let descCol = -1;
    let statusCol = -1;
    let remainingDetailCol = -1;
    const completionCols: Array<{ col: number; date: string }> = [];
    let completionStart = -1;
    let completionEnd = range.e.c;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const label = norm(cell(hdrRow, c));
      if (label === "description") descCol = c;
      if (label === "completion") completionStart = c;
      else if (label !== "" && completionStart >= 0 && c > completionStart && completionEnd === range.e.c) {
        completionEnd = c - 1;
      }
      const sub = norm(cell(subRow, c));
      if (sub === "status" && statusCol < 0) statusCol = c;
      if (sub === "remaining detail") remainingDetailCol = c;
    }
    if (descCol < 0 || statusCol < 0 || completionStart < 0) {
      if (descCol < 0) unmapped.add(`${systemLabel || "블록"} · Description`);
      if (statusCol < 0) unmapped.add(`${systemLabel || "블록"} · Status`);
      if (completionStart < 0) unmapped.add(`${systemLabel || "블록"} · Completion`);
      continue;
    }
    for (let c = completionStart; c <= completionEnd; c++) {
      const d = excelDate(cell(subRow, c));
      if (d) completionCols.push({ col: c, date: d });
      else if (txt(cell(subRow, c))) unmapped.add(`Completion · ${String(cell(subRow, c))}`);
    }
    if (completionCols.length === 0) {
      unmapped.add(`${systemLabel || "블록"} · Completion (날짜 헤더 없음)`);
      continue;
    }

    let curSub: string | null = null;
    for (let r = subRow + 2; r <= endRow; r++) {
      scanned += 1;
      const subLabel = txt(cell(r, systemCol + 1));
      if (subLabel) curSub = subLabel;
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
      const desc = txt(cell(r, descCol));
      const statusRaw = txt(cell(r, statusCol));
      if (!desc && !curSub) {
        skip("시스템·설명 없음");
        continue;
      }
      if (!statusRaw) {
        skip("Status 공란");
        continue;
      }

      const { tokens, unknown } = parseStatus(statusRaw);
      for (const u of unknown) {
        const b = unknownTokens.get(u) ?? { count: 0, samples: [] };
        b.count += 1;
        if (b.samples.length < 3) b.samples.push(`${sheetName} ${r + 1}행 · ${curSub ?? ""} / ${desc ?? ""}`);
        unknownTokens.set(u, b);
      }

      const completion: Array<{ date: string; qty: number }> = [];
      for (const cc of completionCols) {
        const v = cell(r, cc.col);
        const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
        if (Number.isFinite(n) && String(v ?? "").trim() !== "") completion.push({ date: cc.date, qty: n });
      }
      const target = completion.length > 0 ? completion.map((x) => x.date).sort().slice(-1)[0]! : null;

      rows.push({
        sheet_name: sheetName,
        excel_row: r + 1,
        source_system: systemLabel,
        source_sub: curSub ?? "",
        source_description: desc ?? "",
        status_raw: statusRaw,
        statuses: tokens,
        toc_status: representativeStatus(tokens),
        target_finish: target,
        completion,
        remaining_detail: remainingDetailCol >= 0 ? txt(cell(r, remainingDetailCol)) : null,
      });
    }
  }

  return {
    file_name: file.name,
    sheet_name: sheetName,
    rows,
    skipped: Array.from(skipCounts.entries()).map(([reason, count]) => ({ reason, count })),
    total_scanned: scanned,
    unmapped_headers: Array.from(unmapped),
    unknown_status_tokens: Array.from(unknownTokens.entries()).map(([token, b]) => ({ token, ...b })),
  };
}
