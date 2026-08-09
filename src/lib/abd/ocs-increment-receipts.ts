// 검증 영수증 정규화 — 서버 함수와 테스트가 공유하는 순수 로직.
export const RECEIPT_PAGE = 1000;
export const RECEIPT_MAX_ROWS = 20000;

export type RawVerifyReceipt = {
  package_id: string;
  bucket: string;
  path: string;
  expected_sha256: string;
  expected_byte_size: number | null;
  ok: boolean;
  error?: string | null;
};

/** 최신순 입력을 bucket::path 기준으로 중복 제거한다 (path 단독 금지). */
export function dedupeLatestReceipts<T extends { bucket: string; path: string }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.bucket}::${r.path}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  return [...latest.values()];
}

/** 조회가 상한에 도달했는지 (조용한 잘림 감시) */
export function isTruncated(fetched: number, maxRows: number = RECEIPT_MAX_ROWS): boolean {
  return fetched >= maxRows;
}
