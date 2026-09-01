/**
 * Lovable Cloud 논리 DR 내보내기 — 순수 계약(네트워크·DB 접근 없음).
 *
 * 서버 API(src/routes/api/public/dr-export/*)와 로컬 생성기가 같은 규칙을 쓰도록
 * 경로·버킷·토큰·상태 판정 정본을 여기 한 곳에만 둔다.
 */

/** DR 패키지 포맷 버전. 로컬 생성기·브라우저 검증이 동일 값을 요구한다. */
export const DR_PACKAGE_SCHEMA_VERSION = "qail-logical-dr-v1" as const;

/** 논리 DR 대상 업무 버킷 7개 (HP1 확정). 이 목록 외 버킷은 어떤 경로로도 접근 불가. */
export const DR_WORK_BUCKETS = [
  "abd-ocs-source-files",
  "abd-ocs-attachments",
  "spl-documents",
  "dmr-uploads",
  "spl-ocs-source-files",
  "abd-ocs-imports",
  "spl-ocs-attachments",
] as const;

export type DrWorkBucket = (typeof DR_WORK_BUCKETS)[number];

/** DR 패키지에 절대 포함하지 않는 버킷(Snapshot 폴더만 별도 경로로 읽는다). */
export const DR_EXCLUDED_BUCKETS = ["db-backups"] as const;

/** 기본 토큰 유효시간(시간). */
export const DR_TOKEN_TTL_HOURS = 6;

/** 목록 API 페이지 크기 상한. */
export const DR_LIST_PAGE_MAX = 200;

export type DrExportStatus =
  | "issued"
  | "downloading"
  | "completed"
  | "expired"
  | "revoked"
  | "failed";

/** 토큰으로 계속 읽기가 허용되는 상태. */
export const DR_ACTIVE_STATUSES: DrExportStatus[] = ["issued", "downloading"];

export function isBucketAllowed(bucket: unknown): bucket is DrWorkBucket {
  return typeof bucket === "string" && (DR_WORK_BUCKETS as readonly string[]).includes(bucket);
}

/** 암호학적으로 안전한 일회용 토큰(base64url, 32byte). */
export function generateDrToken(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 토큰의 SHA-256 hex. DB 에는 이 값만 저장한다. */
export async function hashDrToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type DrRunGateInput = {
  status: string | null | undefined;
  expires_at: string | null | undefined;
};

export type DrGate = { ok: true } | { ok: false; code: string; message: string };

/** run 이 지금 읽기에 사용할 수 있는 상태인지 판정한다. */
export function checkRunUsable(run: DrRunGateInput | null | undefined, now = new Date()): DrGate {
  if (!run) return { ok: false, code: "TOKEN_UNKNOWN", message: "유효하지 않은 토큰입니다." };
  const status = String(run.status ?? "");
  if (!DR_ACTIVE_STATUSES.includes(status as DrExportStatus)) {
    return { ok: false, code: `TOKEN_${status.toUpperCase() || "INVALID"}`, message: "사용할 수 없는 토큰입니다." };
  }
  const exp = run.expires_at ? Date.parse(run.expires_at) : NaN;
  if (!Number.isFinite(exp) || exp <= now.getTime()) {
    return { ok: false, code: "TOKEN_EXPIRED", message: "토큰 유효시간이 지났습니다." };
  }
  return { ok: true };
}

export type PathCheck = { ok: true; path: string } | { ok: false; code: string; message: string };

/**
 * Storage object 상대경로 정규화·검증.
 * `..`, `.`, 빈 세그먼트, 절대경로, 드라이브 문자, 역슬래시, NUL 을 모두 차단한다.
 */
export function normalizeObjectPath(raw: unknown): PathCheck {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, code: "PATH_INVALID", message: "경로가 비어 있습니다." };
  }
  if (raw !== raw.trim()) return { ok: false, code: "PATH_INVALID", message: "경로 앞뒤 공백은 허용하지 않습니다." };
  if (raw.includes("\\")) return { ok: false, code: "PATH_INVALID", message: "역슬래시 경로는 허용하지 않습니다." };
  if (raw.includes("\0")) return { ok: false, code: "PATH_INVALID", message: "허용되지 않는 문자가 있습니다." };
  if (raw.startsWith("/") || raw.startsWith("//") || /^[A-Za-z]:/.test(raw)) {
    return { ok: false, code: "PATH_ABSOLUTE", message: "절대경로는 허용하지 않습니다." };
  }
  const segments = raw.split("/");
  for (const seg of segments) {
    if (seg === "..") return { ok: false, code: "PATH_TRAVERSAL", message: "상위 폴더 이동(..)은 허용하지 않습니다." };
    if (seg === "." || seg === "") return { ok: false, code: "PATH_INVALID", message: "정규형이 아닌 경로입니다." };
  }
  return { ok: true, path: segments.join("/") };
}

/** 대소문자만 다른 경로 충돌 탐지(로컬 파일시스템 보호). */
export function findCaseCollisions(paths: string[]): string[] {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const p of paths) {
    const key = p.toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined && prev !== p) collisions.push(p);
    else seen.set(key, p);
  }
  return collisions;
}

export type ManifestPartLike = { path: string };

/**
 * manifest 가 선언한 part 경로만 허용한다.
 * 선언 목록에 없는 경로는 Snapshot 폴더 안이어도 차단한다.
 */
export function isDeclaredPart(manifestParts: ManifestPartLike[], candidate: string): boolean {
  return manifestParts.some((p) => p.path === candidate);
}

/** manifest 에서 part 경로 전체를 평탄화한다. */
export function collectManifestParts(manifest: unknown): { path: string; sha256: string; size_bytes: number }[] {
  const tables = (manifest as any)?.tables;
  if (!Array.isArray(tables)) return [];
  const out: { path: string; sha256: string; size_bytes: number }[] = [];
  for (const t of tables) {
    for (const p of Array.isArray(t?.parts) ? t.parts : []) {
      if (typeof p?.path === "string") {
        out.push({ path: p.path, sha256: String(p.sha256 ?? ""), size_bytes: Number(p.size_bytes ?? 0) });
      }
    }
  }
  return out;
}

/** 오류 문자열에서 토큰·키·비밀값을 마스킹한다. */
export function maskDrSecret(message: unknown, secrets: string[] = []): string {
  let text = typeof message === "string" ? message : String((message as any)?.message ?? message ?? "");
  for (const s of secrets) {
    if (typeof s === "string" && s.length >= 8) text = text.split(s).join("[REDACTED]");
  }
  return text
    .replace(/\b(Bearer)\s+[A-Za-z0-9._\-]{8,}/gi, "$1 [REDACTED]")
    .replace(
      /\b(token|access_token|apikey|api_key|secret|password|service_role_key)\b(\s*[:=]\s*)("?)([^\s"',;]+)\3/gi,
      "$1$2[REDACTED]",
    );
}
