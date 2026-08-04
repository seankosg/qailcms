import { supabase } from "@/integrations/supabase/client";

/**
 * 임포트 범위(스코프) 판정을 서버(rcl_can(..., 'import'))로 위임한다.
 *
 * 클라이언트는 "행 전체 페이로드"가 아니라 매칭 키 + 담당자/팀 값만 보낸다.
 * upsert 페이로드/타임아웃 경로는 기존과 동일하게 유지된다.
 *
 * 서버 규칙(public.rcl_import_filter):
 *  - 기존 행: DB 에 저장된 현재 담당자/팀으로 판정 (파일에 남의 행을 자기 이름으로 적어도 못 가져감)
 *  - 신규 행: 파일 값으로 판정
 */
export interface RclDeniedRow {
  key: Record<string, string | null>;
  scope: string;
}

export interface RclImportFilterResult {
  role: string;
  total: number;
  allowedKeys: Set<string>;
  denied: RclDeniedRow[];
}

const SEP = "\u0001";

export function rclKeyOf(matchCols: string[], row: Record<string, unknown>): string {
  return matchCols.map((c) => String(row[c] ?? "")).join(SEP);
}

export async function rclImportFilter(
  moduleKey: string,
  matchCols: string[],
  rows: Array<Record<string, unknown>>,
  chunkSize = 1000,
): Promise<RclImportFilterResult> {
  const allowedKeys = new Set<string>();
  const denied: RclDeniedRow[] = [];
  let role = "";
  let total = 0;

  // 청크는 순차가 아니라 소규모 병렬로 보낸다. 1,000행당 ~0.6s 이므로
  // 39k행 마스터 파일이 순차라면 ~23s, 동시 4개면 ~6s 로 줄어든다.
  // 판정 자체는 여전히 서버 단독(rcl_can(..., 'import'))이다.
  const chunks: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < rows.length; i += chunkSize) chunks.push(rows.slice(i, i + chunkSize));

  const CONCURRENCY = 4;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((chunk) =>
        (supabase as any).rpc("rcl_import_filter", {
          _module: moduleKey,
          _match_cols: matchCols,
          _rows: chunk,
        }),
      ),
    );
    for (const { data, error } of results) {
      // 조용한 통과 금지: 판정 실패는 즉시 예외로 표면화한다.
      if (error) throw new Error(`권한 판정 실패(${moduleKey}): ${error.message}`);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`권한 판정 응답 형식 오류(${moduleKey})`);
      }
      role = String(data.role ?? role);
      total += Number(data.total ?? 0);
      for (const k of (data.allowed ?? []) as Array<Record<string, string | null>>) {
        allowedKeys.add(rclKeyOf(matchCols, k));
      }
      for (const d of (data.denied ?? []) as RclDeniedRow[]) denied.push(d);
    }
  }

  if (total !== rows.length) {
    throw new Error(`권한 판정 행수 불일치: 요청 ${rows.length} vs 판정 ${total}`);
  }

  return { role, total, allowedKeys, denied };
}
