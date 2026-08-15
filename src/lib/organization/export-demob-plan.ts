/** Demob Plan 엑셀 내보내기 — 이름·팀·모듈별 최종일·철수일. */
import ExcelJS from "exceljs";
import { dohaStampCompact } from "@/lib/time/doha";
import { DEMOB_MODULES, MODULE_LABEL, type DemobRow } from "./demob-types";

export async function exportDemobPlanToExcel(rows: DemobRow[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QAIL CMS";
  const ws = wb.addWorksheet("Demob Plan", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 2 }],
  });

  const cols = [
    { header: "팀", width: 16 },
    { header: "이름", width: 18 },
    ...DEMOB_MODULES.map((m) => ({ header: `${MODULE_LABEL[m]} 종결일`, width: 14 })),
    { header: "철수일", width: 14 },
    { header: "마스터 등록", width: 12 },
  ];
  ws.columns = cols.map((c) => ({ width: c.width }));
  const head = ws.getRow(1);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  head.height = 20;

  rows.forEach((r, idx) => {
    const row = ws.getRow(2 + idx);
    const values = [
      r.team ?? "미지정",
      r.pic_name,
      ...DEMOB_MODULES.map((m) => r.per_module?.[m]?.end ?? ""),
      r.demob_date ?? "",
      r.in_master ? "등록" : "미등록",
    ];
    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { horizontal: i === 1 ? "left" : "center", vertical: "middle" };
    });
    row.height = 18;
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DemobPlan_${dohaStampCompact()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
