const ids: Record<string,string> = {
  SPL: "eyJmaWxlIjoiL3NyYy9saWIvc3BsL2hkZWMtaW1wb3J0LmZ1bmN0aW9ucy50cz90c3Mtc2VydmVyZm4tc3BsaXQiLCJleHBvcnQiOiJpbXBvcnRTcGxIZGVjQmF0Y2hfY3JlYXRlU2VydmVyRm5faGFuZGxlciJ9",
};
const p = JSON.parse(await Bun.file("/tmp/pv/spl.json").text());
const body = { data: { file_name: p.file_name, sheet_names: p.sheets.map((s:any)=>s.sheet_name), ocs_excluded: p.ocs_excluded ?? 0, rows: p.rows, apply: false } };
const r = await fetch(`http://localhost:8080/_serverFn/${ids.SPL}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN}` }, body: JSON.stringify(body) });
const t = await r.text();
console.log(r.status, t.slice(0, 1500));
