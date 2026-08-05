import { toJSONAsync } from "seroval";
async function callFn(id: string, data: any) {
  const body = JSON.stringify(await toJSONAsync({ data }));
  const r = await fetch(`http://localhost:8080/_serverFn/${id}`, { method: "POST", headers: { "content-type": "application/json", "x-tsr-serverFn": "true", origin: "http://localhost:8080", accept: "application/json", authorization: `Bearer ${process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN}` }, body });
  return { status: r.status, text: await r.text() };
}
const SPL = "eyJmaWxlIjoiL3NyYy9saWIvc3BsL2hkZWMtaW1wb3J0LmZ1bmN0aW9ucy50cz90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJpbXBvcnRTcGxIZGVjQmF0Y2hfY3JlYXRlU2VydmVyRm5faGFuZGxlciJ9";
const p = JSON.parse(await Bun.file("/tmp/pv/spl.json").text());
const res = await callFn(SPL, { file_name: p.file_name, sheet_names: p.sheets.map((s:any)=>s.sheet_name), ocs_excluded: p.ocs_excluded ?? 0, rows: p.rows, apply: false });
await Bun.write("/tmp/pv/spl-res.json", res.text);
console.log("SPL", res.status, res.text.slice(0,300));
