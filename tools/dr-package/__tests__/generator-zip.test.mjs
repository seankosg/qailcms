/**
 * 로컬 생성기 배포 ZIP 최소 계약 테스트 (HP3 교정).
 * 운영 DB·Storage 접속은 하지 않는다.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import yauzl from "yauzl";
import { collectMigrations } from "../engine/repo.mjs";
import { migrationsContractHash } from "../../../scripts/build-dr-generator.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ZIP = path.join(ROOT, "public", "downloads", "QAIL-DR-Local-Generator.zip");
const MANIFEST = path.join(ROOT, "public", "downloads", "QAIL-DR-Local-Generator.manifest.json");

function readZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zf) => {
      if (err) return reject(err);
      const names = [];
      const contents = new Map();
      zf.on("entry", (entry) => {
        names.push(entry.fileName);
        if (
          entry.fileName === "release-manifest.json" ||
          entry.fileName === "run.bundle.mjs" ||
          entry.fileName.endsWith(".cmd") ||
          entry.fileName.endsWith(".command")
        ) {
          zf.openReadStream(entry, (e2, rs) => {
            if (e2) return reject(e2);
            const chunks = [];
            rs.on("data", (c) => chunks.push(c));
            rs.on("end", () => {
              contents.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
              zf.readEntry();
            });
          });
        } else {
          zf.readEntry();
        }
      });
      zf.on("error", reject);
      zf.on("end", () => resolve({ names, contents }));
      zf.readEntry();
    });
  });
}

describe("로컬 생성기 배포 ZIP", () => {
  let names, contents, uiManifest, relManifest;

  beforeAll(async () => {
    expect(existsSync(ZIP), "생성기 ZIP 이 없습니다. node scripts/build-dr-generator.mjs 실행 필요").toBe(true);
    ({ names, contents } = await readZip(ZIP));
    uiManifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    relManifest = JSON.parse(contents.get("release-manifest.json"));
  });

  it("1. 필수 파일이 모두 들어 있다", () => {
    for (const f of [
      "README_KR.md",
      "release-manifest.json",
      "run.bundle.mjs",
      "QAIL-재해복구-패키지-생성.cmd",
      "QAIL-재해복구-패키지-생성.command",
    ]) {
      expect(names).toContain(f);
    }
  });

  it("2. migration 수가 저장소 실제 수와 일치한다", async () => {
    const m = await collectMigrations(new URL("../engine/repo.mjs", import.meta.url).href);
    const inZip = names.filter((n) => n.startsWith("supabase/migrations/") && n.endsWith(".sql"));
    expect(inZip.length).toBe(m.count);
    expect(relManifest.migrations_count).toBe(m.count);
  });

  it("3. migration 전체 계약 hash 가 일치한다", async () => {
    const m = await collectMigrations(new URL("../engine/repo.mjs", import.meta.url).href);
    expect(relManifest.migrations_contract_sha256).toBe(migrationsContractHash(m.files));
  });

  it("4. run.bundle.mjs 가 의존성을 포함해 node_modules 없이 시작한다", () => {
    const bundle = contents.get("run.bundle.mjs");
    expect(bundle.length).toBeGreaterThan(50_000);
    // 남아 있는 정적 import 는 Node 내장 모듈뿐이어야 한다(별도 node_modules 불필요).
    const specs = [...bundle.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((s) => !s.startsWith("node:"))).toEqual([]);

    const dir = mkdtempSync(path.join(os.tmpdir(), "drgen-"));
    // node_modules 가 전혀 없는 폴더에서 bundle 단독 실행 (입력 없이 즉시 종료)
    writeFileSync(path.join(dir, "run.bundle.mjs"), bundle, "utf8");
    const res = spawnSync(process.execPath, ["run.bundle.mjs"], {
      cwd: dir,
      input: "",
      timeout: 60_000,
      encoding: "utf8",
    });
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(out).toContain("QAIL CMS 재해복구 패키지 생성기");
    expect(out).not.toMatch(/Cannot find (package|module)/i);
  });

  it("5. Windows/macOS 런처가 동일 bundle 을 호출한다", () => {
    expect(contents.get("QAIL-재해복구-패키지-생성.cmd")).toContain("run.bundle.mjs");
    expect(contents.get("QAIL-재해복구-패키지-생성.command")).toContain("run.bundle.mjs");
  });

  it("6. 비밀값·.env·실제 자격증명이 없다", () => {
    expect(names.some((n) => n.includes(".env"))).toBe(false);
    const joined = [...contents.values()].join("\n");
    expect(/service_role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/.test(joined)).toBe(false);
    expect(/eyJhbGciOiJIUzI1NiI/.test(joined)).toBe(false);
    expect(/sb_secret_/.test(joined)).toBe(false);
    // 저장소 .env 의 실제 값이 어떤 형태로든 들어가지 않았는지 대조한다.
    const envPath = path.join(ROOT, ".env");
    if (existsSync(envPath)) {
      const values = readFileSync(envPath, "utf8")
        .split(/\r?\n/)
        .map((l) => l.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, ""))
        .filter((v) => v.length >= 12);
      for (const v of values) expect(joined.includes(v)).toBe(false);
    }
  });

  it("7. UI manifest 의 URL·SHA-256 이 실제 파일과 일치한다", () => {
    expect(uiManifest.url).toBe("/downloads/QAIL-DR-Local-Generator.zip");
    const actual = createHash("sha256").update(readFileSync(ZIP)).digest("hex");
    expect(uiManifest.sha256).toBe(actual);
    expect(uiManifest.bytes).toBe(readFileSync(ZIP).length);
    expect(uiManifest.git_commit_short).toBe(String(relManifest.git_commit).slice(0, 12));
  });
});
