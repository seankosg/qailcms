import XLSXS from "xlsx-js-style";

/**
 * SPL·WRT 왕복 임포트 양식 공통 서식기.
 * 셀 "값"은 절대 건드리지 않는다(왕복 무결성 유지). 서식·병합·폭·틀고정만 적용한다.
 */

export type RtColMeta = {
  /** item(식별정보) | status(상태) | stage(단계 날짜/플래그) */
  kind: "item" | "status" | "stage";
  header: string;
  sub?: string;
  field?: string;
  stage_code?: string;
  band?: string;
  /** stage 컬럼의 실적 권위 — ACONEX 실적열은 초록(수기입력 금지) */
  authority?: "HDEC" | "ACONEX";
};

const F = "Calibri";

const B = (rgb: string, style: "thin" | "medium" = "thin") => ({ style, color: { rgb } });
const box = (rgb = "FFB6C2D2", style: "thin" | "medium" = "thin") => ({
  top: B(rgb, style),
  bottom: B(rgb, style),
  left: B(rgb, style),
  right: B(rgb, style),
});

const TITLE = {
  font: { name: F, sz: 14, bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: "FF1E3A5F" } },
  alignment: { vertical: "center", horizontal: "left", indent: 1 },
};
const TITLE_NOTE = {
  font: { name: F, sz: 9, bold: false, color: { rgb: "FFD9E2EC" } },
  fill: { fgColor: { rgb: "FF1E3A5F" } },
  alignment: { vertical: "center", horizontal: "right", wrapText: false, indent: 1 },
};

/** 밴드별 색 — 좌→우 진행 순서를 색 온도로 인지시킨다. */
const BAND_FILL: Record<string, string> = {
  REQUIRED_DOC: "FF7C5295",
  DOCUMENTATION: "FF2E6DA4",
  PO: "FF1F7A5C",
  COMMERCIAL: "FF7C5295",
  DRAFT_APPROVAL: "FF2E6DA4",
  SUBMISSION: "FF1F7A5C",
};

const bandStyle = (band: string) => ({
  font: { name: F, sz: 11, bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: BAND_FILL[band] ?? "FF475569" } },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: box("FFFFFFFF"),
});

const HEAD_ITEM = {
  font: { name: F, sz: 10, bold: true, color: { rgb: "FF3B2500" } },
  fill: { fgColor: { rgb: "FFFBD8A5" } },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: box("FF9A6B26"),
};
const HEAD_STATUS = {
  ...HEAD_ITEM,
  fill: { fgColor: { rgb: "FFD8E9C8" } },
  font: { name: F, sz: 10, bold: true, color: { rgb: "FF1F3D14" } },
};
const HEAD_STAGE = {
  font: { name: F, sz: 10, bold: true, color: { rgb: "FF17324D" } },
  fill: { fgColor: { rgb: "FFE3ECF5" } },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: box("FF9DB4CA"),
};
const SUB_PLAN = {
  font: { name: F, sz: 9, bold: true, color: { rgb: "FF334155" } },
  fill: { fgColor: { rgb: "FFFFFFFF" } },
  alignment: { vertical: "center", horizontal: "center", wrapText: true },
  border: box("FF9DB4CA"),
};
const SUB_ACTUAL = {
  ...SUB_PLAN,
  fill: { fgColor: { rgb: "FFFFF3C4" } },
  font: { name: F, sz: 9, bold: true, color: { rgb: "FF5C4708" } },
};
const SUB_ACONEX = {
  ...SUB_PLAN,
  fill: { fgColor: { rgb: "FFD8E9C8" } },
  font: { name: F, sz: 9, bold: true, color: { rgb: "FF1F3D14" } },
};

const cellBorder = box("FFDCE3EA");
const DATA_TEXT = {
  font: { name: F, sz: 10, color: { rgb: "FF111827" } },
  alignment: { vertical: "center", horizontal: "left", wrapText: false },
  border: cellBorder,
};
const DATA_TEXT_C = { ...DATA_TEXT, alignment: { vertical: "center", horizontal: "center", wrapText: false } };
const DATA_DATE_PLAN = { ...DATA_TEXT_C };
const DATA_DATE_ACTUAL = { ...DATA_TEXT_C, fill: { fgColor: { rgb: "FFFFFBEA" } } };
const DATA_DATE_ACONEX = { ...DATA_TEXT_C, fill: { fgColor: { rgb: "FFF1F7EA" } } };
const ZEBRA = { fgColor: { rgb: "FFF7F9FB" } };

/** 컬럼 폭(문자 수) — 값 길이와 화면 가독성의 절충값. */
function widthOf(c: RtColMeta): number {
  if (c.kind === "status") return 13;
  if (c.kind === "stage") return c.sub ? 11 : 9;
  const h = c.header.toUpperCase();
  if (h.includes("TITLE")) return 42;
  if (h.includes("NUMBER")) return 20;
  if (h.includes("SERVICE")) return 20;
  if (h.includes("SUPPLIER")) return 22;
  if (h.startsWith("RESPONSE")) return 13;
  if (h.includes("FINAL APPROVED")) return 12;
  if (h.includes("LATEST STATUS")) return 13;
  if (h === "DIS") return 9;
  if (h === "TEAM") return 11;
  return 14; // PIC / ENG
}

