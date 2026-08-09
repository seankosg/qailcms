// ABD OCS 증분 Import — 신규 Storage object 서버 실측 검증 (배치 계약 · 순수 로직).
// 서버 함수 모듈을 얇게 유지하기 위해 상수·정규화·동시성 실행기를 여기에 둔다.

/** 한 요청이 처리하는 최대 object 수 (667개 → 14~27 요청). */
export const VERIFY_BATCH_MAX = 50;
/** 배치 내부 동시 다운로드 상한. 절대 Promise.all 로 전량 처리하지 않는다. */
export const VERIFY_CONCURRENCY = 5;

export type VerifyItem = {
  bucket: string;
  path: string;
  expected_sha256: string;
  expected_byte_size: number;
};

export type VerifyOutcome = {
  bucket: string;
  path: string;
  ok: boolean;
  actual_sha256: string | null;
  actual_byte_size: number | null;
  error: string | null;
};

export const verifyItemList = (v: unknown): VerifyItem[] =>
  Array.isArray(v)
    ? v.map((x) => {
        const o = (x ?? {}) as Record<string, unknown>;
        const item: VerifyItem = {
          bucket: String(o["bucket"] ?? ""),
          path: String(o["path"] ?? ""),
          expected_sha256: String(o["expected_sha256"] ?? "").toLowerCase(),
          expected_byte_size: Number(o["expected_byte_size"] ?? 0),
        };
        if (!item.bucket || !item.path || !item.expected_sha256) {
          throw new Error("verify item 필드 누락: bucket/path/expected_sha256");
        }
        if (!Number.isFinite(item.expected_byte_size) || item.expected_byte_size <= 0) {
          throw new Error(`verify item 필드 누락: expected_byte_size (${item.path})`);
        }
        return item;
      })
    : [];

/** 동시성 제한 워커 풀 — 입력 순서를 보존한 결과 배열을 반환한다. */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  );
  return out;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
