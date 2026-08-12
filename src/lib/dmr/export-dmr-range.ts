import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { dohaStampCompact } from '@/lib/time/doha';
import { streamXlsxExport, type StyledHeaderBlock } from '@/lib/excel/stream-export';
import { dmrDataDateGapDays } from '@/lib/dmr/task-link';

/**
 * 기간·팀 옵션이 붙은 DMR 내보내기.
 * 파일 나눔(Subcon 별) · 시트 나눔(날짜별) 은 사용자가 고른다. 데이터 규칙은 바꾸지 않는다.
 */

export type DmrExportDiscipline = 'ARCH' | 'ELEC' | 'MECH';

export const DMR_RANGE_COLUMNS = [
  { key: 'report_date', label: 'Date' },
  { key: 'discipline', label: 'Team' },
  { key: 'plot', label: 'Plot' },
  { key: 'task_no', label: 'TM Code' },
  { key: 'task_name', label: 'TASK' },
  { key: 'work_category', label: 'Work Type' },
  { key: 'pic_name', label: 'HDEC PIC' },
  { key: 'contractor_name', label: 'Sub Contractor' },
  { key: 'system_name', label: 'System' },
  { key: 'tc_plan_pct', label: 'TC Plan %' },
  { key: 'tc_actual_pct', label: 'TC Actual %' },
  { key: 'actual_manpower', label: 'Manpower' },
  { key: 'tplan_pct', label: 'T.Plan %' },
  { key: 'tactual_pct', label: 'T.Actual %' },
  { key: 'task_data_date', label: 'Data Date' },
  { key: 'gap_days', label: '격차(일)' },
];

export interface DmrRangeExportOptions {
  from: string;
  to: string;
  disciplines: DmrExportDiscipline[];
  /** 'single' 파일 하나 · 'per-subcon' Sub Contractor 별 파일 */
  fileMode: 'single' | 'per-subcon';
  /** 'single' 시트 하나 · 'per-date' 날짜별 시트 */
  sheetMode: 'single' | 'per-date';
}

const PAGE = 1000;
const HARD_CAP = 20_000;

async function fetchRange(opts: DmrRangeExportOptions) {
  const fetched: any[] = [];
  let capped = false;
  let serverCount: number | null = null;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error, count } = await supabase
      .from('dmr_entries')
      .select('*', { count: 'exact' })
      .in('discipline', opts.disciplines)
      .gte('report_date', opts.from)
      .lte('report_date', opts.to)
      .in('plot', ['C', 'D'])
      .order('report_date')
      .order('discipline')
      .order('contractor_name')
      .order('system_name')
      .order('plot')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (count != null) serverCount = count;
    const page = data ?? [];
    fetched.push(...page);
    if (page.length < PAGE) break;
    if (fetched.length >= HARD_CAP) { capped = true; break; }
  }
  if (capped) {
    toast.warning(`내보내기 상한 ${HARD_CAP.toLocaleString()}행에 도달해 멈췄습니다. 기간을 좁히십시오.`);
  }
  if (!capped && serverCount != null && fetched.length !== serverCount) {
    toast.error(`받은 ${fetched.length.toLocaleString()}행 / 서버 ${serverCount.toLocaleString()}행 — 결과가 잘렸을 수 있습니다.`);
  }
  return fetched.map((r: any) => ({
    ...r,
    gap_days: dmrDataDateGapDays({ report_date: r.report_date, task_data_date: r.task_data_date }),
  }));
}

function header(opts: DmrRangeExportOptions, suffix: string, sheetScope: string): StyledHeaderBlock {
  return {
    title: `DMR Daily Entry — ${opts.from} ~ ${opts.to}${suffix ? ` · ${suffix}` : ''}`,
    metaRows: [
      `Exported at: ${dohaStampCompact()} (Doha)`,
      'Source: dmr_entries',
      `Scope: ${sheetScope}`,
      `Filters: discipline in (${opts.disciplines.join(', ')}), report_date ${opts.from}..${opts.to}, plot in (C,D)`,
      'Sort: report_date, discipline, contractor, system, plot',
    ],
    freezeCols: 4,
  };
}

