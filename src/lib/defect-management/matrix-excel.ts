// SM 대시보드 매트릭스 → 스타일 적용 Excel 내보내기 (화면 구조 1:1)
import XLSX from "xlsx-js-style";
import { dohaDateTime } from "@/lib/time/doha";
import { formatHoDate, EMPTY_HO_DATE_MAP, type HoDateMap } from "./ho-dates";
import { EMPTY_STAGE_DATE_MAP, type StageDateMap } from "./stage-dates";
import {
  TEAM_COL_ORDER,
  bottleneckTeam,
  mergeStats,
  newStats,
  STAGE_METRICS,
  type StageMetric,
  type MatrixBlock,
  type MatrixShape,
  type Stats,
  type TeamKey,
} from "./dashboard-shape";

type Slot = "issued" | StageMetric;
const SLOTS: Array<{ slot: Slot; label: string }> = [
  { slot: "issued", label: "Issued" },
  ...STAGE_METRICS.map((m) => ({ slot: m.slot as Slot, label: m.label })),
];
const TEAM_LABEL: Record<TeamKey, string> = { ELEC: "Elec", MECH: "Mech", ARCH: "Arch" };

const F = "Calibri";
const thin = (rgb: string) => ({ style: "thin", color: { rgb } }) as const;
const BOX = {
  top: thin("FFB9C2CF"),
  bottom: thin("FFB9C2CF"),
  left: thin("FFB9C2CF"),
  right: thin("FFB9C2CF"),
};

const sTitle = {
  font: { name: F, sz: 14, bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: "FF1E3A5F" } },
  alignment: { vertical: "center", horizontal: "left" },
};
const sMeta = {
  font: { name: F, sz: 10, color: { rgb: "FF374151" } },
  fill: { fgColor: { rgb: "FFF3F4F6" } },
  alignment: { vertical: "center", horizontal: "left" },
};
const hdr = (bg: string, sz = 10) => ({
  font: { name: F, sz, bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: bg } },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: BOX,
});
const sAxis = {
  font: { name: F, sz: 10, bold: true, color: { rgb: "FF111827" } },
  fill: { fgColor: { rgb: "FFEDF1F6" } },
  alignment: { vertical: "center", horizontal: "left" },
  border: BOX,
};
const numCell = (opts: {
  bg: string;
  bold?: boolean;
  color?: string;
  pct?: boolean;
}) => ({
  font: { name: F, sz: 10, bold: !!opts.bold, color: { rgb: opts.color ?? "FF111827" } },
  fill: { fgColor: { rgb: opts.bg } },
  alignment: { vertical: "center", horizontal: "right" },
  border: BOX,
  numFmt: opts.pct ? "0%" : "#,##0",
});

// 그룹별 교대 배경
const GROUP_BG = ["FFFFFFFF", "FFF5F7FA"];
const TOTAL_BG = "FFE8EFF9";
const BOTTLENECK_BG = "FFFDE2E2";
const HDR_G1 = "FF1E3A5F";
const HDR_G2 = "FF334155";
const HDR_G3 = "FF475569";
const HDR_TOTAL = "FF0F766E";

function put(ws: XLSX.WorkSheet, r: number, c: number, v: unknown, s: Record<string, unknown>) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (typeof v === "number" && Number.isFinite(v)) ws[addr] = { t: "n", v, s, z: (s as any).numFmt };
  else ws[addr] = { t: "s", v: v == null ? "" : String(v), s };
}

function groupColsFor(block: MatrixBlock) {
  return [
    ...block.columnKeys.map((rg) => ({ key: rg as string, label: rg as string, total: false })),
    { key: "__TOTAL__", label: "Row Total", total: true },
  ];
}
const PER_GROUP = SLOTS.length * TEAM_COL_ORDER.length;
/** 잔여+Date: Issued 3열 + 스테이지 5개 × (잔여 3 + Date 3) */
const PER_GROUP_DUAL = TEAM_COL_ORDER.length + STAGE_METRICS.length * TEAM_COL_ORDER.length * 2;
/** 그룹 내 슬롯 시작 열 오프셋 */
const slotOffset = (si: number, dual: boolean) =>
  dual
    ? si === 0
      ? 0
      : TEAM_COL_ORDER.length + (si - 1) * TEAM_COL_ORDER.length * 2
    : si * TEAM_COL_ORDER.length;

