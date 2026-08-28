/**
 * 로컬 생성기 배포 ZIP 최소 계약 테스트 (HP3 교정).
 * 운영 DB·Storage 접속은 하지 않는다.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
    expect(/from\s*["']yazl["']/.test(bundle)).toBe(false);
    expect(/from\s*["']@supabase\/supabase-js["']/.test(bundle)).toBe(false);

    const dir = mkdtempSync(path.join(os.tmpdir(), "drgen-"));
    writeFileSync(path.join(dir, "run.bundle.mjs"), bundle, "utf8");
    // node_modules 가 전혀 없는 폴더에서 import 만 수행 (Wizard 는 실행하지 않음)
    const probe = path.join(dir, "probe.mjs");
    writeFileSync(
      probe,
      `import(${JSON.stringify(path.join(dir, "run.bundle.mjs"))}).then(()=>{},()=>{});console.log("LOADED");`,
      "utf8",
    );
    const out = execFileSync(process.execPath, [probe], { cwd: dir, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] })
      .toString();
    expect(out).toContain("LOADED");
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
    expect(/postgres:\/\/[^\s"']*:[^\s"'@]+@/.test(joined)).toBe(false);
  });

  it("7. UI manifest 의 URL·SHA-256 이 실제 파일과 일치한다", () => {
    expect(uiManifest.url).toBe("/downloads/QAIL-DR-Local-Generator.zip");
    const actual = createHash("sha256").update(readFileSync(ZIP)).digest("hex");
    expect(uiManifest.sha256).toBe(actual);
    expect(uiManifest.bytes).toBe(readFileSync(ZIP).length);
    expect(uiManifest.git_commit_short).toBe(String(relManifest.git_commit).slice(0, 12));
  });
});
