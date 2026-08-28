/**
 * 로컬 재해복구(DR) 패키지 생성 엔진 — Windows/macOS 공용 정본.
 *
 * 이 파일은 순서·검산·영수증 규칙만 담당하고, 외부 의존(pg_dump 실행·Storage 접근)은
 * 모두 주입받는다. 테스트는 소형 fixture 로 같은 경로를 실행한다.
 */
import { mkdirSync, writeFileSync, statSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { sha256File, sha256Text } from "./hash.mjs";
import { redact, redactDeep } from "./redact.mjs";
import { DR_BUCKETS, EXCLUDED_BUCKETS, assertBucketScope } from "./buckets.mjs";
import { collectStorage } from "./storage.mjs";
import { createZip, verifyZip } from "./zip.mjs";
import { findPathCollisions } from "./paths.mjs";
import { runPgDump, verifyDumpToc, findPgTools } from "./pgtools.mjs";
import { README_KR } from "./readme-template.mjs";
import { defaultSystemInfo } from "./repo.mjs";

export const STATUS = { RUNNING: "running", COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled" };

export function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeJson(file, value) {
  const text = JSON.stringify(value, null, 2);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
  return text;
}

/**
 * @param {object} opts
 * @param {{host:string,port:number,user:string,password:string,database:string,sslmode?:string}} opts.conn
 * @param {string} opts.outDir      완성 ZIP 을 둘 최종 폴더(사용자 선택 폴더)
 * @param {string} opts.workDir     로컬 작업 폴더(자격증명·중간 산출물, ZIP 에 포함하지 않음)
 */
export async function buildDrPackage(opts) {
  const {
    conn,
    outDir,
    workDir,
    buckets = DR_BUCKETS,
    onProgress = () => {},
    now = new Date(),
    // 주입 가능한 의존성 (테스트/OS 차이 흡수)
    pgTools = null,
    dumpFn = runPgDump,
    tocFn = verifyDumpToc,
    storageClient,
    fetchAuthUsers = async () => ({ users: [], note: "auth 정본은 DB dump 의 auth 스키마입니다." }),
    systemInfo = defaultSystemInfo,
    serviceRoleKey = null,
    extraSecrets = [],
    maxPackageBytes = 8 * 1024 * 1024 * 1024,
  } = opts;

  assertBucketScope(buckets);

  const stamp = stampNow(now);
  const runId = `QAIL_DR_${stamp}`;
  const stageRoot = path.join(workDir, runId);
  const receiptPath = path.join(workDir, "run_receipt.json");
  const secrets = [conn?.password, serviceRoleKey, ...extraSecrets].filter((v) => typeof v === "string" && v.length >= 4);

  const receipt = {
    run_id: runId,
    status: STATUS.RUNNING,
    started_at: new Date(now).toISOString(),
    finished_at: null,
    platform: process.platform,
    postgres: null,
    database_dump: null,
    storage: { buckets: {}, files: 0, bytes: 0 },
    excluded_buckets: EXCLUDED_BUCKETS,
    zip: null,
    staging_path: stageRoot,
    cleanup_warning: null,
    error: null,
    error_code: null,
  };
  const saveReceipt = () => writeJson(receiptPath, redactDeep(receipt, secrets));
  saveReceipt();

  try {
    mkdirSync(stageRoot, { recursive: true });
    mkdirSync(outDir, { recursive: true });

    // 1) 환경 확인 — pg_dump/pg_restore 17.x
    onProgress({ step: "env", message: "PostgreSQL 17 도구 확인" });
    const tools = pgTools ?? (await findPgTools());
    if (!tools.ok) throw new Error(`${tools.reason}\n${tools.hint}\n탐색한 경로:\n - ${tools.searched.slice(0, 12).join("\n - ")}`);
    receipt.postgres = { version: tools.version, pg_dump: tools.pgDump, pg_restore: tools.pgRestore };
    saveReceipt();

    // 2) DB dump (전체 DB, custom format)
    onProgress({ step: "dump", message: "데이터베이스 dump 생성 중" });
    const dbDir = path.join(stageRoot, "database");
    mkdirSync(dbDir, { recursive: true });
    const dumpFile = path.join(dbDir, "qail-full-database.dump");
    const dumpLog = path.join(dbDir, "pg-dump.log");
    const dumpRes = await dumpFn({ pgDump: tools.pgDump, conn, outFile: dumpFile, logFile: dumpLog });
    if (!dumpRes.ok) throw new Error(`DB dump 실패: ${dumpRes.reason}`);

    onProgress({ step: "dump-verify", message: "dump 목차(pg_restore --list) 검증" });
    const toc = await tocFn({ pgRestore: tools.pgRestore, dumpFile });
    if (!toc.ok) throw new Error(`DB dump 검증 실패: ${toc.reason}`);

    const dumpSha = await sha256File(dumpFile);
    receipt.database_dump = { bytes: dumpRes.bytes, sha256: dumpSha, toc_entries: toc.entries };
    saveReceipt();
    writeJson(path.join(dbDir, "database-info.json"), {
      format: "pg_dump custom (--format=custom)",
      pg_dump_version: tools.version,
      required_pg_restore_major: 17,
      host: conn.host,
      database: conn.database,
      schemas_excluded: [],
      includes_auth_schema: true,
      toc_entries: toc.entries,
      restore_command:
        'pg_restore --clean --if-exists --no-owner --no-privileges --dbname="<대상DB접속문자열>" qail-full-database.dump',
      created_at: new Date().toISOString(),
    });

    // 3) auth 사용자 메타(참고자료)
    onProgress({ step: "auth", message: "사용자 목록(참고용) 저장" });
    const authMeta = await fetchAuthUsers();
    writeJson(path.join(stageRoot, "auth", "users-metadata.json"), redactDeep(authMeta, secrets));

    // 4) Storage 수집
    onProgress({ step: "storage", message: "Storage 파일 수집" });
    const storageRoot = path.join(stageRoot, "storage");
    const storage = await collectStorage(storageClient, buckets, storageRoot, (p) =>
      onProgress({ step: "storage", ...p }),
    );
    receipt.storage = { buckets: storage.perBucket, files: storage.files.length, bytes: storage.totalBytes };
    saveReceipt();
    writeJson(path.join(storageRoot, "storage-manifest.json"), {
      buckets_included: buckets,
      buckets_excluded: EXCLUDED_BUCKETS,
      file_count: storage.files.length,
      total_bytes: storage.totalBytes,
      per_bucket: storage.perBucket,
      files: storage.files.map((f) => ({ bucket: f.bucket, path: f.path, bytes: f.bytes, sha256: f.sha256 })),
    });

    // 5) 시스템 참고자료
    onProgress({ step: "system", message: "시스템 정보 기록" });
    const sys = await systemInfo();
    const migrations = sys.migrations ?? {};
    if (!Array.isArray(migrations.files) || migrations.files.length === 0) {
      const e = new Error("MIGRATIONS_NOT_FOUND: migration 목록이 비어 있어 패키지를 완료할 수 없습니다.");
      e.code = "MIGRATIONS_NOT_FOUND";
      throw e;
    }
    if (migrations.files.some((f) => !f || typeof f.sha256 !== "string" || f.sha256.length !== 64)) {
      const e = new Error("MIGRATIONS_NOT_FOUND: migration 파일 SHA-256 이 누락되었습니다.");
      e.code = "MIGRATIONS_NOT_FOUND";
      throw e;
    }
    writeJson(path.join(stageRoot, "system", "release-manifest.json"), redactDeep({ git_commit: "unknown", ...(sys.release ?? {}) }, secrets));
    writeJson(path.join(stageRoot, "system", "migrations-manifest.json"), redactDeep(migrations, secrets));
    writeJson(path.join(stageRoot, "system", "environment-template.json"), {
      note: "키 이름만 기록합니다. 실제 비밀값은 포함하지 않습니다.",
      keys: sys.envKeys ?? [
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "VITE_SUPABASE_PROJECT_ID",
        "SUPABASE_SERVICE_ROLE_KEY",
        "DATABASE_URL",
      ],
    });

    // 6) 패키지 파일 목록 구성 + 해시 검산
    onProgress({ step: "hash", message: "SHA-256 검산" });
    const stagedFiles = [
      { rel: "database/qail-full-database.dump", abs: dumpFile },
      { rel: "database/pg-dump.log", abs: dumpLog },
      { rel: "database/database-info.json", abs: path.join(dbDir, "database-info.json") },
      { rel: "auth/users-metadata.json", abs: path.join(stageRoot, "auth", "users-metadata.json") },
      { rel: "storage/storage-manifest.json", abs: path.join(storageRoot, "storage-manifest.json") },
      { rel: "system/release-manifest.json", abs: path.join(stageRoot, "system", "release-manifest.json") },
      { rel: "system/migrations-manifest.json", abs: path.join(stageRoot, "system", "migrations-manifest.json") },
      { rel: "system/environment-template.json", abs: path.join(stageRoot, "system", "environment-template.json") },
      ...storage.files.map((f) => ({ rel: `storage/${f.bucket}/${f.path}`, abs: f.localPath, sha256: f.sha256, bytes: f.bytes })),
    ];

    const fileRecords = [];
    for (const f of stagedFiles) {
      if (!existsSync(f.abs)) throw new Error(`패키지 구성 파일 누락: ${f.rel}`);
      const bytes = statSync(f.abs).size;
      const sha256 = await sha256File(f.abs);
      if (f.sha256 && f.sha256 !== sha256) throw new Error(`SHA-256 불일치: ${f.rel}`);
      if (typeof f.bytes === "number" && f.bytes !== bytes) throw new Error(`byte 수 불일치: ${f.rel}`);
      fileRecords.push({ path: f.rel, bytes, sha256 });
    }

    const storageRecords = fileRecords.filter((r) => r.path.startsWith("storage/") && r.path !== "storage/storage-manifest.json");
    if (storageRecords.length !== storage.files.length) {
      throw new Error(`Storage manifest 파일 수 ${storage.files.length} vs 실제 ${storageRecords.length}`);
    }
    const storageBytes = storageRecords.reduce((s, r) => s + r.bytes, 0);
    if (storageBytes !== storage.totalBytes) {
      throw new Error(`Storage byte 합계 불일치: manifest ${storage.totalBytes} vs 실제 ${storageBytes}`);
    }

    // 7) 매니페스트·체크섬·보고서 (자기 자신은 목록 뒤에 붙는다)
    const backupManifest = {
      run_id: runId,
      created_at: new Date().toISOString(),
      package_format: "QAIL-DR-v1",
      generated_on: process.platform,
      database: { file: "database/qail-full-database.dump", bytes: dumpRes.bytes, sha256: dumpSha, format: "custom" },
      storage: { buckets_included: buckets, buckets_excluded: EXCLUDED_BUCKETS, file_count: storage.files.length, bytes: storage.totalBytes },
      files: fileRecords,
      file_count: 0,
    };

    const readme = README_KR({ runId, buckets, excluded: EXCLUDED_BUCKETS, storage, dumpBytes: dumpRes.bytes });
    const report = {
      run_id: runId,
      checks: {
        pg_dump_exit_zero: true,
        dump_non_empty: dumpRes.bytes > 0,
        pg_restore_list_readable: true,
        dump_has_public_and_auth: true,
        buckets_listed: buckets.length,
        storage_manifest_count_match: true,
        storage_manifest_bytes_match: true,
        all_sha256_verified: true,
      },
      storage_per_bucket: storage.perBucket,
      excluded_buckets: EXCLUDED_BUCKETS,
    };

    const extraTexts = [
      { rel: "README_KR.md", text: readme },
      { rel: "verification/backup-report.json", text: JSON.stringify(report, null, 2) },
    ];
    for (const t of extraTexts) fileRecords.push({ path: t.rel, bytes: Buffer.byteLength(t.text, "utf8"), sha256: sha256Text(t.text) });

    // backup-manifest.json / checksums.sha256 은 목록 자체를 담으므로 마지막에 확정한다.
    backupManifest.files = fileRecords;
    backupManifest.file_count = fileRecords.length + 2; // + manifest + checksums
    const manifestText = JSON.stringify(backupManifest, null, 2);
    const checksumsText = `${fileRecords.map((r) => `${r.sha256}  ${r.path}`).join("\n")}\n`;

    const zipEntries = [
      ...fileRecords
        .filter((r) => !extraTexts.some((t) => t.rel === r.path))
        .map((r) => ({
          zipPath: `${runId}/${r.path}`,
          localPath: stagedFiles.find((f) => f.rel === r.path).abs,
        })),
      ...extraTexts.map((t) => ({ zipPath: `${runId}/${t.rel}`, content: t.text })),
      { zipPath: `${runId}/backup-manifest.json`, content: manifestText },
      { zipPath: `${runId}/checksums.sha256`, content: checksumsText },
    ];

    const collision = findPathCollisions(zipEntries.map((e) => e.zipPath));
    if (!collision.ok) throw new Error("패키지 경로 중복 또는 대소문자 충돌이 있습니다.");
    if (zipEntries.length !== backupManifest.file_count) {
      throw new Error(`manifest 선언 파일 수 ${backupManifest.file_count} vs 실제 ${zipEntries.length}`);
    }

    // 8) ZIP 생성 및 재개봉 검증
    onProgress({ step: "zip", message: "ZIP 생성" });
    const zipPath = path.join(outDir, `${runId}.zip`);
    const zipRes = await createZip(zipEntries, zipPath, (p) => onProgress({ step: "zip", ...p }));

    // 8-1) 8GB 계약: 초과하면 completed 로 처리하지 않고 과대 ZIP 을 삭제한다.
    if (zipRes.bytes > maxPackageBytes) {
      const e = new Error(
        `PACKAGE_SIZE_LIMIT_EXCEEDED: 완성 ZIP ${zipRes.bytes} byte 가 상한 ${maxPackageBytes} byte(8 GB)를 초과했습니다.`,
      );
      e.code = "PACKAGE_SIZE_LIMIT_EXCEEDED";
      e.sizeLimit = { zip_bytes: zipRes.bytes, limit_bytes: maxPackageBytes, zip_path: zipPath };
      e.cleanupAll = true;
      throw e;
    }

    const verify = await verifyZip(
      zipPath,
      [`${runId}/backup-manifest.json`, `${runId}/checksums.sha256`, `${runId}/README_KR.md`, `${runId}/database/qail-full-database.dump`],
      zipEntries.length,
    );
    if (!verify.ok) throw new Error(`ZIP 재개봉 검증 실패: ${verify.reason}`);

    receipt.zip = { path: zipPath, bytes: zipRes.bytes, sha256: zipRes.sha256, entries: zipRes.entries };

    // 9) 검증 통과 후 staging 삭제(최종 ZIP + 영수증만 보존)
    onProgress({ step: "cleanup", message: "중간 작업파일 정리" });
    try {
      rmSync(stageRoot, { recursive: true, force: true });
      receipt.staging_path = null;
      receipt.staging_cleaned = true;
    } catch (cleanupErr) {
      receipt.staging_cleaned = false;
      receipt.cleanup_warning = {
        path: stageRoot,
        error: redact(cleanupErr?.message || String(cleanupErr), secrets),
        note: "중간 작업 폴더를 자동 삭제하지 못했습니다. 수동으로 삭제하세요.",
      };
    }

    receipt.status = STATUS.COMPLETED;
    receipt.finished_at = new Date().toISOString();
    saveReceipt();
    onProgress({ step: "done", message: "완료" });
    return {
      ok: true,
      runId,
      receiptPath,
      ...receipt.zip,
      cleanup_warning: receipt.cleanup_warning,
      manifest: backupManifest,
    };
  } catch (err) {
    receipt.status = err?.cancelled ? STATUS.CANCELLED : STATUS.FAILED;
    receipt.error_code = err?.code ?? null;
    receipt.error = redact(err?.stack || err?.message || String(err), secrets);
    if (err?.sizeLimit) receipt.size_limit = err.sizeLimit;
    if (err?.cleanupAll) {
      // 과대 ZIP 과 staging 은 남기지 않는다.
      try {
        rmSync(err.sizeLimit.zip_path, { force: true });
      } catch {
        /* 무시 */
      }
      try {
        rmSync(stageRoot, { recursive: true, force: true });
        receipt.staging_path = null;
      } catch (cleanupErr) {
        receipt.cleanup_warning = {
          path: stageRoot,
          error: redact(cleanupErr?.message || String(cleanupErr), secrets),
        };
      }
    } else {
      // 실패 원인 확인을 위해 staging 은 보존한다.
      receipt.staging_path = stageRoot;
      receipt.staging_cleanup_hint = `원인 확인 후 다음 폴더를 수동으로 삭제하세요: ${stageRoot}`;
    }
    receipt.finished_at = new Date().toISOString();
    saveReceipt();
    return {
      ok: false,
      runId,
      receiptPath,
      status: receipt.status,
      error: receipt.error,
      error_code: receipt.error_code,
      staging_path: receipt.staging_path,
    };
  }
}
