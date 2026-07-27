import {
  useServerSearchItems,
  EMPTY_TOKEN,
  type ServerFilter,
  type PageSizeMode,
} from "./useServerSearchItems";

/**
 * TM 도메인 어댑터 — useServerSearchItems 위에 TM 필터/RPC 바인딩만 얹은 얇은 wrapper.
 *
 * facets 축은 승인된 11축(필수 8 + 파생 3) 고정.
 */

export const TM_FACET_AXES = [
  "discipline",
  "plot",
  "team",
  "risk",
  "status_manual",
  "milestone",
  "hdec_pic_name",
  "hdec_eng_name",
  "plan_overdue",
  "actual_overdue",
  "auto_judgment",
] as const;

export type TmFacetAxis = (typeof TM_FACET_AXES)[number];

/** UI 다중 선택 필터 (col → 값 배열). EMPTY_TOKEN 포함 시 NULL 매치 확장. */
export type TmMultiSelectFilters = Partial<Record<string, string[]>>;

export interface UseTmServerItemsParams {
  q: string;
  filters: TmMultiSelectFilters;
  sort?: Array<{ column: string; dir: "asc" | "desc" }>;
  page: number;
  pageSize: PageSizeMode;
  includeInactive?: boolean;
  enabled?: boolean;
}

function serializeTmFilters(filters: TmMultiSelectFilters): ServerFilter[] {
  const out: ServerFilter[] = [];
  for (const [col, values] of Object.entries(filters)) {
    if (!values || values.length === 0) continue;
    const hasEmpty = values.includes(EMPTY_TOKEN);
    const real = values.filter((v) => v !== EMPTY_TOKEN);
    if (hasEmpty && real.length === 0) {
      out.push({ column: col, op: "empty" });
    } else if (hasEmpty) {
      out.push({ column: col, op: "in_or_empty", value: real });
    } else {
      out.push({ column: col, op: "in", value: real });
    }
  }
  return out;
}

export function useTmServerItems(params: UseTmServerItemsParams) {
  return useServerSearchItems<TmMultiSelectFilters>({
    scope: "tm",
    searchRpc: "tm_items_search",
    facetsRpc: "tm_items_facets",
    idsRpc: "tm_items_search_ids",
    q: params.q,
    filters: params.filters,
    sort: params.sort ?? [],
    page: params.page,
    pageSize: params.pageSize,
    facetAxes: [...TM_FACET_AXES],
    serializeFilters: serializeTmFilters,
    includeInactive: params.includeInactive,
    enabled: params.enabled,
  });
}