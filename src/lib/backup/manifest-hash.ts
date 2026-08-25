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
 *
 * manifest 계약은 **단순 상대경로만** 허용한다.
 * - `..` 세그먼트가 하나라도 있으면 무조건 차단(최종 결과가 폴더 안이어도 차단)
 * - `.` 세그먼트·빈 세그먼트(`a//b`)·후행 슬래시 등 비정규형도 차단
 * - 절대경로 / 드라이브 문자 / UNC / 역슬래시 / NUL 차단
 * - percent-encoding 은 디코드하지 않고 원문 그대로 Storage 호출에 사용한다.
 *
 * `folder` 는 `snapshots/<id>/` 형태여야 한다.
 */
export function normalizePartPath(folder: string, rawPath: unknown): PartPathCheck {
  if (typeof rawPath !== "string" || rawPath === "" || rawPath.trim() === "") {
    return { ok: false, code: "PART_PATH_INVALID", reason: "경로가 비어 있습니다." };
  }
  const p = rawPath;
  if (p !== p.trim()) {
    return { ok: false, code: "PART_PATH_INVALID", reason: "경로 앞뒤 공백은 허용하지 않습니다." };
  }
  if (p.includes("\\")) {
    return { ok: false, code: "PART_PATH_INVALID", reason: "역슬래시 경로는 허용하지 않습니다." };
  }
  if (p.includes("\0")) {
    return { ok: false, code: "PART_PATH_INVALID", reason: "허용되지 않는 문자가 있습니다." };
  }
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.startsWith("//")) {
    return { ok: false, code: "PART_PATH_ABSOLUTE", reason: "절대경로는 허용하지 않습니다." };
  }

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      return { ok: false, code: "PART_PATH_TRAVERSAL", reason: "상위 폴더 이동(..)은 허용하지 않습니다." };
    }
    if (seg === "." || seg === "") {
      return { ok: false, code: "PART_PATH_INVALID", reason: "정규형이 아닌 경로입니다." };
    }
  }

  const base = folder.endsWith("/") ? folder : `${folder}/`;
  const baseSegments = base.split("/").filter((s) => s !== "");
  if (baseSegments.length === 0) {
    return { ok: false, code: "PART_PATH_INVALID", reason: "백업 폴더 경로가 올바르지 않습니다." };
  }
  return { ok: true, fullPath: `${baseSegments.join("/")}/${segments.join("/")}` };
}

