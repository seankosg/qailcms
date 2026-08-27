/**
 * ZIP64 스트리밍 생성 + 재개봉 검증.
 * 브라우저·Worker 가 아니라 로컬 Node 프로세스에서만 실행한다(메모리 상주 없음).
 */
import { createWriteStream, statSync } from "node:fs";
import yazl from "yazl";
import yauzl from "yauzl";
import { findPathCollisions } from "./paths.mjs";
import { sha256File } from "./hash.mjs";

/**
 * @param entries {{zipPath:string, localPath?:string, content?:string}[]}
 */
export async function createZip(entries, outZipPath, onProgress = () => {}) {
  const collision = findPathCollisions(entries.map((e) => e.zipPath));
  if (!collision.ok) {
    throw new Error(
      `ZIP 내부 경로 충돌: 중복 ${collision.duplicates.length}건, 대소문자 충돌 ${collision.caseCollisions.length}건`,
    );
  }

  const zip = new yazl.ZipFile();
  let added = 0;
  for (const e of entries) {
    if (typeof e.content === "string") {
      zip.addBuffer(Buffer.from(e.content, "utf8"), e.zipPath, { forceZip64Format: false });
    } else {
      zip.addFile(e.localPath, e.zipPath, { forceZip64Format: false });
    }
    added += 1;
    onProgress({ phase: "zip", done: added, total: entries.length, path: e.zipPath });
  }
  // 4GB 를 넘길 수 있으므로 중앙 디렉터리는 ZIP64 로 강제한다.
  zip.end({ forceZip64Format: true });

  await new Promise((resolve, reject) => {
    const ws = createWriteStream(outZipPath);
    ws.on("error", reject);
    ws.on("close", resolve);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(ws);
  });

  const bytes = statSync(outZipPath).size;
  const sha256 = await sha256File(outZipPath);
  return { path: outZipPath, bytes, sha256, entries: entries.length };
}

/** 완성 ZIP 을 다시 열어 중앙 디렉터리와 필수 파일 존재를 확인한다. */
export function reopenZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const names = [];
      zipfile.on("entry", (entry) => {
        names.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on("error", reject);
      zipfile.on("end", () => resolve({ entryCount: names.length, names }));
      zipfile.readEntry();
    });
  });
}

export async function verifyZip(zipPath, requiredPaths, declaredCount) {
  const { entryCount, names } = await reopenZip(zipPath);
  const missing = requiredPaths.filter((p) => !names.includes(p));
  if (missing.length > 0) return { ok: false, reason: `ZIP 필수 파일 누락: ${missing.join(", ")}`, entryCount };
  if (typeof declaredCount === "number" && entryCount !== declaredCount) {
    return { ok: false, reason: `manifest 선언 파일 수 ${declaredCount} vs ZIP 실제 ${entryCount}`, entryCount };
  }
  return { ok: true, entryCount, names };
}
