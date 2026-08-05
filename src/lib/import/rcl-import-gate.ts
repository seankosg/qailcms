/**
 * 서버측 임포트 스코프 최종 관문.
 *
 * `wrt_hdec_apply` · `spl_hdec_apply` 는 SECURITY DEFINER 라 RLS 를 우회한다.
 * 따라서 클라이언트가 `rcl_import_filter` 로 걸러낸 결과를 그대로 믿지 않고,
 * 서버 함수 핸들러에서 같은 RPC 로 다시 판정한다.
 *  - 요청 행수 ≠ 판정 행수 → 예외
 *  - denied 키가 하나라도 있으면 → 예외 (부분 반영 금지)
 *  - 클라이언트가 allowed_keys 를 보냈으면 서버 allowed 집합과 대조
 */
export interface ImportGateRow {
  item: Record<string, string | null>;
}

export async function assertImportScope<T extends ImportGateRow>(
  supa: any,
  moduleKey: "WRT" | "SPL",
  keyCol: string,
  ownerCols: string[],
  rows: T[],
  keyOf: (row: T) => string,
  clientAllowedKeys?: string[] | null,
): Promise<{ role: string; allowed: Set<string> }> {
  const allowed = new Set<string>();
  let role = "";
  let total = 0;

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const payload = slice.map((r) => {
      const o: Record<string, unknown> = { [keyCol]: keyOf(r) };
      for (const c of ownerCols) o[c] = r.item[c] ?? null;
      return o;
    });
    const { data, error } = await supa.rpc("rcl_import_filter", {
      _module: moduleKey,
      _match_cols: [keyCol],
      _rows: payload,
    });
    if (error) throw new Error(`임포트 권한 판정 실패(${moduleKey}): ${error.message}`);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`임포트 권한 판정 응답 형식 오류(${moduleKey})`);
    }
    role = String((data as any).role ?? role);
    total += Number((data as any).total ?? 0);
    for (const k of ((data as any).allowed ?? []) as Array<Record<string, string | null>>) {
      allowed.add(String(k[keyCol] ?? ""));
    }
  }

  if (total !== rows.length) {
    throw new Error(`임포트 권한 판정 행수 불일치(${moduleKey}): 요청 ${rows.length} vs 판정 ${total}`);
  }

  const denied = rows.map(keyOf).filter((k) => !allowed.has(k));
  if (denied.length > 0) {
    throw new Error(
      `권한 범위 밖 행이 포함되었습니다(${moduleKey}): ${denied.length}건 — ${denied.slice(0, 20).join(", ")}${denied.length > 20 ? " …" : ""}`,
    );
  }

  if (clientAllowedKeys && clientAllowedKeys.length > 0) {
    const extra = clientAllowedKeys.filter((k) => !allowed.has(k));
    if (extra.length > 0) {
      throw new Error(
        `클라이언트 allowed 키가 서버 판정과 불일치(${moduleKey}): ${extra.length}건 — ${extra.slice(0, 20).join(", ")}`,
      );
    }
  }

  return { role, allowed };
}
