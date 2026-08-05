import * as XLSX from "xlsx";
import { readFileSync } from "fs";
for (const p of process.argv.slice(2)) {
  const wb = XLSX.read(readFileSync(p), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as any[][];
  console.log("\n=== " + p.split("/").pop(), "sheet", wb.SheetNames[0]);
  rows.slice(0, 10).forEach((r, i) => console.log(i + 1, JSON.stringify((r||[]).slice(0, 26))));
}
