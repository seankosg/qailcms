import { toJSONAsync, fromJSON } from "seroval";
async function callFn(id: string, data: any) {
  const body = JSON.stringify(await toJSONAsync({ data }));
  const r = await fetch(`http://localhost:8080/_serverFn/${id}`, { method: "POST", headers: { "content-type": "application/json", "x-tsr-serverFn": "true", origin: "http://localhost:8080", accept: "application/json", authorization: `Bearer ${process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN}` }, body });
  const t = await r.text();
  try { return (fromJSON(JSON.parse(t)) as any); } catch { return { raw: t }; }
}
function sum(res: any, label: string) {
  const x = res.result ?? res;
  if (!x || !("total" in x)) { console.log(label, JSON.stringify(res).slice(0,500)); return; }
  const aconex = (x.field_diff_counts ?? []).filter((f: any) => /RESPONSE_DATE_R[12]|APPROVAL_DATE/.test(f.field));
  const clearedAconex = (x.diff_rows ?? []).flatMap((d: any) => d.changes).filter((c: any) => c.next === null && /RESPONSE_DATE_R[12]|APPROVAL_DATE/.test(c.target));
  console.log(label, { total: x.total, matched: x.matched, created: x.created, unmatched: x.unmatched, rows_changed: x.rows_changed, cleared_values: x.cleared_values, aconex_axis_diffs: aconex, aconex_cleared: clearedAconex.length, created_list: x.created_list?.slice(0,10) });
}
const SPL = "eyJmaWxlIjoiL3NyYy9saWIvc3BsL2hkZWMtaW1wb3J0LmZ1bmN0aW9ucy50cz90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJpbXBvcnRTcGxIZGVjQmF0Y2hfY3JlYXRlU2VydmVyRm5faGFuZGxlciJ9";
const WRT = "eyJmaWxlIjoiL3NyYy9saWIvd3J0L2hkZWMtaW1wb3J0LmZ1bmN0aW9ucy50cz90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJpbXBvcnRXcnRIZGVjQmF0Y2hfY3JlYXRlU2VydmVyRm5faGFuZGxlciJ9";
const spl = JSON.parse(await Bun.file("/tmp/pv/spl.json").text());
const wrt = JSON.parse(await Bun.file("/tmp/pv/wrt.json").text());
sum(await callFn(SPL, { file_name: spl.file_name, sheet_names: spl.sheets.map((s:any)=>s.sheet_name), ocs_excluded: spl.ocs_excluded ?? 0, rows: spl.rows, apply: false }), "SPL");
sum(await callFn(WRT, { file_name: wrt.file_name, sheet_names: wrt.sheets.map((s:any)=>s.sheet_name), rows: wrt.rows, apply: false }), "WRT");
