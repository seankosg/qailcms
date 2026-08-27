/**
 * Storage 수집 엔진 (Windows/macOS 공용).
 * - limit/offset 페이지네이션 + 하위 폴더 재귀 탐색
 * - 파일별 bucket/path/bytes/sha256 기록
 * - 경로 이탈·역슬래시·NUL·드라이브 문자 차단
 * - 다운로드 실패가 1건이라도 있으면 실패
 */
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { checkRelativePath } from "./paths.mjs";
import { assertBucketScope } from "./buckets.mjs";

const PAGE_LIMIT = 100;

/**
 * 버킷 하나를 재귀 탐색해 파일 목록을 만든다.
 * @param {{list:(bucket:string,prefix:string,opts:{limit:number,offset:number})=>Promise<Array>}} client
 */
export async function listBucketFiles(client, bucket, prefix = "", acc = []) {
  let offset = 0;
  for (;;) {
    const entries = await client.list(bucket, prefix, { limit: PAGE_LIMIT, offset });
    if (!Array.isArray(entries) || entries.length === 0) break;
    for (const entry of entries) {
      const name = entry?.name;
      if (!name || name === ".emptyFolderPlaceholder") continue;
      const full = prefix ? `${prefix}/${name}` : name;
      const isFolder = entry.id == null && entry.metadata == null;
      if (isFolder) {
        await listBucketFiles(client, bucket, full, acc);
      } else {
        acc.push({
          bucket,
          path: full,
          bytes: Number(entry.metadata?.size ?? 0),
        });
      }
    }
    if (entries.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return acc;
}

/** 파일 경로 안전성 검사 — 위반 1건이면 전체 실패. */
export function validateStoragePaths(files) {
  const errors = [];
  for (const f of files) {
    const check = checkRelativePath(f.path);
    if (!check.ok) errors.push({ bucket: f.bucket, path: f.path, code: check.code, reason: check.reason });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 파일을 로컬 작업 폴더로 내려받고 실제 byte/sha256 을 측정한다.
 * @param client {{download:(bucket:string,path:string)=>Promise<AsyncIterable<Uint8Array>|Uint8Array>}}
 */
export async function downloadFile(client, file, destRoot) {
  const dest = path.join(destRoot, file.bucket, ...file.path.split("/"));
  mkdirSync(path.dirname(dest), { recursive: true });
  const data = await client.download(file.bucket, file.path);
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(dest);
    ws.on("error", reject);
    ws.on("finish", resolve);
    (async () => {
      if (data && typeof data[Symbol.asyncIterator] === "function") {
        for await (const chunk of data) {
          const buf = Buffer.from(chunk);
          hash.update(buf);
          ws.write(buf);
        }
      } else {
        const buf = Buffer.from(data);
        hash.update(buf);
        ws.write(buf);
      }
      ws.end();
    })().catch(reject);
  });
  const actualBytes = statSync(dest).size;
  return { ...file, localPath: dest, actualBytes, sha256: hash.digest("hex") };
}

/**
 * 대상 버킷 전체 수집.
 * @returns {{files:Array, totalBytes:number, perBucket:Object}}
 */
export async function collectStorage(client, buckets, destRoot, onProgress = () => {}) {
  assertBucketScope(buckets);
  const listed = [];
  for (const bucket of buckets) {
    const files = await listBucketFiles(client, bucket);
    listed.push(...files);
    onProgress({ phase: "list", bucket, count: files.length });
  }
  const pathCheck = validateStoragePaths(listed);
  if (!pathCheck.ok) {
    const first = pathCheck.errors[0];
    throw new Error(`Storage 경로 규칙 위반 ${pathCheck.errors.length}건 (예: ${first.bucket}/${first.path} — ${first.reason})`);
  }

  const out = [];
  const failures = [];
  let done = 0;
  for (const file of listed) {
    try {
      const res = await downloadFile(client, file, destRoot);
      if (file.bytes && res.actualBytes !== file.bytes) {
        failures.push({ ...file, reason: `크기 불일치: 목록 ${file.bytes} vs 실제 ${res.actualBytes}` });
      } else {
        out.push({ ...res, bytes: res.actualBytes });
      }
    } catch (err) {
      failures.push({ ...file, reason: err?.message ?? String(err) });
    }
    done += 1;
    onProgress({ phase: "download", done, total: listed.length, bucket: file.bucket, path: file.path });
  }
  if (failures.length > 0) {
    throw new Error(
      `Storage 다운로드 실패 ${failures.length}건 (예: ${failures[0].bucket}/${failures[0].path} — ${failures[0].reason})`,
    );
  }
  if (out.length !== listed.length) {
    throw new Error(`Storage 파일 수 불일치: 목록 ${listed.length} vs 수집 ${out.length}`);
  }

  const perBucket = {};
  let totalBytes = 0;
  for (const f of out) {
    perBucket[f.bucket] ??= { files: 0, bytes: 0 };
    perBucket[f.bucket].files += 1;
    perBucket[f.bucket].bytes += f.bytes;
    totalBytes += f.bytes;
  }
  return { files: out, totalBytes, perBucket };
}
