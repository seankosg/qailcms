import { supabase } from '@/integrations/supabase/client';
import { dohaStamp } from '@/lib/time/doha';
import { streamXlsxExport } from '@/lib/excel/stream-export';
import { dmrDataDateGapDays } from '@/lib/dmr/task-link';

/**
 * 공종별 DMR 엑셀 — 함수는 한 벌이다. 세 벌의 차이는 discipline 필터 하나뿐이다.
 * Sub-total 행 없음. 맨 아래 Total 한 줄만, 내보낼 때 계산한다.
 * metric / manpower 잔재 칸은 내보내지 않는다.
 */
const RAW_COLUMNS = [
  { key: 'report_date', label: 'Date' },
  { key: 'plot', label: 'Plot' },
  { key: 'system_name', label: 'Work Description' },
  { key: 'contractor_name', label: 'Sub Contractor' },
  { key: 'task_no', label: 'TM Code' },
  { key: 'task_name', label: 'TASK' },
  { key: 'headcount_kind', label: '인원종류' },
  { key: 'pic_name', label: '담당자' },
  { key: 'plan_manpower', label: 'Plan' },
  { key: 'actual_manpower', label: 'Actual' },
  { key: 'diff_manpower', label: 'Diff' },
  { key: 'tplan_pct', label: 'T.Plan %' },
  { key: 'tactual_pct', label: 'T.Actual %' },
  { key: 'task_data_date', label: 'Data Date' },
  { key: 'gap_days', label: '격차(일)' },
];

const SUMMARY_COLUMNS = [
  { key: 'system_name', label: 'System' },
  { key: 'contractor_name', label: 'Contractor' },
  { key: 'c_pic', label: 'Plot C · 담당자' },
  { key: 'c_today', label: 'Plot C · Today' },
  { key: 'c_task_no', label: 'Plot C · TM Code' },
  { key: 'c_task', label: 'Plot C · TASK' },
  { key: 'd_pic', label: 'Plot D · 담당자' },
  { key: 'd_today', label: 'Plot D · Today' },
  { key: 'd_task_no', label: 'Plot D · TM Code' },
  { key: 'd_task', label: 'Plot D · TASK' },
  { key: 'remark', label: 'Remark' },
];

export interface DmrTeamExportOptions {
  discipline: 'ARCH' | 'ELEC' | 'MECH';
  reportDate: string;
}

export async function exportDmrTeamWorkbook(opts: DmrTeamExportOptions) {
  const { data, error } = await supabase
    .from('dmr_entries')
    .select('*')
    .eq('discipline', opts.discipline)
    .eq('report_date', opts.reportDate)
    .in('plot', ['C', 'D'])
    .order('system_name')
    .order('contractor_name')
    .order('plot');
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((r: any) => ({
    ...r,
    gap_days: dmrDataDateGapDays({
      report_date: r.report_date,
      task_data_date: r.task_data_date,
    }),
  }));

  const total = {
    report_date: 'Total',
    plan_manpower: rows.reduce((s, r: any) => s + (Number(r.plan_manpower) || 0), 0),
    actual_manpower: rows.reduce((s, r: any) => s + (Number(r.actual_manpower) || 0), 0),
    diff_manpower: rows.reduce((s, r: any) => s + (Number(r.diff_manpower) || 0), 0),
  };

  // Summary — System × Contractor 한 줄, Plot 별 열
  const summaryMap = new Map<string, any>();
  for (const r of rows as any[]) {
    const key = `${r.system_name}|${r.contractor_name}`;
    let s = summaryMap.get(key);
    if (!s) {
      s = {
        system_name: r.system_name,
        contractor_name: r.contractor_name,
        c_pic: '', c_today: 0, c_task_no: '', c_task: '',
        d_pic: '', d_today: 0, d_task_no: '', d_task: '',
        remark: '',
      };
      summaryMap.set(key, s);
    }
    const p = r.plot === 'C' ? 'c' : r.plot === 'D' ? 'd' : null;
    if (!p) continue;
    s[`${p}_today`] = (s[`${p}_today`] || 0) + (Number(r.actual_manpower) || 0);
    if (r.pic_name && !String(s[`${p}_pic`]).includes(r.pic_name)) {
      s[`${p}_pic`] = s[`${p}_pic`] ? `${s[`${p}_pic`]}, ${r.pic_name}` : r.pic_name;
    }
    if (r.task_no && !String(s[`${p}_task_no`]).includes(r.task_no)) {
      s[`${p}_task_no`] = s[`${p}_task_no`] ? `${s[`${p}_task_no`]}, ${r.task_no}` : r.task_no;
    }
    if (r.task_name && !String(s[`${p}_task`]).includes(r.task_name)) {
      s[`${p}_task`] = s[`${p}_task`] ? `${s[`${p}_task`]}, ${r.task_name}` : r.task_name;
    }
    const gap = r.gap_days;
    if (gap != null && gap !== 0) {
      const note = `Data Date 격차 ${gap}일`;
      if (!s.remark.includes(note)) s.remark = s.remark ? `${s.remark}; ${note}` : note;
    }
  }
  const summaryRows = [...summaryMap.values()];
  summaryRows.push({
    system_name: 'Total',
    contractor_name: '',
    c_today: summaryRows.reduce((s, r) => s + (Number(r.c_today) || 0), 0),
    d_today: summaryRows.reduce((s, r) => s + (Number(r.d_today) || 0), 0),
  });

  const allRows = [...rows, total];

  const result = await streamXlsxExport({
    filename: `CMS_DMR_${opts.discipline}_${opts.reportDate}.xlsx`,
    sheetName: 'Raw Data',
    columns: RAW_COLUMNS,
    dateFields: ['report_date', 'task_data_date'],
    header: {
      title: `DMR — ${opts.discipline} (${opts.reportDate})`,
      metaRows: [
        `Exported at: ${dohaStamp()} (Doha)`,
        'Source: dmr_entries',
        'Search: —',
        `Filters: discipline=${opts.discipline}, report_date=${opts.reportDate}, plot in (C,D)`,
        'Sort: system_name, contractor_name, plot',
      ],
      freezeCols: 4,
    },
    fetchPage: async (offset, limit) => ({
      rows: allRows.slice(offset, offset + limit),
      total: allRows.length,
    }),
    extraSheets: [
      { name: 'Summary', columns: SUMMARY_COLUMNS, rows: summaryRows, columnWidths: { system_name: 28, contractor_name: 24, c_task: 30, d_task: 30, remark: 28 } },
    ],
  });

  return { rowCount: rows.length, exported: result.count };
}
