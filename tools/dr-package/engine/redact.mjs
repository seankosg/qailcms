/**
 * 비밀값 마스킹 정본.
 * DB URL 비밀번호, access token, PGPASSWORD 류 문자열을 로그·영수증·manifest 어디에도
 * 원문으로 남기지 않는다.
 */

const TOKEN_PATTERNS = [
  // postgres://user:password@host
  { re: /(postgres(?:ql)?:\/\/[^:/@\s]+:)([^@\s]+)(@)/gi, replace: "$1***$3" },
  // key=value 형태 (password, token, secret, apikey, service_role)
  {
    re: /\b(pgpassword|password|passwd|pwd|token|access_token|apikey|api_key|secret|service_role_key)\b(\s*[:=]\s*)("?)([^\s"',;]+)\3/gi,
    replace: "$1$2$3***$3",
  },
  // JWT
  { re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, replace: "***" },
  // supabase publishable/secret key prefixes
  { re: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, replace: "***" },
];

/** 추가로 마스킹할 리터럴 비밀값 목록을 받아 문자열을 마스킹한다. */
export function redact(input, extraSecrets = []) {
  let out = typeof input === "string" ? input : String(input ?? "");
  for (const s of extraSecrets) {
    if (typeof s === "string" && s.length >= 4) {
      out = out.split(s).join("***");
    }
  }
  for (const { re, replace } of TOKEN_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

/** 객체 전체를 재귀 마스킹(문자열 값만). */
export function redactDeep(value, extraSecrets = []) {
  if (typeof value === "string") return redact(value, extraSecrets);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, extraSecrets));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, extraSecrets);
    return out;
  }
  return value;
}

/** 접속 문자열에서 비밀번호를 제거한 표시용 문자열. */
export function safeConnDisplay(url) {
  try {
    const u = new URL(url);
    u.password = "";
    return u.toString().replace("//" + u.username + ":@", "//" + u.username + ":***@");
  } catch {
    return redact(url);
  }
}
