/**
 * 저장소 루트·migration·release 정보 수집.
 * process.cwd() 에 의존하지 않고 import.meta.url 기준으로 저장소 루트를 찾는다.
 * (런처가 tools/dr-package 로 이동해 실행해도 동일하게 동작해야 한다.)
 */
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { sha256File } from "./hash.mjs";

export class MigrationsNotFoundError extends Error {
  constructor(message, searched) {
    super(message);
    this.code = "MIGRATIONS_NOT_FOUND";
    this.searched = searched ?? [];
  }
}

/** engine/ 에서 위로 올라가며 supabase/migrations 또는 package.json 이 있는 폴더를 저장소 루트로 본다. */
export function findRepoRoot(startUrl = import.meta.url) {
  let dir = path.dirname(fileURLToPath(startUrl));
  const searched = [];
  for (let i = 0; i < 8; i += 1) {
    searched.push(dir);
    if (existsSync(path.join(dir, "supabase", "migrations"))) return { root: dir, searched };
    dir = path.dirname(dir);
  }
  return { root: null, searched };
}

/** 저장소 루트의 supabase/migrations 목록과 각 파일의 SHA-256 을 수집한다. 없거나 0건이면 차단. */
export async function collectMigrations(startUrl = import.meta.url) {
  const { root, searched } = findRepoRoot(startUrl);
  if (!root) {
    throw new MigrationsNotFoundError(
      "MIGRATIONS_NOT_FOUND: 저장소의 supabase/migrations 폴더를 찾지 못했습니다.",
      searched.map((d) => path.join(d, "supabase", "migrations")),
    );
  }
  const dir = path.join(root, "supabase", "migrations");
  const names = readdirSync(dir)
    .filter((n) => statSync(path.join(dir, n)).isFile() && n.toLowerCase().endsWith(".sql"))
    .sort();
  if (names.length === 0) {
    throw new MigrationsNotFoundError(`MIGRATIONS_NOT_FOUND: ${dir} 에 migration 파일이 없습니다.`, [dir]);
  }
  const files = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    files.push({ name, bytes: statSync(abs).size, sha256: await sha256File(abs) });
  }
  return { repo_root: root, dir, count: files.length, files };
}

/** 현재 Git commit ID. 읽을 수 없으면 "unknown". */
export function readGitCommit(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || "unknown";
  } catch {
    try {
      const head = readFileSync(path.join(root, ".git", "HEAD"), "utf8").trim();
      if (head.startsWith("ref: ")) {
        const ref = path.join(root, ".git", head.slice(5).trim());
        return existsSync(ref) ? readFileSync(ref, "utf8").trim() : "unknown";
      }
      return head || "unknown";
    } catch {
      return "unknown";
    }
  }
}

/** release-manifest.json / migrations-manifest.json 용 기본 시스템 정보. */
export async function defaultSystemInfo(startUrl = import.meta.url) {
  const migrations = await collectMigrations(startUrl);
  return {
    release: {
      generated_at: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      repo_root: migrations.repo_root,
      git_commit: readGitCommit(migrations.repo_root),
    },
    migrations: {
      note: "저장소 supabase/migrations 목록과 파일별 SHA-256",
      source_dir: migrations.dir,
      count: migrations.count,
      files: migrations.files,
    },
  };
}