function pager(rows: Record<string, any>[]) {
  let served = false;
  return async () => {
    if (served) return { rows: [] as Record<string, any>[], total: rows.length };
    served = true;
    return { rows, total: rows.length };
  };
}

function sanitize(name: string) {
  return String(name || 'Unassigned').replace(/[\\/:*?"<>|[\]]/g, '_').slice(0, 28);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 한 파일 분량을 만든다. 시트 나눔 옵션은 여기서 반영된다. */
async function buildFile(
  rows: Record<string, any>[],
  opts: DmrRangeExportOptions,
  suffix: string,
  filename: string,
  output: 'download' | 'buffer',
) {
  const dateFields = ['report_date', 'task_data_date'];
  if (opts.sheetMode === 'per-date') {
    const byDate = new Map<string, Record<string, any>[]>();
    for (const r of rows) {
      const d = String(r.report_date ?? '').slice(0, 10) || 'unknown';
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(r);
    }
    const dates = [...byDate.keys()].sort();
    const first = dates[0] ?? opts.from;
    const res = await streamXlsxExport({
      filename,
      sheetName: first,
      columns: DMR_RANGE_COLUMNS,
      dateFields,
      header: header(opts, suffix, `Date ${first}`),
      fetchPage: pager(byDate.get(first) ?? []),
      extraSheets: dates.slice(1).map((d) => ({
        name: d,
        columns: DMR_RANGE_COLUMNS,
        rows: byDate.get(d) ?? [],
        header: header(opts, suffix, `Date ${d}`),
      })),
      output,
    });
    return res;
  }
  return streamXlsxExport({
    filename,
    sheetName: 'DMR',
    columns: DMR_RANGE_COLUMNS,
    dateFields,
    header: header(opts, suffix, `${opts.from} ~ ${opts.to}`),
    fetchPage: pager(rows),
    output,
  });
}

export async function exportDmrRange(opts: DmrRangeExportOptions) {
  if (opts.disciplines.length === 0) throw new Error('팀을 하나 이상 고르십시오');
  if (opts.from > opts.to) throw new Error('시작일이 종료일보다 늦습니다');

  const rows = await fetchRange(opts);
  if (rows.length === 0) throw new Error('내보낼 행이 없습니다');

  const stamp = dohaStampCompact();
  const teamTag = opts.disciplines.join('-');

  if (opts.fileMode === 'single') {
    await buildFile(rows, opts, teamTag, `CMS_DMR_${teamTag}_${opts.from}_${opts.to}_${stamp}.xlsx`, 'download');
    return { rowCount: rows.length, files: 1, zipped: false };
  }

  const groups = new Map<string, Record<string, any>[]>();
  for (const r of rows) {
    const k = (r.contractor_name && String(r.contractor_name).trim()) || 'Unassigned';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const keys = [...groups.keys()].sort();

  if (keys.length >= 7) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const k of keys) {
      const name = `CMS_DMR_${sanitize(k)}_${opts.from}_${opts.to}.xlsx`;
      const res = await buildFile(groups.get(k)!, opts, k, name, 'buffer');
      if (res.buffer) zip.file(name, res.buffer);
      groups.set(k, []);
      await new Promise((r) => setTimeout(r, 0));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `CMS_DMR_per-subcon_${opts.from}_${opts.to}_${stamp}.zip`);
    return { rowCount: rows.length, files: keys.length, zipped: true };
  }

  for (const k of keys) {
    await buildFile(groups.get(k)!, opts, k, `CMS_DMR_${sanitize(k)}_${opts.from}_${opts.to}_${stamp}.xlsx`, 'download');
    groups.set(k, []);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { rowCount: rows.length, files: keys.length, zipped: false };
}
