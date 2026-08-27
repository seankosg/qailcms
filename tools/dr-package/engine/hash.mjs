import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** 파일 SHA-256 hex (스트리밍, 메모리 상주 없음). */
export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const rs = createReadStream(filePath);
    rs.on("error", reject);
    rs.on("data", (c) => hash.update(c));
    rs.on("end", resolve);
  });
  return hash.digest("hex");
}

/** 바이트열 SHA-256 hex. */
export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 문자열 SHA-256 hex (UTF-8). */
export function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, "utf8"));
}
