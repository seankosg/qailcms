import { supabase } from "@/integrations/supabase/client";
import { assertNoTruncation } from "@/lib/data/assertNoSilentTruncation";
import { todayInDoha } from "@/lib/time/doha";
import type {
  AbdServerFilter,
  AbdServerSort,
  AbdStatusGroup,
  AbdTeam,
} from "@/hooks/useAbdItems";

export interface AbdExportFetchParams {
  team: AbdTeam;
  statusGroup: AbdStatusGroup;
  includeInactive: boolean;
  plot?: "C" | "D" | null;
  q?: string;
  filters?: AbdServerFilter[];
  sort?: AbdServerSort[];
  asOf?: string | null;
}

const CHUNK = 1000;

/**
 * 현재 필터/탭/검색 조건의 전체 행을 서버(abd_items_search)에서 청크 루프로 전량 수집.
 * PostgREST 1,000행 응답 상한을 우회하며, total_count 와 수집 행수를 대조해 잘림을 감시한다.
 */
export async function fetchAllAbdRowsForExport(
  p: AbdExportFetchParams,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Record<string, any>[]> {
  const asOf = (p.asOf ?? "").trim() || todayInDoha();

  const callRpc = async (offset: number) => {
    const { data, error } = await (supabase as any).rpc("abd_items_search", {
      _team: p.team,
      _status_group: p.statusGroup === "all" ? null : p.statusGroup,
      _include_inactive: p.includeInactive,
      _q: p.q && p.q.trim() ? p.q.trim() : null,
      _filters: p.filters ?? [],
      _sort: p.sort ?? [],
      _offset: offset,
      _limit: CHUNK,
      _plot: p.plot ?? null,
      _as_of: asOf,
    });
    if (error) throw new Error(error.message);
    const arr = (data ?? []) as { rows: any; total_count: number | string }[];
    if (arr.length > 0) {
      const rowsVal = (arr[0] as any)?.rows;
      if (Array.isArray(rowsVal) || rowsVal === null || typeof rowsVal !== "object") {
        throw new Error(
          "abd_items_search RPC contract mismatch: expected row-per-record { rows: object, total_count }",
        );
      }
    }
    return arr;
  };

  const first = await callRpc(0);
  const total = Number(first[0]?.total_count ?? 0);
  const collected: Record<string, any>[] = first.map((r) => r.rows as Record<string, any>);
  onProgress?.(collected.length, total);

  if (total > collected.length && first.length === CHUNK) {
    const offsets: number[] = [];
    for (let off = CHUNK; off < total; off += CHUNK) offsets.push(off);
    // 병렬 폭주 방지 — 4개씩 배치 처리.
    for (let i = 0; i < offsets.length; i += 4) {
      const slice = offsets.slice(i, i + 4);
      const batches = await Promise.all(slice.map((off) => callRpc(off)));
      for (const b of batches) for (const r of b) collected.push(r.rows as Record<string, any>);
      onProgress?.(collected.length, total);
    }
  }

  assertNoTruncation("abd_items_search(EXPORT)", collected, total, "ALL");
  return collected;
}