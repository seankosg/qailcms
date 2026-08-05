import { parseTaskManagementExcel } from "@/lib/task-management/parser";
import { readFileSync } from "fs";
const files = process.argv.slice(2);
for (const p of files) {
  const buf = readFileSync(p);
  const file = new File([new Uint8Array(buf)], p.split("/").pop()!);
  try {
    const r = await parseTaskManagementExcel(file, {});
    console.log("\n=== " + p.split("/").pop());
    console.log("rows", r.rows.length, "sheet", r.sheetName);
    console.log("columnMap", JSON.stringify(r.columnMap));
    console.log("unmapped", JSON.stringify(r.unmappedFields));
    console.log("demoted", JSON.stringify((r.demotedFields||[]).map(d=>({f:d.field,ratio:d.ratio,n:d.population,s:d.samples}))));
    console.log("headers", (r.availableHeaders||[]).length);
  } catch (e) { console.log("\n=== " + p + " ERROR: " + (e as Error).message); }
}