export function exportSnagMatrixToXlsx(args: {
  matrix: MatrixShape;
  mode: "count" | "pct" | "remain" | "remainPct";
  asOf: string;
  teams: TeamKey[];
  roomGroupsFilter?: string[];
  userName?: string;
  showHoDate?: boolean;
  hoDates?: HoDateMap;
  /** 잔여 개수 + Date 병기 모드 */
  remainDate?: boolean;
  /** Each Date 모드 — 스테이지 셀 숫자를 날짜로 대체 */
  eachDate?: boolean;
  stageDates?: StageDateMap;
}) {
  const { matrix, asOf } = args;
  const dual = !!args.remainDate;
  const eachDate = !dual && !!args.eachDate;
  const mode = dual ? "remain" : args.mode;
  const showHoDate = !dual && !!args.showHoDate;
  const hoDates = args.hoDates ?? EMPTY_HO_DATE_MAP;
  const stageDates = args.stageDates ?? EMPTY_STAGE_DATE_MAP;
  const perGroup = dual ? PER_GROUP_DUAL : PER_GROUP;
  const GROUP_SPAN = perGroup + (showHoDate ? 1 : 0);
  const wb = XLSX.utils.book_new();

  for (const block of matrix.blocks) {
    const ws: XLSX.WorkSheet = {};
    const merges: XLSX.Range[] = [];
    const groupCols = groupColsFor(block);
    const cols: string[] = block.columnKeys;
    const totalCols = 2 + groupCols.length * GROUP_SPAN;

    // Title / meta
    put(ws, 0, 0, `SM Dashboard Matrix — ${block.title} (PLOT ${matrix.plot})`, sTitle);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });
    const metaLine = [
      `As-of: ${asOf}`,
      `표기: ${
        dual
          ? "잔여 개수 + 스테이지 날짜(계획일 / 완료 시 실적일)"
          : eachDate
            ? "스테이지 날짜 (계획일 / 완료 시 실적일)"
            : mode === "pct"
          ? "% (Rect/Closed = 같은 팀 Issued 대비)"
          : mode === "remain"
            ? "잔여 개수 (Issued − 실적)"
            : mode === "remainPct"
              ? "잔여 % (Issued 대비)"
              : "개수"
      }`,
      `Teams: ${args.teams.length ? args.teams.join(", ") : "ALL"}`,
      `Room Groups: ${args.roomGroupsFilter?.length ? args.roomGroupsFilter.join(", ") : "ALL"}`,
      `Exported: ${dohaDateTime()}${args.userName ? ` by ${args.userName}` : ""}`,
    ].join("   |   ");
    put(ws, 1, 0, metaLine, sMeta);
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } });
    for (let c = 1; c < totalCols; c++) {
      put(ws, 0, c, "", sTitle);
      put(ws, 1, c, "", sMeta);
    }

    const H1 = 3, H2 = 4, H2B = dual ? 5 : -1, H3 = dual ? 6 : 5, DATA = dual ? 7 : 6;

    put(ws, H1, 0, block.rowAxis.primary, hdr(HDR_G1, 11));
    put(ws, H1, 1, block.rowAxis.secondary, hdr(HDR_G1, 11));
    merges.push({ s: { r: H1, c: 0 }, e: { r: H3, c: 0 } });
    merges.push({ s: { r: H1, c: 1 }, e: { r: H3, c: 1 } });
    for (let rr = H1 + 1; rr <= H3; rr++) {
      put(ws, rr, 0, "", hdr(HDR_G1, 11));
      put(ws, rr, 1, "", hdr(HDR_G1, 11));
    }

    groupCols.forEach((g, gi) => {
      const base = 2 + gi * GROUP_SPAN;
      const bg1 = g.total ? HDR_TOTAL : HDR_G1;
      const bg2 = g.total ? HDR_TOTAL : HDR_G2;
      const bg3 = g.total ? HDR_TOTAL : HDR_G3;
      put(ws, H1, base, g.label, hdr(bg1, 11));
      for (let k = 1; k < GROUP_SPAN; k++) put(ws, H1, base + k, "", hdr(bg1, 11));
      merges.push({ s: { r: H1, c: base }, e: { r: H1, c: base + GROUP_SPAN - 1 } });
      SLOTS.forEach((sc, si) => {
        const sBase = base + slotOffset(si, dual);
        const span =
          dual && sc.slot !== "issued" ? TEAM_COL_ORDER.length * 2 : TEAM_COL_ORDER.length;
        put(ws, H2, sBase, sc.label, hdr(bg2));
        for (let k = 1; k < span; k++) put(ws, H2, sBase + k, "", hdr(bg2));
        merges.push({ s: { r: H2, c: sBase }, e: { r: H2, c: sBase + span - 1 } });
        const kinds: Array<"num" | "date"> =
          dual && sc.slot !== "issued" ? ["num", "date"] : ["num"];
        kinds.forEach((kind, ki) => {
          const kBase = sBase + ki * TEAM_COL_ORDER.length;
          if (dual) {
            const label = sc.slot === "issued" ? "개수" : kind === "num" ? "잔여" : "Date";
            put(ws, H2B, kBase, label, hdr(bg2));
            for (let k = 1; k < TEAM_COL_ORDER.length; k++) put(ws, H2B, kBase + k, "", hdr(bg2));
            merges.push({ s: { r: H2B, c: kBase }, e: { r: H2B, c: kBase + TEAM_COL_ORDER.length - 1 } });
          }
          TEAM_COL_ORDER.forEach((team, ti) => {
            put(ws, H3, kBase + ti, TEAM_LABEL[team], hdr(bg3));
          });
        });
      });
      if (showHoDate) {
        const hBase = base + perGroup;
        const hb = g.total ? HDR_TOTAL : HDR_G2;
        put(ws, H2, hBase, g.total ? "Level HO" : "HO Date", hdr(hb));
        put(ws, H3, hBase, "", hdr(bg3));
        merges.push({ s: { r: H2, c: hBase }, e: { r: H3, c: hBase } });
      }
    });

    type StageDateFn = (
      stage: StageMetric,
      team: TeamKey,
      which: "planned" | "actual",
    ) => string | null;

    const writeStats = (
      r: number,
      stats: Stats,
      gi: number,
      isTotalGroup: boolean,
      emphasize: boolean,
      stageDate?: StageDateFn,
    ) => {
      const base = 2 + gi * GROUP_SPAN;
      const bn_: Partial<Record<Slot, TeamKey | null>> = {};
      for (const m of STAGE_METRICS) bn_[m.slot] = bottleneckTeam(stats.byTeam, m.slot);
      SLOTS.forEach((sc, si) => {
        TEAM_COL_ORDER.forEach((team, ti) => {
          const t = stats.byTeam[team];
          const doneVal = sc.slot === "issued" ? t.issued : t[sc.slot];
          const isRemain = mode === "remain" || mode === "remainPct";
          const count =
            isRemain && sc.slot !== "issued" ? Math.max(0, t.issued - doneVal) : doneVal;
          const showPct = (mode === "pct" || mode === "remainPct") && sc.slot !== "issued";
          const ratio = t.issued > 0 ? count / t.issued : null;
          const bn = sc.slot !== "issued" && bn_[sc.slot] === team;
          const bg = bn ? BOTTLENECK_BG : isTotalGroup || emphasize ? TOTAL_BG : GROUP_BG[gi % 2];
          let color = "FF111827";
          if (showPct && ratio != null) {
            const g = isRemain ? 1 - ratio : ratio;
            color = g < 0.4 ? "FFB91C1C" : g < 0.8 ? "FFB45309" : "FF047857";
          }
          else if (!showPct && count === 0) color = "FF9CA3AF";
          const style = numCell({ bg, bold: emphasize || isTotalGroup || bn || sc.slot === "issued", color, pct: showPct });
          const v = showPct ? (ratio == null ? "–" : ratio) : count;
          const cBase = base + slotOffset(si, dual);
          if (eachDate && sc.slot !== "issued") {
            const stageDone = t.issued > 0 && t.issued - doneVal <= 0;
            const dv = stageDate
              ? stageDate(sc.slot as StageMetric, team, stageDone ? "actual" : "planned")
              : null;
            put(ws, r, cBase + ti, formatHoDate(dv), {
              font: {
                name: F,
                sz: 10,
                bold: emphasize || isTotalGroup,
                color: { rgb: dv ? (stageDone ? "FF6B7280" : "FF111827") : "FF9CA3AF" },
              },
              fill: { fgColor: { rgb: isTotalGroup || emphasize ? TOTAL_BG : GROUP_BG[gi % 2] } },
              alignment: { vertical: "center", horizontal: "center" },
              border: BOX,
            });
            return;
          }
          put(ws, r, cBase + ti, v, style);
          if (dual && sc.slot !== "issued") {
            const stageDone = t.issued > 0 && t.issued - doneVal <= 0;
            const dv = stageDate
              ? stageDate(sc.slot as StageMetric, team, stageDone ? "actual" : "planned")
              : null;
            put(ws, r, cBase + TEAM_COL_ORDER.length + ti, formatHoDate(dv), {
              font: {
                name: F,
                sz: 10,
                bold: emphasize || isTotalGroup,
                color: { rgb: dv ? (stageDone ? "FF6B7280" : "FF111827") : "FF9CA3AF" },
              },
              fill: { fgColor: { rgb: isTotalGroup || emphasize ? TOTAL_BG : GROUP_BG[gi % 2] } },
              alignment: { vertical: "center", horizontal: "center" },
              border: BOX,
            });
          }
        });
      });
    };


    const writeHo = (r: number, gi: number, isTotalGroup: boolean, emphasize: boolean, value: string | null) => {
      if (!showHoDate) return;
      const c = 2 + gi * GROUP_SPAN + perGroup;
      const bg = isTotalGroup || emphasize ? TOTAL_BG : GROUP_BG[gi % 2];
      put(ws, r, c, formatHoDate(value), {
        font: { name: F, sz: 10, bold: emphasize || isTotalGroup, color: { rgb: value ? "FF111827" : "FF9CA3AF" } },
        fill: { fgColor: { rgb: bg } },
        alignment: { vertical: "center", horizontal: "center" },
        border: BOX,
      });
    };

    let r = DATA;
    // Column Total
    put(ws, r, 0, "Column Total", { ...sAxis, font: { ...sAxis.font, bold: true }, fill: { fgColor: { rgb: TOTAL_BG } } });
    put(ws, r, 1, "", { ...sAxis, fill: { fgColor: { rgb: TOTAL_BG } } });
    merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
    cols.forEach((rg, gi) => {
      writeStats(r, block.colTotals[rg], gi, false, true, (stage, team, which) =>
        stageDates.col(block.kind, rg, stage, team, which),
      );
      writeHo(r, gi, false, true, hoDates.col(block.kind, rg));
    });
    writeStats(r, block.blockTotal, cols.length, true, true, (stage, team, which) =>
      stageDates.block(block.kind, stage, team, which),
    );
    writeHo(r, cols.length, true, true, hoDates.block(block.kind));
    r++;

    // Building 그룹 (podium 소계 포함)
    type Grp = { building: string; rows: typeof block.rows; subtotal: Stats };
    const groups: Grp[] = [];
    let cur: Grp | null = null;
    for (const row of block.rows) {
      if (!cur || cur.building !== row.building) {
        if (cur) groups.push(cur);
        cur = { building: row.building, rows: [], subtotal: newStats() };
      }
      cur.rows.push(row);
      mergeStats(cur.subtotal, row.rowTotal);
    }
    if (cur) groups.push(cur);

    for (const grp of groups) {
      const showSub = block.kind === "podium" && grp.rows.length > 1;
      const startR = r;
      grp.rows.forEach((row) => {
        put(ws, r, 0, row.building, sAxis);
        put(ws, r, 1, row.levelDisp, sAxis);
        cols.forEach((rg, gi) => {
          writeStats(r, row.cells[rg], gi, false, false, (stage, team, which) =>
            stageDates.cell(block.kind, row.building, row.levelDisp, rg, stage, team, which),
          );
          writeHo(r, gi, false, false, hoDates.cell(block.kind, row.building, row.levelDisp, rg));
        });
        writeStats(r, row.rowTotal, cols.length, true, false, (stage, team, which) =>
          stageDates.row(block.kind, row.building, row.levelDisp, stage, team, which),
        );
        writeHo(r, cols.length, true, false, hoDates.row(block.kind, row.building, row.levelDisp));
        r++;
      });
      if (showSub) {
        put(ws, r, 0, grp.building, sAxis);
        put(ws, r, 1, `${grp.building} 소계`, { ...sAxis, font: { ...sAxis.font, bold: true }, fill: { fgColor: { rgb: TOTAL_BG } } });
        cols.forEach((rg, gi) => {
          const sub = newStats();
          for (const row of grp.rows) mergeStats(sub, row.cells[rg]);
          writeStats(r, sub, gi, false, true, (stage, team, which) =>
            stageDates.buildingCol(block.kind, grp.building, rg, stage, team, which),
          );
          let colMax: string | null = null;
          for (const row of grp.rows) {
            const v = hoDates.cell(block.kind, row.building, row.levelDisp, rg);
            if (v && (!colMax || v > colMax)) colMax = v;
          }
          writeHo(r, gi, false, true, colMax);
        });
        writeStats(r, grp.subtotal, cols.length, true, true, (stage, team, which) =>
          stageDates.building(block.kind, grp.building, stage, team, which),
        );
        writeHo(r, cols.length, true, true, hoDates.building(block.kind, grp.building));
        r++;
      }
      const endR = r - 1;
      if (endR > startR) merges.push({ s: { r: startR, c: 0 }, e: { r: endR, c: 0 } });
      for (let rr = startR + 1; rr <= endR; rr++) {
        const addr = XLSX.utils.encode_cell({ r: rr, c: 0 });
        if (ws[addr]) ws[addr] = { t: "s", v: "", s: sAxis };
      }
    }

    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, DATA), c: totalCols - 1 } });
    ws["!merges"] = merges;
    ws["!cols"] = [
      { wch: 16 },
      { wch: 14 },
      ...Array.from({ length: totalCols - 2 }, (_, i) =>
        showHoDate && i % GROUP_SPAN === perGroup ? { wch: 9 } : { wch: 7 },
      ),
    ];
    ws["!rows"] = dual
      ? [{ hpt: 22 }, { hpt: 18 }, { hpt: 6 }, { hpt: 20 }, { hpt: 16 }, { hpt: 16 }, { hpt: 16 }]
      : [{ hpt: 22 }, { hpt: 18 }, { hpt: 6 }, { hpt: 20 }, { hpt: 16 }, { hpt: 16 }];
    (ws as any)["!freeze"] = XLSX.utils.encode_cell({ r: DATA, c: 2 });

    const sheetName = block.title.replace(/[\\/?*[\]:]/g, "-").slice(0, 28) || block.kind;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const modeTag = dual
    ? "REMAIN-DATE"
    : mode === "pct" ? "PCT" : mode === "remain" ? "REMAIN" : mode === "remainPct" ? "REMAIN-PCT" : "COUNT";
  const fileName = `CMS_SM_Dashboard_Matrix_PLOT-${matrix.plot}_${modeTag}_${asOf}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
