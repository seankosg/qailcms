import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractHeadersFromFile,
  evaluateImport,
  type ModuleId,
  type Verdict,
} from "./module-fingerprint";
import { detectAbdSourceFromHeaders } from "@/lib/abd/source-fingerprint";

/**
 * [F-6] 모듈 지문 판정기 회귀 고정 테스트.
 * 픽스처는 실제 원본에서 헤더 블록(1행~컬럼명 행) + 데이터 2~3행만 잘라낸 것.
 * 앵커/동의어 표를 수정하면 반드시 이 표가 먼저 깨져야 한다.
 */
const FIX = join(__dirname, "__fixtures__");

function loadFile(name: string, renameTo?: string): File {
  const buf = readFileSync(join(FIX, name));
  return new File([new Uint8Array(buf)], renameTo ?? name);
}

type Row = {
  label: string;
  fixture: string;
  expect: Partial<Record<ModuleId, Verdict>>;
};

const TABLE: Row[] = [
  {
    label: "ABD HDEC Status (4단 헤더)",
    fixture: "abd-hdec-header.xlsx",
    expect: { abd: "ok", tm: "block", sm: "block" },
  },
  {
    label: "ABD Aconex Export",
    fixture: "abd-aconex-header.xlsx",
    expect: { abd: "ok", tm: "block", sm: "block" },
  },
  {
    label: "TM 원본",
    fixture: "tm-header.xlsx",
    expect: { abd: "block", tm: "ok", sm: "block" },
  },
  {
    label: "SM 원본",
    fixture: "sm-header.xlsx",
    expect: { abd: "block", tm: "block", sm: "ok" },
  },
];

const MODULES: ModuleId[] = ["abd", "tm", "sm"];

describe("module fingerprint 3x3 verdict matrix", () => {
  for (const row of TABLE) {
    it(`${row.label} — 원래 파일명`, async () => {
      const { headers, sheetNames } = await extractHeadersFromFile(
        loadFile(row.fixture),
      );
      for (const m of MODULES) {
        const v = evaluateImport(m, headers, sheetNames, row.fixture).verdict;
        expect(`${m}=${v}`).toBe(`${m}=${row.expect[m]}`);
      }
    });

    it(`${row.label} — 파일명 무의미 (sample_260731.xlsx)`, async () => {
      const fake = "sample_260731.xlsx";
      const { headers, sheetNames } = await extractHeadersFromFile(
        loadFile(row.fixture, fake),
      );
      for (const m of MODULES) {
        const v = evaluateImport(m, headers, sheetNames, fake).verdict;
        expect(`${m}=${v}`).toBe(`${m}=${row.expect[m]}`);
      }
    });
  }
});

describe("ABD 소스 판정기 (HDEC vs Aconex)", () => {
  it("HDEC 원본은 high confidence 로 hdec", async () => {
    const { headers } = await extractHeadersFromFile(
      loadFile("abd-hdec-header.xlsx", "sample_260731.xlsx"),
    );
    const r = detectAbdSourceFromHeaders(headers, "sample_260731.xlsx");
    expect(r.source).toBe("hdec");
    expect(r.confidence).toBe("high");
    expect(r.signals.hasAbdNumber).toBe(true);
    expect(r.signals.hasRoundBand).toBe(true);
  });

  it("Aconex Export 는 high confidence 로 aconex", async () => {
    const { headers } = await extractHeadersFromFile(
      loadFile("abd-aconex-header.xlsx", "sample_260731.xlsx"),
    );
    const r = detectAbdSourceFromHeaders(headers, "sample_260731.xlsx");
    expect(r.source).toBe("aconex");
    expect(r.confidence).toBe("high");
  });
});
