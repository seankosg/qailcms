/**
 * DR 패키지 내부 경로 규칙 정본.
 * Storage 원본 상대경로를 보존하되, 절대경로/`..`/역슬래시/NUL/드라이브 문자/
 * 비정규 세그먼트를 차단하고 대소문자 충돌을 탐지한다.
 */

export function checkRelativePath(rawPath) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    return { ok: false, code: "PATH_INVALID", reason: "경로가 비어 있습니다." };
  }
  const p = rawPath;
  if (p !== p.trim()) return { ok: false, code: "PATH_INVALID", reason: "경로 앞뒤 공백은 허용하지 않습니다." };
  if (p.includes("\\")) return { ok: false, code: "PATH_BACKSLASH", reason: "역슬래시 경로는 허용하지 않습니다." };
  if (p.includes("\0")) return { ok: false, code: "PATH_INVALID", reason: "허용되지 않는 문자가 있습니다." };
  if (p.startsWith("/") || p.startsWith("//") || /^[A-Za-z]:/.test(p)) {
    return { ok: false, code: "PATH_ABSOLUTE", reason: "절대경로는 허용하지 않습니다." };
  }
  for (const seg of p.split("/")) {
    if (seg === "..") return { ok: false, code: "PATH_TRAVERSAL", reason: "상위 폴더 이동(..)은 허용하지 않습니다." };
    if (seg === "" || seg === ".") return { ok: false, code: "PATH_INVALID", reason: "정규형이 아닌 경로입니다." };
  }
  return { ok: true, path: p };
}

/**
 * 패키지 전체 경로 집합의 중복·대소문자 충돌 검사.
 * Windows/macOS 기본 파일시스템은 대소문자를 구분하지 않으므로 둘 다 실패로 본다.
 */
export function findPathCollisions(paths) {
  const seen = new Map();
  const duplicates = [];
  const caseCollisions = [];
  for (const p of paths) {
    if (seen.has(p)) {
      duplicates.push(p);
      continue;
    }
    const lower = p.toLowerCase();
    const prev = [...seen.keys()].find((k) => k.toLowerCase() === lower);
    if (prev) caseCollisions.push([prev, p]);
    seen.set(p, true);
  }
  return { duplicates, caseCollisions, ok: duplicates.length === 0 && caseCollisions.length === 0 };
}
