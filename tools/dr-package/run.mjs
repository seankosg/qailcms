#!/usr/bin/env node
/**
 * QAIL CMS 로컬 재해복구 패키지 생성기 — 터미널 Wizard.
 * Windows(.cmd) 와 macOS(.command) 런처가 이 파일 하나를 호출한다.
 *
 * 비밀번호는 화면에 표시하지 않고, 명령행 인자·로그·패키지에 남기지 않는다.
 */
import readline from "node:readline";
import path from "node:path";
import os from "node:os";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { buildDrPackage, STATUS } from "./engine/build.mjs";
import { findPgTools } from "./engine/pgtools.mjs";
import { DR_BUCKETS, EXCLUDED_BUCKETS } from "./engine/buckets.mjs";
import { makeSupabaseStorageClient } from "./engine/supabase-adapter.mjs";
import { safeConnDisplay } from "./engine/redact.mjs";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def = "") =>
  new Promise((res) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => res((a || def).trim())));

function askHidden(q) {
  return new Promise((res) => {
    process.stdout.write(`${q}: `);
    const onData = (char) => {
      if (["\n", "\r", "\u0004"].includes(char.toString())) {
        process.stdin.removeListener("data", onData);
        return;
      }
      readline.moveCursor(process.stdout, -1, 0);
      process.stdout.write("*");
    };
    process.stdin.on("data", onData);
    rl.question("", (a) => {
      process.stdout.write("\n");
      process.stdin.removeListener("data", onData);
      res(a.trim());
    });
  });
}

function openFolder(dir) {
  const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  try {
    spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* 무시 */
  }
}

async function main() {
  console.log("\n=== QAIL CMS 재해복구 패키지 생성기 ===\n");

  // 1) 환경 확인
  console.log("[1/6] 환경 확인 중...");
  const tools = await findPgTools();
  if (!tools.ok) {
    console.error(`\n실패: ${tools.reason}\n\n설치 안내:\n  ${tools.hint}\n`);
    console.error("탐색한 경로:");
    for (const p of tools.searched.slice(0, 15)) console.error(`  - ${p}`);
    console.error("\n설치 후 다시 실행하거나, 환경변수 QAIL_DR_PG_BIN 에 bin 폴더를 지정하세요.\n");
    rl.close();
    process.exitCode = 1;
    return;
  }
  console.log(`  PostgreSQL 도구: ${tools.version}`);
  console.log(`  pg_dump: ${tools.pgDump}`);

  // 2) DB 연결 정보
  console.log("\n[2/6] 데이터베이스 연결 정보");
  const host = await ask("  호스트", process.env.QAIL_DR_HOST || "");
  const port = Number(await ask("  포트", process.env.QAIL_DR_PORT || "5432"));
  const database = await ask("  데이터베이스 이름", process.env.QAIL_DR_DB || "postgres");
  const user = await ask("  사용자", process.env.QAIL_DR_USER || "postgres");
  const password = process.env.QAIL_DR_PASSWORD || (await askHidden("  비밀번호(화면에 표시되지 않음)"));

  const supabaseUrl = await ask("  백엔드 URL(https://...supabase.co)", process.env.QAIL_DR_SUPABASE_URL || "");
  const serviceKey = process.env.QAIL_DR_SERVICE_KEY || (await askHidden("  서버 키(service role, 화면에 표시되지 않음)"));

  // 3) 저장 폴더
  console.log("\n[3/6] 저장 폴더");
  const defaultOut = path.join(os.homedir(), "QAIL-DR");
  const outDir = await ask("  완성 ZIP 을 저장할 폴더", defaultOut);
  const workDir = path.join(outDir, ".work");
  mkdirSync(workDir, { recursive: true });

  // 4) 예상 범위
  console.log("\n[4/6] 예상 범위");
  console.log(`  대상 DB: ${safeConnDisplay(`postgres://${user}:${password}@${host}:${port}/${database}`)}`);
  console.log(`  포함 보관함(${DR_BUCKETS.length}): ${DR_BUCKETS.join(", ")}`);
  console.log(`  제외 보관함: ${EXCLUDED_BUCKETS.join(", ")}`);
  console.log("  예상 크기: 약 2~3 GB (8 GB 초과 시 분할 권고 표시)");
  const go = await ask("\n  생성을 시작할까요? (y/N)", "N");
  if (go.toLowerCase() !== "y") {
    console.log("  취소했습니다.");
    rl.close();
    return;
  }

  // 5) 생성
  console.log("\n[5/6] 생성 중...");
  const storageClient = makeSupabaseStorageClient({ url: supabaseUrl, serviceRoleKey: serviceKey });
  let lastLine = "";
  const onProgress = (p) => {
    let line = "";
    if (p.step === "storage" && p.phase === "download") line = `  Storage 파일 ${p.done}/${p.total}`;
    else if (p.step === "storage" && p.phase === "list") line = `  Storage 목록 ${p.bucket}: ${p.count}건`;
    else if (p.step === "zip" && p.done) line = `  ZIP ${p.done}/${p.total}`;
    else if (p.message) line = `  ${p.message}`;
    if (line && line !== lastLine) {
      lastLine = line;
      console.log(line);
    }
  };

  const result = await buildDrPackage({
    conn: { host, port, user, password, database },
    outDir,
    workDir,
    storageClient,
    fetchAuthUsers: () => storageClient.listUsers(),
    systemInfo: async () => ({
      release: { generated_at: new Date().toISOString(), node: process.version, platform: process.platform },
      migrations: {
        note: "저장소의 supabase/migrations 목록",
        files: existsSync("supabase/migrations") ? readdirSync("supabase/migrations") : [],
      },
    }),
    onProgress,
  });

  // 6) 결과
  console.log("\n[6/6] 결과");
  if (result.ok) {
    console.log(`  상태: ${STATUS.COMPLETED}`);
    console.log(`  ZIP: ${result.path}`);
    console.log(`  크기: ${(result.bytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  SHA-256: ${result.sha256}`);
    if (result.split_recommended) console.log("  주의: 8 GB 를 초과했습니다. 독립 ZIP 분할을 검토하세요.");
    console.log(`  영수증: ${result.receiptPath}`);
    const open = await ask("  폴더를 열까요? (y/N)", "N");
    if (open.toLowerCase() === "y") openFolder(outDir);
  } else {
    console.error(`  상태: ${result.status}`);
    console.error(`  오류: ${result.error}`);
    console.error(`  영수증: ${result.receiptPath}`);
    console.error("  원인을 해결한 뒤 같은 런처를 다시 실행하세요. 이미 만들어진 부분은 재사용하지 않고 처음부터 다시 만듭니다.");
    process.exitCode = 1;
  }
  rl.close();
}

main().catch((err) => {
  console.error(err?.message ?? err);
  rl.close();
  process.exitCode = 1;
});
