import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  checkSplAconexContent,
  matchSplAconexFileName,
  parseSplAconexFile,
  readSplAconexDocumentNumbers,
} from "./aconex-parser";
import { isOcsNumber } from "./hdec-parser";

const HEADERS = [
  "File", "Document No", "Title", "Revision", "Status", "Date Created",
  "Revision Date", "Date Modified", "Discipline", "Created By", "Related Items", "Type", "Size", "Lock",
];

function makeFile(name: string, rows: Array<[string, string, string]>): File {
  // 헤더 11행 · 데이터 12행부터 (실측과 동일)
  const aoa: any[][] = [];
  for (let i = 0; i < 10; i++) aoa.push([]);
  aoa.push(HEADERS);
  for (const [docNo, status, modified] of rows) {
    aoa.push(["f.pdf", docNo, "T", "A", status, "2026-01-01", "2026-01-01", modified, "EL", "u", "", "pdf", "1", ""]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Docs");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], name);
}

const SPL = (n: number, dis = "LST") => `9207-BP12C-HDEC-${dis}-EL-NS-000-${String(n).padStart(5, "0")}`;
// U+2010 이 섞인 실측형 번호
const SPL_U2010 = "9207-BP12D\u2010HDEC\u2010LST\u2010EL\u2010NS\u2010000\u201000005";
const OCS_U2010 = "9207-BP12D-HDEC-LST-EL\u2010OCS\u2010000-00007";

describe("gate 1 — file name", () => {
  it("accepts space / underscore variants and copy suffix", () => {
    expect(matchSplAconexFileName("SPL_PLOT C_ExportDocs20260808_1240.xlsx")?.plot).toBe("C");
    expect(matchSplAconexFileName("SPL_PLOT_D_ExportDocs20260808_1240 1.xlsx")?.plot).toBe("D");
    expect(matchSplAconexFileName("SPL_PLOT C_ExportDocs20260808_1240.xlsx")?.export_date).toBe("2026-08-08");
  });
  it("rejects WRT export file name", () => {
    expect(matchSplAconexFileName("WRT_PLOT_C_ExportDocs20260808_1240.xlsx")).toBeNull();
  });
});

describe("gate 2 — content majority", () => {
  it("blocks a CER-dominant export even with an SPL file name", () => {
    const nums = [...Array(202)].map((_, i) => SPL(i, "CER")).concat([...Array(6)].map((_, i) => SPL(i, "LST")));
    const c = checkSplAconexContent(nums);
    expect(c.ok).toBe(false);
    expect(c.cer).toBe(202);
  });
  it("passes an LST-dominant export", () => {
    const nums = [...Array(196)].map((_, i) => SPL(i)).concat([SPL(1, "LET")]);
    const c = checkSplAconexContent(nums);
    expect(c.ok).toBe(true);
    expect(c.lst).toBe(196);
  });
  it("reads document numbers from a WRT-shaped file for the content check", async () => {
    const f = makeFile("SPL_PLOT C_ExportDocs20260808_1240.xlsx", [
      [SPL(1, "CER"), "A - Approved", "2026-08-01"],
      [SPL(2, "CER"), "A - Approved", "2026-08-01"],
      [SPL(3), "A - Approved", "2026-08-01"],
    ]);
    const c = checkSplAconexContent(await readSplAconexDocumentNumbers(f));
    expect(c.ok).toBe(false);
  });
});

describe("parse rules", () => {
  it("For Review keeps no response date; No Status is skipped; OCS is excluded", async () => {
    const f = makeFile("SPL_PLOT C_ExportDocs20260808_1240.xlsx", [
      [SPL(1), "A - Approved", "2026-08-01"],
      [SPL(2), "C - Revise and Resubmit", "2026-08-02"],
      [SPL(3), "For Review", "2026-08-03"],
      [SPL(4), "No Status", "2026-08-04"],
      [SPL_U2010, "B - Approved with Comments", "2026-08-05"],
      [OCS_U2010, "A - Approved", "2026-08-06"],
    ]);
    const p = await parseSplAconexFile(f);
    expect(p.plot).toBe("C");
    expect(p.header_row).toBe(11);
    expect(p.ocs_excluded).toBe(1);
    expect(p.no_status).toBe(1);
    expect(p.rows).toHaveLength(4);

    const ur = p.rows.find((r) => r.code === "UR")!;
    expect(ur.date_modified).toBeNull();
    const c = p.rows.find((r) => r.code === "C")!;
    expect(c.date_modified).toBe("2026-08-02");
    // U+2010 이 ASCII 하이픈으로 정규화되어 매칭 키가 된다
    const b = p.rows.find((r) => r.code === "B")!;
    expect(b.document_no).toBe("9207-BP12D-HDEC-LST-EL-NS-000-00005");
  });

  it("HDEC parser excludes U+2010 OCS numbers as well", () => {
    expect(isOcsNumber(OCS_U2010)).toBe(true);
    expect(isOcsNumber(SPL(1))).toBe(false);
  });
});
