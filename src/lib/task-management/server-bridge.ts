/**
 * TM Raw Data — TanStack Table 상태 ↔ tm_items_search RPC 페이로드 브리지.
 *
 * C1-a: 페이지 파일에 흩어져 있던 필터/정렬 어댑팅을 한곳으로 모아 후속 스왑에서
 * TanStack Table 의 client-side filter/sort 를 서버 파라미터로 곧바로 넘길 수
 * 있게 한다. UI 는 완전히 동일하게 유지되며, 이 파일은 오직 shape 변환만 담당한다.
 *
 * 서버 화이트리스트/연산자 진실 소스: supabase/migrations/20260727201247_*.sql
 * (tm_items_search, tm_items_search_ids, tm_items_facets).
 */

import type {
  ColumnFiltersState,
  SortingState,
} from "@tanstack/react-table";
import type { ServerFilter } from "@/hooks/useServerSearchItems";
import { EMPTY_TOKEN } from "@/hooks/useServerSearchItems";

// ---------------------------------------------------------------------------
// 서버가 처리할 수 없는 컬럼(순수 클라이언트 파생) — 서버 필터/정렬에서 제외.
// ---------------------------------------------------------------------------

/**
 * 클라이언트 계산 컬럼 — as_of/thresholds 의존이라 서버 화이트리스트 미등재.
 * 이들의 필터/정렬은 페이지 스코프에서만 유지된다 (BACKLOG #10 참조).
 */
export const CLIENT_ONLY_FILTER_COLUMNS = new Set<string>([
  "stage_progress",
  "today_actual",
  "today_gap",
  "expected_progress_today",
  "progress_variance",
]);

export const CLIENT_ONLY_SORT_COLUMNS = new Set<string>([
  "today_actual",
  "today_gap",
  "expected_progress_today",
  "progress_variance",
  "stage_progress",
]);

// ---------------------------------------------------------------------------
// 위임(부재중 인수인계) — UI 컬럼 id → 서버 판정 컬럼 별칭.
// 표시 라벨은 그대로 "HDEC PIC" 이지만, 필터/정렬 기준은 유효 담당자다.
// ---------------------------------------------------------------------------
export const SERVER_COLUMN_ALIAS: Record<string, string> = {
  hdec_pic_name: "effective_pic",
};

export function toServerColumn(id: string): string {
  return SERVER_COLUMN_ALIAS[id] ?? id;
}

// ---------------------------------------------------------------------------
// ColumnFilter value → ServerFilter (op/value)
// ---------------------------------------------------------------------------

type MultiValue = string[];
type TextValue = { text?: string; emptyOnly?: boolean; notEmptyOnly?: boolean };
type DateValue = { from?: string; to?: string; emptyOnly?: boolean; notEmptyOnly?: boolean };
type NumValue = { min?: number; max?: number; emptyOnly?: boolean; notEmptyOnly?: boolean };

function isMulti(v: unknown): v is MultiValue {
  return Array.isArray(v);
}

function toServerFilter(column: string, value: unknown): ServerFilter | null {
  column = toServerColumn(column);
  if (value == null || value === "") return null;

  // multi-select (배열) — EMPTY_TOKEN 확장 처리
  if (isMulti(value)) {
    if (value.length === 0) return null;
    const hasEmpty = value.includes(EMPTY_TOKEN);
    const real = value.filter((v) => v !== EMPTY_TOKEN);
    if (hasEmpty && real.length === 0) return { column, op: "empty" };
    if (hasEmpty) return { column, op: "in_or_empty", value: real };
    return { column, op: "in", value: real };
  }

  if (typeof value === "object") {
    const o = value as TextValue & DateValue & NumValue;

    // 공용 sentinel 우선 처리
    if (o.emptyOnly) return { column, op: "empty" };
    if (o.notEmptyOnly) return { column, op: "not_empty" };

    // 날짜 범위: from/to 는 YYYY-MM-DD 문자열
    const from = "from" in o ? o.from : undefined;
    const to = "to" in o ? o.to : undefined;
    if (from != null || to != null) {
      const val: Record<string, string> = {};
      if (from) val.from = String(from);
      if (to) val.to = String(to);
      if (Object.keys(val).length === 0) return null;
      return { column, op: "date_range", value: val };
    }

    // 숫자 범위: min/max
    const min = "min" in o ? o.min : undefined;
    const max = "max" in o ? o.max : undefined;
    if (min != null || max != null) {
      const val: Record<string, number> = {};
      if (min != null) val.min = Number(min);
      if (max != null) val.max = Number(max);
      if (Object.keys(val).length === 0) return null;
      return { column, op: "num_range", value: val };
    }

    // text 검색
    if (typeof o.text === "string" && o.text.trim() !== "") {
      return { column, op: "text", value: o.text.trim() };
    }

    return null;
  }

  // 원시 문자열/숫자 → text 검색
  const s = String(value).trim();
  if (!s) return null;
  return { column, op: "text", value: s };
}

/**
 * TanStack Table 의 ColumnFiltersState → RPC `_filters` (ServerFilter[]).
 * 클라이언트 전용 컬럼(stage_progress, today_*, progress_variance)은 제외한다.
 * 제외된 필터는 페이지 스코프에서 별도로 재적용되어야 UI 동등성이 유지된다.
 */
export function columnFiltersToServer(
  cf: ColumnFiltersState,
): { server: ServerFilter[]; clientOnly: ColumnFiltersState } {
  const server: ServerFilter[] = [];
  const clientOnly: ColumnFiltersState = [];
  for (const f of cf) {
    if (CLIENT_ONLY_FILTER_COLUMNS.has(f.id)) {
      clientOnly.push(f);
      continue;
    }
    const s = toServerFilter(f.id, f.value);
    if (s) server.push(s);
    else clientOnly.push(f); // 서버가 이해 못 하는 shape 는 클라이언트로 폴백
  }
  return { server, clientOnly };
}

// ---------------------------------------------------------------------------
// SortingState → RPC `_sort`
// ---------------------------------------------------------------------------

export interface ServerSortEntry {
  column: string;
  dir: "asc" | "desc";
}

/**
 * TanStack Table SortingState → RPC `_sort` 배열.
 * 클라이언트 전용 정렬 컬럼은 서버로 넘기지 않는다 (페이지 스코프 정렬 유지).
 */
export function sortingToServer(
  sorting: SortingState,
): { server: ServerSortEntry[]; clientOnly: SortingState } {
  const server: ServerSortEntry[] = [];
  const clientOnly: SortingState = [];
  for (const s of sorting) {
    if (CLIENT_ONLY_SORT_COLUMNS.has(s.id)) {
      clientOnly.push(s);
      continue;
    }
    server.push({ column: toServerColumn(s.id), dir: s.desc ? "desc" : "asc" });
  }
  return { server, clientOnly };
}

// ---------------------------------------------------------------------------
// 전역 검색 정규화
// ---------------------------------------------------------------------------

/** RPC `_q` 는 단일 문자열. 페이지 UI 규약 ", = AND" 는 서버가 처리 못 하므로 그대로 전달하고 서버는 ILIKE %q% 로 매치한다. 다중 토큰 AND 는 클라이언트에서 후처리한다. */
export function normalizeGlobalSearch(q: string): string {
  return q.trim();
}