function isActualSub(sub?: string) {
  return !!sub && sub.startsWith("Actual");
}

/**
 * aoa_to_sheet 로 만든 워크시트에 4행 헤더 서식을 입힌다.
 * @param rowCount 데이터 행 수(헤더 4행 제외)
 * @param freezeCols 좌측 고정 컬럼 수
 */
export function styleRoundtripSheet(
  ws: any,
  cols: RtColMeta[],
  rowCount: number,
  freezeCols: number,
) {
  const enc = XLSXS.utils.encode_cell;
  const at = (r: number, c: number) => {
    const a = enc({ r, c });
    if (!ws[a]) ws[a] = { t: "z", v: undefined };
    return ws[a];
  };

  // 폭 / 행 높이
  ws["!cols"] = cols.map((c) => ({ wch: widthOf(c) }));
  ws["!rows"] = [{ hpt: 26 }, { hpt: 20 }, { hpt: 30 }, { hpt: 30 }];
  for (let i = 0; i < rowCount; i++) ws["!rows"].push({ hpt: 16 });

  const merges: any[] = ws["!merges"] ?? [];

  // r0 타이틀 — 앞 8열 병합 + 나머지 안내문
  const noteStart = Math.min(8, cols.length - 1);
  if (noteStart > 0) merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: noteStart - 1 } });
  if (cols.length - 1 > noteStart) merges.push({ s: { r: 0, c: noteStart }, e: { r: 0, c: cols.length - 1 } });
  for (let c = 0; c < cols.length; c++) at(0, c).s = c < noteStart ? TITLE : TITLE_NOTE;

  // r1 밴드행 — 라벨이 있는 칸부터 다음 라벨 직전까지 병합
  const bandStarts: number[] = [];
  for (let c = 0; c < cols.length; c++) {
    const cell = ws[enc({ r: 1, c })];
    if (cell && cell.v != null && String(cell.v) !== "") bandStarts.push(c);
  }
  for (let c = 0; c < cols.length; c++) {
    at(1, c).s = {
      font: { name: F, sz: 10 },
      fill: { fgColor: { rgb: "FFF1F5F9" } },
      border: box("FFE2E8F0"),
    };
  }
  bandStarts.forEach((start, i) => {
    const end = (bandStarts[i + 1] ?? cols.length) - 1;
    const label = String(ws[enc({ r: 1, c: start })].v);
    const band =
      cols[start].band ??
      Object.keys(BAND_FILL).find((k) => label.toLowerCase().startsWith(k.split("_")[0].toLowerCase())) ??
      "";
    at(1, start).s = bandStyle(band);
    for (let c = start; c <= end; c++) at(1, c).s = bandStyle(band);
    if (end > start) merges.push({ s: { r: 1, c: start }, e: { r: 1, c: end } });
  });

  // r2 단계명 / r3 서브라벨
  for (let c = 0; c < cols.length; c++) {
    const col = cols[c];
    if (col.kind === "stage") {
      at(2, c).s = HEAD_STAGE;
      const sub = col.sub ?? "";
      at(3, c).s = !sub
        ? HEAD_STAGE
        : isActualSub(sub)
          ? col.authority === "ACONEX"
            ? SUB_ACONEX
            : SUB_ACTUAL
          : SUB_PLAN;
    } else {
      const s = col.kind === "status" ? HEAD_STATUS : HEAD_ITEM;
      at(2, c).s = s;
      at(3, c).s = s;
      merges.push({ s: { r: 2, c }, e: { r: 3, c } }); // 단계명·서브라벨 세로 병합
    }
  }
  // 같은 stage_code 연속 구간의 단계명 가로 병합
  let i = 0;
  while (i < cols.length) {
    const col = cols[i];
    if (col.kind !== "stage") {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < cols.length && cols[j + 1].kind === "stage" && cols[j + 1].stage_code === col.stage_code) j++;
    if (j > i) merges.push({ s: { r: 2, c: i }, e: { r: 2, c: j } });
    else if (!col.sub) merges.push({ s: { r: 2, c: i }, e: { r: 3, c: i } });
    i = j + 1;
  }

  // 데이터 행
  for (let r = 4; r < 4 + rowCount; r++) {
    const zebra = (r - 4) % 2 === 1;
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      let s: any;
      if (col.kind === "stage" && col.sub) {
        s = isActualSub(col.sub)
          ? col.authority === "ACONEX"
            ? DATA_DATE_ACONEX
            : DATA_DATE_ACTUAL
          : DATA_DATE_PLAN;
      } else if (col.kind === "stage" || col.kind === "status") {
        s = DATA_TEXT_C;
      } else {
        s = widthOf(col) >= 20 ? DATA_TEXT : DATA_TEXT_C;
      }
      if (zebra && !s.fill) s = { ...s, fill: ZEBRA };
      at(r, c).s = s;
    }
  }

  ws["!merges"] = merges;
  ws["!freeze"] = { xSplit: freezeCols, ySplit: 4 };
  ws["!panes"] = [{ state: "frozen", xSplit: freezeCols, ySplit: 4, topLeftCell: enc({ r: 4, c: freezeCols }) }];
}
