const id = "eyJmaWxlIjoiL3NyYy9saWIvc3BsL3Jvd3MuZnVuY3Rpb25zLnRzP3Rzcy1zZXJ2ZXJmbi1zcGxpdCIsImV4cG9ydCI6ImdldFNwbFJvd3NBc09mX2NyZWF0ZVNlcnZlckZuX2hhbmRsZXIifQ";
const r = await fetch(`http://localhost:8080/_serverFn/${id}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN}` }, body: JSON.stringify({}) });
console.log(r.status, (await r.text()).slice(0,400));
