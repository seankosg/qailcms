/**
 * 백업 매니페스트 해시·경로 규칙의 **단일 정본(순수 함수)**.
 *
 * 스냅샷 생성(backup-core.server.ts)과 복원 사전검증(restore-preflight.server.ts)이
 * 반드시 같은 코드를 사용해야 하므로 산식을 여기 한 곳에만 둔다. 복제 금지.
 */

/** 바이트열의 SHA-256 hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 계층 해시 산식 정본.
 * - 테이블 해시 = sha256( 각 파트 sha256 hex 를 순서대로 이어붙인 문자열 )
 * - 전체 해시   = sha256( 각 테이블 sha256 hex 를 매니페스트 순서대로 이어붙인 문자열 )
 */
export async function combineHashes(hexList: string[]): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(hexList.join("")));
}

export type PartPathCheck = { ok: true; fullPath: string } | { ok: false; code: string; reason: string };

/**
 * 스냅샷 파트 경로 정규화·검증.
 * 절대경로 / 드라이브 / UNC / `..` / 폴더 이탈을 모두 차단한다.
 * `folder` 는 `snapshots/<id>/` 형태(마지막 슬래시 포함)여야 한다.
 */
export function normalizePartPath(folder: string, rawPath: unknown): PartPathCheck {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return { ok: false, code: "PART_PATH_INVALID", reason: "경로가 비어 있습니다." };
  }
  const p = rawPath.trim();
  if (p.includes("\\")) {
    return { ok: false, code: "PART_PATH_INVALID", reason: "역슬래시 경로는 허용하지 않습니다." };
  }
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.startsWith("//")) {
    return { ok: false, code: "PART_PATH_ABSOLUTE", reason: "절대경로는 허용하지 않습니다." };
  }
  if (p.includes("\0")) {
    return { ok: false, code: "PART_PATH_INVALID", reason: "허용되지 않는 문자가 있습니다." };
  }

  const base = folder.endsWith("/") ? folder : `${folder}/`;
  const segments: string[] = [];
  for (const seg of `${base}${p}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length === 0) {
        return { ok: false, code: "PART_PATH_ESCAPES_FOLDER", reason: "상위 폴더로 이동할 수 없습니다." };
      }
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  const normalized = segments.join("/");
  const baseSegments = base.split("/").filter((s) => s !== "" && s !== ".");
  const basePrefix = `${baseSegments.join("/")}/`;
  if (!normalized.startsWith(basePrefix) || normalized.length <= basePrefix.length) {
    return {
      ok: false,
      code: "PART_PATH_ESCAPES_FOLDER",
      reason: "스냅샷 폴더 밖 경로입니다.",
    };
  }
  return { ok: true, fullPath: normalized };
}
