import { rclImportFilter, rclKeyOf, type RclDeniedRow } from "@/lib/import/rcl-import-filter";
import type { RclModule } from "@/hooks/useRclCan";

/**
 * 임포트 스코프 필터 공통 배관 (WRT · SPL).
 *
 * 판정은 전적으로 서버 `rcl_import_filter`(→ `rcl_can(..., 'import')`) 가 한다.
 * 클라이언트는 매칭 키 + 담당자/팀 값만 만들어 보내고, 결과로 payload 행을 거른다.
 */
export interface ImportScopeOutcome<T> {
  role: string;
  allowedRows: T[];
  denied: RclDeniedRow[];
  deniedKeys: string[];
  total: number;
}

export async function applyImportScope<T extends { item: Record<string, string | null> }>(
  moduleKey: RclModule,
  keyCol: string,
  ownerCols: string[],
  rows: T[],
  keyOf: (row: T) => string,
): Promise<ImportScopeOutcome<T>> {
  const matchCols = [keyCol];
  const flat = rows.map((r) => {
    const o: Record<string, unknown> = { [keyCol]: keyOf(r) };
    for (const c of ownerCols) o[c] = r.item[c] ?? null;
    return o;
  });
  const res = await rclImportFilter(moduleKey, matchCols, flat);
  const allowedRows: T[] = [];
  const deniedKeys: string[] = [];
  for (const r of rows) {
    const k = rclKeyOf(matchCols, { [keyCol]: keyOf(r) });
    if (res.allowedKeys.has(k)) allowedRows.push(r);
    else deniedKeys.push(keyOf(r));
  }
  return { role: res.role, allowedRows, denied: res.denied, deniedKeys, total: res.total };
}