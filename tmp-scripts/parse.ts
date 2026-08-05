import { parseSplHdecFile } from "../src/lib/spl/hdec-parser";
import { parseWrtHdecFile } from "../src/lib/wrt/hdec-parser";
import { readFileSync } from "fs";
function f(p: string) { const b = readFileSync(p); return new File([new Uint8Array(b)], p.split("/").pop()!); }
const spl = await parseSplHdecFile(f("/mnt/user-uploads/SPL_Status_MERGED_260805.xlsx"));
const wrt = await parseWrtHdecFile(f("/mnt/user-uploads/WRT_Status_MERGED_260805.xlsx"));
for (const [n, p] of [["SPL", spl], ["WRT", wrt]] as any) {
  console.log(n, { rows: p.rows.length, sheets: p.sheets, ocs: p.ocs_excluded, skipped: p.skipped_rows, unknown: p.unknown_headers });
}
Bun.write("/tmp/pv/spl.json", JSON.stringify(spl));
Bun.write("/tmp/pv/wrt.json", JSON.stringify(wrt));
