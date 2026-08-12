import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const EMPTY_TOKEN = '__EMPTY__';

/**
 * DMR 화면 구분.
 * - import : DMR Raw Data (스크린샷/임포트 유래, task_no 없음)
 * - entry  : DMR Raw Data 2 (Daily Entry 저장분, task_no 있음)
 * 두 화면은 서로의 행을 절대 보지 않는다.
 */
export type DmrScope = 'import' | 'entry' | 'all';

export function applyDmrScope(q: any, scope: DmrScope | undefined) {
  if (scope === 'import') return q.is('task_no', null);
  if (scope === 'entry') return q.not('task_no', 'is', null);
  return q;
}

export type DmrFilterOp =
  | 'in'
  | 'text'
  | 'empty'
  | 'date_range'
  | 'num_range'
  | 'direct_flag_in';

export interface DmrServerFilter {
  column: string;
  op: DmrFilterOp;
  value: any;
}

export interface DmrServerSort {
  column: string;
  desc: boolean;
}

export interface DmrEntry {
  id: string;
  report_date: string;
  discipline: string;
  system_name: string;
  contractor_name: string;
  plot: string;
  plan_manpower: number;
  actual_manpower: number;
  diff_manpower: number;
  [k: string]: any;
}

export interface DmrItemsParams {
  q?: string;
  filters?: DmrServerFilter[];
  sort?: DmrServerSort[];
  page: number;
  pageSize: number;
  directMap?: Map<string, boolean>; // for direct_flag resolution
  scope?: DmrScope;
}

/** Client-side helper — apply filters via supabase-js query builder */
export function useDmrItemsQuery(p: DmrItemsParams) {
  return useQuery({
    queryKey: ['dmr', 'items', p],
    queryFn: async () => {
      let q: any = supabase.from('dmr_entries').select('*', { count: 'exact' });
      q = applyDmrScope(q, p.scope);

      const q_text = (p.q ?? '').trim();
      if (q_text) {
        q = q.or(`system_name.ilike.%${q_text}%,contractor_name.ilike.%${q_text}%`);
      }

      const directContractorNames: string[] | null = (() => {
        if (!p.directMap) return null;
        const filter = (p.filters ?? []).find((f) => f.column === 'direct_flag');
        if (!filter) return null;
        const values: string[] = Array.isArray(filter.value) ? filter.value : [];
        if (!values.length || values.length === 2) return null;
        const wantDirect = values.includes('direct');
        const out: string[] = [];
        p.directMap.forEach((isDirect, name) => {
          if (isDirect === wantDirect) out.push(name);
        });
        return out;
      })();
      if (directContractorNames) {
        if (directContractorNames.length === 0) {
          // no match — force empty result
          q = q.eq('id', '00000000-0000-0000-0000-000000000000');
        } else {
          q = q.in('contractor_name', directContractorNames);
        }
      }

      for (const f of p.filters ?? []) {
        if (f.column === 'direct_flag') continue;
        if (f.op === 'in') {
          const arr = (f.value as any[]).filter((v) => v !== EMPTY_TOKEN);
          if (arr.length) q = q.in(f.column, arr);
        } else if (f.op === 'empty') {
          q = q.is(f.column, null);
        } else if (f.op === 'text') {
          const t = String(f.value ?? '').trim();
          if (t) q = q.ilike(f.column, `%${t}%`);
        } else if (f.op === 'date_range') {
          const v = f.value ?? {};
          if (v.from) q = q.gte(f.column, v.from);
          if (v.to) q = q.lte(f.column, v.to);
        } else if (f.op === 'num_range') {
          const v = f.value ?? {};
          if (v.min != null && v.min !== '') q = q.gte(f.column, Number(v.min));
          if (v.max != null && v.max !== '') q = q.lte(f.column, Number(v.max));
        }
      }

      const sort = p.sort ?? [];
      if (sort.length === 0) {
        q = q.order('report_date', { ascending: false })
          .order('discipline', { ascending: true })
          .order('system_name', { ascending: true })
          .order('contractor_name', { ascending: true });
      } else {
        for (const s of sort) q = q.order(s.column, { ascending: !s.desc });
      }

      const from = Math.max(0, (p.page - 1) * p.pageSize);
      const to = from + p.pageSize - 1;
      q = q.range(from, to);

      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as DmrEntry[], total: count ?? 0 };
    },
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
}

export interface DmrFacetItem {
  value: string;
  cnt: number;
}

export function useDmrFacet(column: string | null, opts: { enabled?: boolean; scope?: DmrScope } = {}) {
  const scope = opts.scope ?? 'all';
  return useQuery<DmrFacetItem[]>({
    queryKey: ['dmr', 'facet', column, scope],
    queryFn: async () => {
      if (!column) return [];
      const { data, error } = await (supabase as any).rpc('dmr_facets', {
        _column: column,
        _filters: [],
        _scope: scope,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        value: String(r.value),
        cnt: Number(r.cnt),
      }));
    },
    enabled: !!column && opts.enabled !== false,
    staleTime: 60_000,
  });
}

export function useDmrContractorMaster() {
  return useQuery({
    queryKey: ['dmr_contractor_master'],
    queryFn: async () => {
      const { data } = await supabase
        .from('dmr_contractor_master')
        .select('name, is_direct')
        .order('name');
      return (data ?? []) as { name: string; is_direct: boolean | null }[];
    },
    staleTime: 60_000,
  });
}

export function useDmrSystemMaster() {
  return useQuery({
    queryKey: ['dmr_system_master'],
    queryFn: async () => {
      const { data } = await supabase
        .from('dmr_system_master')
        .select('name')
        .order('name');
      return (data ?? []) as { name: string }[];
    },
    staleTime: 60_000,
  });
}

export function useInvalidateDmr() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['dmr'] });
}