import ExcelJS from "exceljs";
import { dohaStamp } from "@/lib/time/doha";

interface PicUser {
  id: string;
  name: string | null;
  login_id: string | null;
  team: string | null;
}

function isWeekend(dateKey: string): boolean {
  const d = new Date(dateKey + "T00:00:00Z");
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

export async function exportTmImportRecord(opts: {
  from: string;
  to: string;
  dates: string[];
  groups: [string, PicUser[]][];
  countMap: Map<string, number>;
  teamFilter: string;
  exportedBy: string;
}) {
  const { from, to, dates, groups, countMap, teamFilter, exportedBy } = opts;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("TM Import Record");

  const fixedCols = 3; // 팀, 이름, 로그인ID
  const totalCols = fixedCols + dates.length + 3; // + 업로드일수, 미업로드(주말제외), 최근업로드일

  const FONT = "Calibri";
  const FILL_TITLE = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1E3A5F" } };
  const FILL_META = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF3F4F6" } };
  const FILL_HEADER = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF334155" } };
  const FILL_O = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD1FAE5" } };
  const FILL_X = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFEE2E2" } };
  const FILL_WEEKEND = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE5E7EB" } };
  const FILL_TEAM = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFDBEAFE" } };
  const BORDER: any = {
    top: { style: "thin", color: { argb: "FFE5E7EB" } },
    bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
    left: { style: "thin", color: { argb: "FFE5E7EB" } },
    right: { style: "thin", color: { argb: "FFE5E7EB" } },
  };

  // Row 1 — Title
  ws.mergeCells(1, 1, 1, totalCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `TM Import Record — ${from} ~ ${to}`;
  titleCell.font = { name: FONT, size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = FILL_TITLE;
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 24;

  // Rows 2–6 meta
  const meta = [
    `Exported by: ${exportedBy} @ ${dohaStamp()} (Doha)`,
    `Source: task_management_import_logs`,
    `Range: ${from} ~ ${to} (Doha)`,
    `Team filter: ${teamFilter === "__all" ? "전체" : teamFilter}`,
    `기준: imported_by = 사용자 id 인 로그가 하루 1건 이상 존재`,
  ];
  for (let i = 0; i < 5; i++) {
    const r = 2 + i;
    ws.mergeCells(r, 1, r, totalCols);
    const c = ws.getCell(r, 1);
    c.value = meta[i];
    c.font = { name: FONT, size: 10, bold: i === 0, color: { argb: "FF111827" } };
    c.fill = FILL_META;
    c.alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(r).height = 16;
  }
  ws.getRow(7).height = 6;

  // Row 8 — column headers
  const headerRow = 8;
  const headers = ["팀", "이름", "로그인 ID", ...dates.map((d) => d.slice(5)), "업로드일수", "미업로드(주말제외)", "최근 업로드일"];
  for (let c = 0; c < headers.length; c++) {
    const cell = ws.getCell(headerRow, c + 1);
    cell.value = headers[c];
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = FILL_HEADER;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDER;
  }
  ws.getRow(headerRow).height = 26;

  ws.views = [
    { state: "frozen", xSplit: fixedCols, ySplit: headerRow, activeCell: "D9" },
  ];

  // Column widths
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 14;
  for (let i = 0; i < dates.length; i++) ws.getColumn(fixedCols + 1 + i).width = 7;
  ws.getColumn(totalCols - 2).width = 12;
  ws.getColumn(totalCols - 1).width = 16;
  ws.getColumn(totalCols).width = 14;

  let rowIdx = headerRow + 1;
  for (const [team, users] of groups) {
    // Team divider row
    ws.mergeCells(rowIdx, 1, rowIdx, totalCols);
    const teamCell = ws.getCell(rowIdx, 1);
    teamCell.value = `▼ ${team}  (${users.length}명)`;
    teamCell.font = { name: FONT, size: 11, bold: true, color: { argb: "FF1E3A5F" } };
    teamCell.fill = FILL_TEAM;
    teamCell.alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(rowIdx).height = 18;
    rowIdx++;

    for (const u of users) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = team;
      row.getCell(2).value = u.name ?? "";
      row.getCell(3).value = u.login_id ?? "";
      for (let i = 0; i < fixedCols; i++) {
        const cell = row.getCell(i + 1);
        cell.font = { name: FONT, size: 10 };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = BORDER;
      }

      let uploadDays = 0;
      let missingBiz = 0;
      let latest = "";
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        const c = countMap.get(`${u.id}|${d}`) ?? 0;
        const col = fixedCols + 1 + i;
        const cell = row.getCell(col);
        cell.value = c > 0 ? "O" : "X";
        cell.font = { name: FONT, size: 10, bold: c > 0, color: { argb: c > 0 ? "FF065F46" : "FF991B1B" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = BORDER;
        const wk = isWeekend(d);
        cell.fill = wk ? FILL_WEEKEND : c > 0 ? FILL_O : FILL_X;
        if (c > 0) {
          uploadDays++;
          latest = d;
        } else if (!wk) {
          missingBiz++;
        }
      }

      const sumCell = row.getCell(totalCols - 2);
      sumCell.value = uploadDays;
      sumCell.font = { name: FONT, size: 10, bold: true };
      sumCell.alignment = { vertical: "middle", horizontal: "center" };
      sumCell.border = BORDER;

      const missCell = row.getCell(totalCols - 1);
      missCell.value = missingBiz;
      missCell.font = { name: FONT, size: 10, color: { argb: missingBiz > 0 ? "FF991B1B" : "FF111827" } };
      missCell.alignment = { vertical: "middle", horizontal: "center" };
      missCell.border = BORDER;

      const latestCell = row.getCell(totalCols);
      latestCell.value = latest;
      latestCell.font = { name: FONT, size: 10 };
      latestCell.alignment = { vertical: "middle", horizontal: "center" };
      latestCell.border = BORDER;

      row.height = 18;
      rowIdx++;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tm-import-record_${from}_${to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}