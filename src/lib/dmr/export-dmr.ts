import { supabase } from '@/integrations/supabase/client';
import { streamXlsxExport } from '@/lib/excel/stream-export';
import { DMR_COLUMNS, type DmrColumnDef } from './columns';

export interface DmrExportOptions {
  visibleKeys: string[];
  directMap?: Map<string, boolean>;
  applyFiltersToQuery: (q: any) => any;
  applySortToQuery: (q: any) => any;
  filename?: string;
  summary?: { filters: string; sort: string };
}

export async function exportDmrRawData(opts: DmrExportOptions) {
  const cols: DmrColumnDef[] = opts.visibleKeys
    .map((k) => DMR_COLUMNS.find((c) => c.key === k))
    .filter((c): c is DmrColumnDef => !!c);

  const dateFields = cols.filter((c) => c.type === 'date').map((c) => c.key);

  await streamXlsxExport({
    filename: opts.filename ?? `DMR-RawData-${todayInDoha()}.xlsx`,
    sheetName: 'DMR',
    columns: cols.map((c) => ({ key: c.key, label: c.label })),
    dateFields,
    header: {
      title: 'DMR — Raw Data',
      metaRows: [
        `Exported at: ${dohaStamp()} (Doha)`,
        'Source: dmr_entries',
        'Search: —',
        `Filters: ${opts.summary?.filters ?? '—'}`,
        `Sort: ${opts.summary?.sort ?? '—'}`,
      ],
      freezeCols: 3,
    },
    fetchPage: async (offset, limit) => {
      let q: any = supabase.from('dmr_entries').select('*', { count: 'exact' });
      q = opts.applyFiltersToQuery(q);
      q = opts.applySortToQuery(q);
      q = q.range(offset, offset + limit - 1);
      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((r: any) => {
        const direct = opts.directMap?.get(r.contractor_name);
        return {
          ...r,
          direct_flag: direct === true ? 'direct' : direct === false ? 'sub' : '',
        };
      });
      return { rows, total: count ?? 0 };
    },
  });
}