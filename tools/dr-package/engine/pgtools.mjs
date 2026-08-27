/**
 * pg_dump / pg_restore 17.x 탐색 및 실행 계약.
 * OS 차이는 이 파일의 "탐색 경로"에만 존재한다. 그 외 로직은 Windows/macOS 공용이다.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { redact } from "./redact.mjs";

export const REQUIRED_MAJOR = 17;

/** OS별 후보 bin 디렉터리 목록(설치는 자동으로 하지 않는다). */
export function candidateBinDirs(platform = process.platform) {
  if (platform === "win32") {
    const bases = ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"];
    const dirs = [];
    for (const b of bases) for (const v of ["17", "18"]) dirs.push(path.join(b, v, "bin"));
    return dirs;
  }
  if (platform === "darwin") {
    return [
      "/opt/homebrew/opt/postgresql@17/bin",
      "/usr/local/opt/postgresql@17/bin",
      "/Applications/Postgres.app/Contents/Versions/17/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ];
  }
  return ["/usr/lib/postgresql/17/bin", "/usr/local/pgsql/bin", "/usr/bin", "/bin"];
}

export const INSTALL_HINT = {
  win32:
    "PostgreSQL 17 을 설치하세요: https://www.postgresql.org/download/windows/ (EDB installer, Command Line Tools 포함). 설치 후 기본 경로는 C:\\Program Files\\PostgreSQL\\17\\bin 입니다.",
  darwin:
    "PostgreSQL 17 클라이언트를 설치하세요: 터미널에서 `brew install postgresql@17` 실행. 설치 후 기본 경로는 /opt/homebrew/opt/postgresql@17/bin 입니다.",
  linux: "PostgreSQL 17 클라이언트를 설치하세요: `sudo apt install postgresql-client-17`.",
};

function exe(name, platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

/** 실행 파일에서 major 버전을 읽는다. 실패 시 null. */
export async function readMajorVersion(binPath, runner = runCapture) {
  try {
    const res = await runner(binPath, ["--version"]);
    if (res.code !== 0) return null;
    const m = /(\d+)\.(\d+)/.exec(res.stdout);
    return m ? { major: Number(m[1]), version: res.stdout.trim() } : null;
  } catch {
    return null;
  }
}

/**
 * pg_dump/pg_restore 17.x 탐색.
 * @returns {Promise<{ok:true, pgDump:string, pgRestore:string, version:string, searched:string[]}|
 *                   {ok:false, reason:string, hint:string, searched:string[]}>}
 */
export async function findPgTools(options = {}) {
  const {
    platform = process.platform,
    explicitBinDir = process.env.QAIL_DR_PG_BIN || "",
    pathEnv = process.env.PATH || "",
    exists = existsSync,
    readVersion = readMajorVersion,
  } = options;

  const dirs = [];
  if (explicitBinDir) dirs.push(explicitBinDir);
  for (const d of pathEnv.split(platform === "win32" ? ";" : ":")) if (d) dirs.push(d);
  dirs.push(...candidateBinDirs(platform));

  const searched = [];
  for (const dir of dirs) {
    const dump = path.join(dir, exe("pg_dump", platform));
    const restore = path.join(dir, exe("pg_restore", platform));
    searched.push(dump);
    if (!exists(dump) || !exists(restore)) continue;
    const v = await readVersion(dump);
    if (!v) continue;
    if (v.major !== REQUIRED_MAJOR) continue;
    const vr = await readVersion(restore);
    if (!vr || vr.major !== REQUIRED_MAJOR) continue;
    return { ok: true, pgDump: dump, pgRestore: restore, version: v.version, searched };
  }
  return {
    ok: false,
    reason: `PostgreSQL ${REQUIRED_MAJOR}.x 의 pg_dump / pg_restore 를 찾지 못했습니다.`,
    hint: INSTALL_HINT[platform] ?? INSTALL_HINT.linux,
    searched,
  };
}

/** 표준출력을 모아 반환하는 단순 실행기. */
export function runCapture(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * 전체 DB dump (custom format). 비밀번호는 PGPASSWORD 환경변수로만 전달하며
 * 명령행 인자·로그에는 남기지 않는다.
 */
export async function runPgDump({ pgDump, conn, outFile, logFile, spawnFn = spawn }) {
  const args = [
    "--format=custom",
    "--compress=6",
    "--no-owner",
    "--no-privileges",
    "--verbose",
    `--host=${conn.host}`,
    `--port=${conn.port}`,
    `--username=${conn.user}`,
    `--dbname=${conn.database}`,
    `--file=${outFile}`,
  ];
  const log = createWriteStream(logFile, { flags: "a" });
  log.write(`# pg_dump ${args.filter((a) => !/^--file=/.test(a)).join(" ")}\n`);

  const code = await new Promise((resolve, reject) => {
    const child = spawnFn(pgDump, args, {
      env: { ...process.env, PGPASSWORD: conn.password ?? "", PGSSLMODE: conn.sslmode ?? "require" },
    });
    child.stdout?.on("data", (d) => log.write(redact(d.toString(), [conn.password])));
    child.stderr?.on("data", (d) => log.write(redact(d.toString(), [conn.password])));
    child.on("error", reject);
    child.on("close", (c) => resolve(c ?? 1));
  });
  await new Promise((r) => log.end(r));

  if (code !== 0) return { ok: false, code, reason: `pg_dump 종료 코드 ${code}` };
  if (!existsSync(outFile)) return { ok: false, code, reason: "dump 파일이 생성되지 않았습니다." };
  const size = statSync(outFile).size;
  if (size === 0) return { ok: false, code, reason: "dump 파일이 0 byte 입니다." };
  return { ok: true, code, bytes: size };
}

/** pg_restore --list 로 목차를 읽고 public/auth 객체 존재를 확인한다. */
export async function verifyDumpToc({ pgRestore, dumpFile, runner = runCapture }) {
  const res = await runner(pgRestore, ["--list", dumpFile]);
  if (res.code !== 0) {
    return { ok: false, reason: `pg_restore --list 실패 (코드 ${res.code}): ${redact(res.stderr).slice(0, 500)}` };
  }
  const toc = res.stdout;
  const hasPublic = /\bpublic\b/.test(toc);
  const hasAuth = /\bauth\b/.test(toc);
  if (!hasPublic || !hasAuth) {
    return {
      ok: false,
      reason: `dump 목차에 필수 스키마가 없습니다 (public=${hasPublic}, auth=${hasAuth}).`,
      entries: toc.split("\n").length,
    };
  }
  return { ok: true, entries: toc.split("\n").filter((l) => l && !l.startsWith(";")).length, hasPublic, hasAuth, toc };
}

export function platformLabel() {
  return `${process.platform} ${os.release()}`;
}
