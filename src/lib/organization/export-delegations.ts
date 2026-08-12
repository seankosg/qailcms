/**
 * 개인 업무 인수인계(위임) 내역 엑셀 내보내기.
 * 파일명: 업무인수인계_{사용자이름}_{시작일 ddmmmyyyy}_{종료일 ddmmmyyyy}.xlsx
 */
import ExcelJS from "exceljs";

export interface DelegationExportRow {
  task_no: string | null;
  task_name: string | null;
  from_pic: string;
  to_pic: string;
  start_date: string;
  end_date: string;
  status: string;
  note?: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO(yyyy-mm-dd) → ddmmmyyyy (예: 12Aug2026). 형식이 아니면 원문을 정리해 반환. */
export function ddMmmYyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return (iso ?? "").replace(/[^0-9A-Za-z]/g, "");
  return `${m[3]}${MONTHS[Number(m[2]) - 1] ?? m[2]}${m[1]}`;
}

function safeName(s: string): string {
  return (s || "미상").replace(/[\\/:*?"<>|]/g, "").trim() || "미상";
}

const COLS: Array<{ key: keyof DelegationExportRow | "idx"; label: string; width: number }> = [
  { key: "idx", label: "No", width: 6 },
  { key: "task_no", label: "Task No", width: 18 },
  { key: "task_name", label: "Task / Subtask", width: 52 },
  { key: "from_pic", label: "인계자", width: 16 },
  { key: "to_pic", label: "인수자", width: 16 },
  { key: "start_date", label: "부재 시작일", width: 14 },
  { key: "end_date", label: "부재 종료일", width: 14 },
  { key: "status", label: "상태", width: 12 },
  { key: "note", label: "사유", width: 30 },
];

export async function exportDelegationsToExcel(opts: {
  userName: string;
  startDate: string;
  endDate: string;
  rows: DelegationExportRow[];
}): Promise<void> {
  const { userName, startDate, endDate, rows } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "QAIL CMS";
  const ws = wb.addWorksheet("업무 인수인계", {
    views: [{ state: "frozen", ySplit: 6, xSplit: 2 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastCol = COLS.length;
  const colLetter = (n: number) => ws.getColumn(n).letter;
  const span = (r: number) => `A${r}:${colLetter(lastCol)}${r}`;

  // 제목
  ws.mergeCells(span(1));
  const title = ws.getCell("A1");
  title.value = "업무 인수인계 내역서";
  title.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
  ws.getRow(1).height = 26;

  // 메타
  const meta: Array<[string, string]> = [
    ["담당자", userName],
    ["부재 기간", `${startDate} ~ ${endDate}`],
    ["대상 업무", `${rows.length}건`],
  ];
  meta.forEach(([k, v], i) => {
    const r = 2 + i;
    ws.getCell(`A${r}`).value = k;
    ws.getCell(`A${r}`).font = { name: "Arial", size: 10, bold: true };
    ws.getCell(`A${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF1F7" } };
    ws.getCell(`A${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.mergeCells(`B${r}:${colLetter(lastCol)}${r}`);
    ws.getCell(`B${r}`).value = v;
    ws.getCell(`B${r}`).font = { name: "Arial", size: 10 };
    ws.getCell(`B${r}`).alignment = { horizontal: "left", vertical: "middle" };
    ws.getRow(r).height = 18;
  });

  // 헤더
  const headRow = ws.getRow(6);
  COLS.forEach((c, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF9DB2CE" } },
      left: { style: "thin", color: { argb: "FF9DB2CE" } },
      bottom: { style: "thin", color: { argb: "FF9DB2CE" } },
      right: { style: "thin", color: { argb: "FF9DB2CE" } },
    };
    ws.getColumn(i + 1).width = c.width;
  });
  headRow.height = 22;

  // 본문
  rows.forEach((r, idx) => {
    const row = ws.getRow(7 + idx);
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.key === "idx" ? idx + 1 : ((r as any)[c.key] ?? "");
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = {
        horizontal:
          c.key === "task_name" || c.key === "note" ? "left" : "center",
        vertical: "middle",
        wrapText: c.key === "task_name" || c.key === "note",
      };
      cell.border = {
        top: { style: "hair", color: { argb: "FFC9D2E0" } },
        left: { style: "hair", color: { argb: "FFC9D2E0" } },
        bottom: { style: "hair", color: { argb: "FFC9D2E0" } },
        right: { style: "hair", color: { argb: "FFC9D2E0" } },
      };
      if (idx % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
      }
    });
    row.height = 18;
  });

  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: lastCol } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `업무인수인계_${safeName(userName)}_${ddMmmYyyy(startDate)}_${ddMmmYyyy(endDate)}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
