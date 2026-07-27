/**
 * 조용한 잘림(silent truncation) 감시 유틸.
 *
 * total_count 를 함께 제공하는 목록 조회에서, 클라이언트가 실제로 수집한 rows
 * 수가 total 보다 작으면서도 "다음 페이지 요청" 상태가 아니면 잘림으로 간주.
 *
 * - dev  : 즉시 throw — 개발 중 인지 강제.
 * - prod : console.error — 사용자 화면 붕괴 방지, 관측만.
 */
export function assertNoTruncation(
  source: string,
  rows: unknown[],
  total?: number | null,
): void {
  if (typeof total !== "number") return;
  if (rows.length >= total) return;
  const msg = `[silent-truncation] ${source}: ${rows.length}/${total} — 다음 페이지 미요청`;
  if (import.meta.env.DEV) throw new Error(msg);
  // prod
  console.error(msg);
}