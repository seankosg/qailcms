#!/usr/bin/env node
/**
 * 로컬 재해복구 생성기 배포 ZIP 제작 스크립트 (결정적).
 *
 * 산출물: public/downloads/QAIL-DR-Local-Generator.zip
 *         public/downloads/QAIL-DR-Local-Generator.manifest.json (UI 표시용)
 *
 * - HP2 공용 엔진 + JS 의존성(yazl/yauzl/@supabase/supabase-js)을 run.bundle.mjs 하나로 묶는다.
 * - supabase/migrations 전체를 동봉하고 계약 hash 를 기록한다.
 * - 운영 자격증명·.env·환경변수는 절대 포함하지 않는다.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync, createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import yazl from "yazl";
import { collectMigrations, readGitCommit } from "../tools/dr-package/engine/repo.mjs";
import { sha256File } from "../tools/dr-package/engine/hash.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "downloads");
const ZIP_NAME = "QAIL-DR-Local-Generator.zip";
const ZIP_PATH = path.join(OUT_DIR, ZIP_NAME);
const MANIFEST_PATH = path.join(OUT_DIR, "QAIL-DR-Local-Generator.manifest.json");
export const GENERATOR_VERSION = "1.0.0";

/** migration 목록 전체 계약 hash: "name:sha256\n" 연결 문자열의 SHA-256. */
export function migrationsContractHash(files) {
  const text = files.map((f) => `${f.name}:${f.sha256}`).join("\n");
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

const README_GEN = `# QAIL CMS 로컬 재해복구 생성기

이 폴더는 QAIL CMS 재해복구 패키지를 **관리자 로컬 PC** 에서 만들기 위한 도구입니다.

## 준비물
1. Node.js LTS (https://nodejs.org)
2. PostgreSQL 17.x client (pg_dump, pg_restore)
3. 운영 DB 접속정보 / 백엔드 URL / 서버 키(service role)
4. 완성 ZIP 을 저장할 로컬 폴더

별도의 npm install, 저장소 clone, Git 은 필요하지 않습니다.
필요한 JS 의존성은 run.bundle.mjs 안에 모두 포함되어 있습니다.

## 실행
- Windows: \`QAIL-재해복구-패키지-생성.cmd\` 더블클릭
- macOS: \`QAIL-재해복구-패키지-생성.command\` 더블클릭
  (최초 1회 \`chmod +x QAIL-재해복구-패키지-생성.command\` 가 필요할 수 있습니다)

두 런처는 동일한 \`run.bundle.mjs\` 를 호출합니다.

## 포함 범위
- 전체 DB dump (auth 포함, PostgreSQL 17.x custom format)
- 업무 Storage 보관함 7개
- \`db-backups\` 보관함은 중복이므로 제외합니다

## 주의
- 이 폴더에는 어떤 비밀번호나 서버 키도 저장되어 있지 않습니다. 실행 중에만 입력합니다.
- 완성된 ZIP 과 run_receipt.json 은 반드시 함께 보관하고, QAIL CMS 관리자 화면의
  "로컬 재해복구 패키지" 카드에서 검증하세요.
- 동봉된 supabase/migrations 는 이 생성기 버전이 전제하는 스키마 계약입니다.
`;

function bundleEngine(outFile) {
  const esbuild = path.join(ROOT, "node_modules", ".bin", "esbuild");
  const banner =
    "import{createRequire as __cr}from'node:module';" +
    "const require=__cr(import.meta.url);" +
    "const __filename=(await import('node:url')).fileURLToPath(import.meta.url);" +
    "const __dirname=(await import('node:path')).dirname(__filename);";
  execFileSync(
    esbuild,
    [
      path.join(ROOT, "tools", "dr-package", "run.mjs"),
      "--bundle",
      "--platform=node",
      "--target=node20",
      "--format=esm",
      "--legal-comments=none",
      `--banner:js=${banner}`,
      `--outfile=${outFile}`,
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
}

export async function buildGeneratorZip() {
  const migrations = await collectMigrations(new URL("../tools/dr-package/engine/repo.mjs", import.meta.url).href);
  const contractHash = migrationsContractHash(migrations.files);
  const gitCommit = readGitCommit(ROOT);

  mkdirSync(OUT_DIR, { recursive: true });
  const work = path.join(ROOT, "node_modules", ".cache", "dr-generator");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const bundlePath = path.join(work, "run.bundle.mjs");
  bundleEngine(bundlePath);

  const releaseManifest = {
    name: "QAIL-DR-Local-Generator",
    generator_version: GENERATOR_VERSION,
    git_commit: gitCommit,
    git_commit_short: gitCommit.slice(0, 12),
    migrations_count: migrations.count,
    migrations_contract_sha256: contractHash,
    bundle_entry: "run.bundle.mjs",
    requires: { node: "LTS", postgresql_client: "17.x" },
    note: "이 파일에는 자격증명이 포함되지 않습니다.",
  };

  const entries = [
    { zipPath: "README_KR.md", content: README_GEN },
    { zipPath: "release-manifest.json", content: `${JSON.stringify(releaseManifest, null, 2)}\n` },
    { zipPath: "run.bundle.mjs", localPath: bundlePath },
    {
      zipPath: "QAIL-재해복구-패키지-생성.cmd",
      localPath: path.join(ROOT, "tools", "dr-package", "QAIL-재해복구-패키지-생성.cmd"),
    },
    {
      zipPath: "QAIL-재해복구-패키지-생성.command",
      localPath: path.join(ROOT, "tools", "dr-package", "QAIL-재해복구-패키지-생성.command"),
      mode: 0o755,
    },
    ...migrations.files.map((f) => ({
      zipPath: `supabase/migrations/${f.name}`,
      localPath: path.join(migrations.dir, f.name),
    })),
  ];

  // 결정적 ZIP: 고정 mtime, 고정 순서
  const MTIME = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
  const zip = new yazl.ZipFile();
  for (const e of entries) {
    const opts = { mtime: MTIME, mode: e.mode ?? 0o644, compress: true, forceZip64Format: false };
    if (typeof e.content === "string") zip.addBuffer(Buffer.from(e.content, "utf8"), e.zipPath, opts);
    else zip.addFile(e.localPath, e.zipPath, opts);
  }
  zip.end({ forceZip64Format: false });
  rmSync(ZIP_PATH, { force: true });
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(ZIP_PATH);
    ws.on("error", reject);
    ws.on("close", resolve);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(ws);
  });

  const bytes = statSync(ZIP_PATH).size;
  const sha256 = await sha256File(ZIP_PATH);
  const uiManifest = {
    ...releaseManifest,
    file: ZIP_NAME,
    url: `/downloads/${ZIP_NAME}`,
    bytes,
    sha256,
    entry_count: entries.length,
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(uiManifest, null, 2)}\n`, "utf8");
  rmSync(work, { recursive: true, force: true });
  return uiManifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildGeneratorZip()
    .then((m) => {
      console.log(`생성 완료: ${ZIP_PATH}`);
      console.log(`  크기: ${(m.bytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  SHA-256: ${m.sha256}`);
      console.log(`  migrations: ${m.migrations_count} / contract ${m.migrations_contract_sha256}`);
    })
    .catch((e) => {
      console.error(e?.stack ?? e);
      process.exitCode = 1;
    });
}

export { ZIP_PATH, MANIFEST_PATH, OUT_DIR, ZIP_NAME, existsSync, readFileSync };
