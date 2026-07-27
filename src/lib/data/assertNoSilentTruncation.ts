/**
 * 조용한 잘림(silent truncation) 감시 유틸.
 *
 * mode:
 *  - "ALL"  : rows.length === total_count 를 강제 (불일치 시 dev throw / prod console.error)
 *  - "page" : diagnostics 리턴 — throw 없이 잘림 위험 여부만 기록 (호출측이 렌더)
 *
 * 하위 호환: mode 미지정이면 기존 동작(rows<total 이면 경보) 유지.
 */
export interface TruncationDiagnostics {
  truncationRisk: boolean;
  notes: string[];
}

export function assertNoTruncation(
  source: string,
  rows: unknown[],
  total?: number | null,
  mode?: "ALL" | "page",
  opts?: { pageSize?: number; mainCount?: number },
): TruncationDiagnostics {
  const diag: TruncationDiagnostics = { truncationRisk: false, notes: [] };
  if (typeof total !== "number") return diag;

  if (mode === "ALL") {
    if (rows.length !== total) {
      const msg = `[silent-truncation] ${source}: ALL 모드 rows=${rows.length} total=${total} 불일치`;
      if (import.meta.env.DEV) throw new Error(msg);
      console.error(msg);
      diag.truncationRisk = true;
      diag.notes.push(msg);
    }
    return diag;
  }

  if (mode === "page") {
    const pageSize = opts?.pageSize;
    const mainCount = opts?.mainCount;
    if (pageSize != null && mainCount != null && mainCount > pageSize) {
      diag.truncationRisk = true;
      diag.notes.push(`main_count(${mainCount}) > pageSize(${pageSize})`);
    }
    // 페이지 모드는 rows/total 정합을 진단만
    if (rows.length > total) {
      diag.truncationRisk = true;
      diag.notes.push(`rows(${rows.length}) > total(${total})`);
    }
    if (diag.truncationRisk) console.warn(`[truncation-diag] ${source}`, diag.notes);
    return diag;
  }

  // legacy
  if (rows.length >= total) return diag;
  const msg = `[silent-truncation] ${source}: ${rows.length}/${total} — 다음 페이지 미요청`;
  if (import.meta.env.DEV) throw new Error(msg);
  console.error(msg);
  diag.truncationRisk = true;
  diag.notes.push(msg);
  return diag;
}