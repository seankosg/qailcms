import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSplHdecFile } from "@/lib/spl/hdec-parser";

function mk(aoa: any[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "SPL");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], "CMS_SPL_view_x.xlsx");
}

describe("SPL view import", () => {
  it("parses view export", async () => {
    const f = mk([
      ["SPL NUMBER", "Plot", "Team", "Status", "PIC", "R-PL", "D-SB-PS", "D-SB-AF", "D-AP-AD", "Title"],
      ["SPL-001", "PLOT-C", "MEP", "Completed", "KIM", "Y", "2026-01-05", "NA", "2026-02-01", "t"],
      ["SPL-002", "PLOT-D", "CIVIL", "Delayed", "", "", "", "", "", ""],
    ]);
    const p = await parseSplHdecFile(f);
    expect(p.format).toBe("view");
    expect(p.rows.length).toBe(2);
    expect(p.rows[0].plot).toBe("C");
    expect(p.rows[0].item).toMatchObject({ plot: "C", team: "ELEC", pic: "KIM" });
    expect(p.rows[1].item.team).toBe("PRJC");
    const sb = p.rows[0].stages.find((s) => s.stage_code === "SUBMISSION")!;
    expect(sb.fields.plan_start).toBe("2026-01-05");
    expect(sb.na).toBe(true);
    expect(p.ignored_headers.sort()).toEqual(["Status", "Title"]);
  });
});
