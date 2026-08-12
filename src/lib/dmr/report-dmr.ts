import { supabase } from '@/integrations/supabase/client';
import { formatDdMmmYyyy } from '@/lib/time/doha';

/**
 * DMR Daily Manpower Mobilization Status 리포트.
 * 저장된 Raw Data(dmr_entries)를 그대로 읽어 좌 Plot C · 우 Plot D 표로 만든다.
 * 셀 병합은 하지 않고 같은 값을 행마다 반복한다.
 */

export type DmrReportTeam = 'ARCH' | 'ELEC' | 'MECH';

export interface DmrReportOptions {
  from: string;
  to: string;
  teams: DmrReportTeam[];
  /** 기간이 여러 날일 때 날짜마다 표를 나눌지 */
  dateMode: 'single' | 'per-date';
  format: 'html' | 'pdf';
}

interface Row {
  report_date: string;
  discipline: string;
  plot: string;
  work_category: string | null;
  system_name: string | null;
  contractor_name: string | null;
  pic_name: string | null;
  task_no: string | null;
  task_name: string | null;
  actual_manpower: number | null;
  tc_plan_pct: number | null;
}

const PAGE = 1000;
const HARD_CAP = 20_000;

async function fetchRows(opts: DmrReportOptions): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('dmr_entries')
      .select(
        'report_date,discipline,plot,work_category,system_name,contractor_name,pic_name,task_no,task_name,actual_manpower,tc_plan_pct',
      )
      .in('discipline', opts.teams)
      .gte('report_date', opts.from)
      .lte('report_date', opts.to)
      .in('plot', ['C', 'D'])
      .not('task_no', 'is', null)
      .order('report_date')
      .order('discipline')
      .order('work_category')
      .order('system_name')
      .order('contractor_name')
      .order('plot')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Row[];
    out.push(...page);
    if (page.length < PAGE || out.length >= HARD_CAP) break;
  }
  return out;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const isHdec = (c: string | null) => /^hdec/i.test(String(c ?? '').trim());

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

const pct = (v: unknown) => {
  const n = num(v);
  return n == null || Number.isNaN(n) ? '' : `${Math.round(n * 10) / 10}%`;
};

interface Cell {
  pic: string;
  plan: string;
  today: string;
  code: string;
  task: string;
}

const EMPTY: Cell = { pic: '', plan: '', today: '', code: '', task: '' };

const toCell = (r: Row): Cell => ({
  pic: r.pic_name ?? '',
  plan: pct(r.tc_plan_pct),
  today: num(r.actual_manpower) == null ? '' : String(num(r.actual_manpower)),
  code: r.task_no ?? '',
  task: r.task_name ?? '',
});

function sectionTable(rows: Row[]): string {
  // 그룹 = Type · System · Contractor (병합 없이 값만 반복)
  const groups = new Map<string, { type: string; system: string; contractor: string; c: Row[]; d: Row[] }>();
  for (const r of rows) {
    const type = r.work_category ?? '';
    const system = r.system_name ?? '';
    const contractor = r.contractor_name ?? '';
    const k = `${type}\u0000${system}\u0000${contractor}`;
    if (!groups.has(k)) groups.set(k, { type, system, contractor, c: [], d: [] });
    const g = groups.get(k)!;
    (r.plot === 'C' ? g.c : g.d).push(r);
  }

  const body: string[] = [];
  for (const g of groups.values()) {
    const n = Math.max(g.c.length, g.d.length, 1);
    for (let i = 0; i < n; i++) {
      const c = g.c[i] ? toCell(g.c[i]) : EMPTY;
      const d = g.d[i] ? toCell(g.d[i]) : EMPTY;
      const remark = !isHdec(g.contractor) && g.contractor ? 'Subcontractor' : '';
      body.push(
        `<tr>` +
          `<td class="grp">${esc(g.type)}</td>` +
          `<td class="grp">${esc(g.system)}</td>` +
          `<td class="grp">${esc(g.contractor)}</td>` +
          `<td class="c">${esc(c.pic)}</td><td class="c n">${esc(c.plan)}</td><td class="c n">${esc(c.today)}</td><td class="c">${esc(c.code)}</td><td class="c t">${esc(c.task)}</td>` +
          `<td class="d">${esc(d.pic)}</td><td class="d n">${esc(d.plan)}</td><td class="d n">${esc(d.today)}</td><td class="d">${esc(d.code)}</td><td class="d t">${esc(d.task)}</td>` +
          `<td>${esc(remark)}</td>` +
          `</tr>`,
      );
    }
  }

  const sum = (plot: string, pred: (r: Row) => boolean) =>
    rows.filter((r) => r.plot === plot && pred(r)).reduce((a, r) => a + (num(r.actual_manpower) ?? 0), 0);

  const totalRow = (label: string, pred: (r: Row) => boolean) =>
    `<tr class="tot">` +
    `<td colspan="3">${label}</td>` +
    `<td></td><td></td><td class="n">${sum('C', pred)}</td><td></td><td></td>` +
    `<td></td><td></td><td class="n">${sum('D', pred)}</td><td></td><td></td>` +
    `<td></td></tr>`;

  return (
    `<table>` +
    `<thead>` +
    `<tr class="h1">` +
    `<th rowspan="2" class="s0">Type</th><th rowspan="2" class="s1">System</th><th rowspan="2" class="s2">Contractor Subcon.</th>` +
    `<th colspan="5" class="pc">PLOT_C</th><th colspan="5" class="pd">PLOT_D</th>` +
    `<th rowspan="2">Remark</th></tr>` +
    `<tr class="h2">` +
    `<th class="pc">담당자</th><th class="pc">TC.Plan%</th><th class="pc">Today</th><th class="pc">TM Code</th><th class="pc">TASK</th>` +
    `<th class="pd">담당자</th><th class="pd">TC.Plan%</th><th class="pd">Today</th><th class="pd">TM Code</th><th class="pd">TASK</th>` +
    `</tr></thead>` +
    `<tbody>${body.join('')}` +
    totalRow('HDEC_Total', (r) => isHdec(r.contractor_name)) +
    totalRow('SUBCON_Total', (r) => !isHdec(r.contractor_name)) +
    totalRow('Total', () => true) +
    `</tbody></table>`
  );
}

const CSS = `
*{box-sizing:border-box}
body{font-family:"Segoe UI",Arial,"Malgun Gothic",sans-serif;margin:16px;color:#111;background:#fff}
.section{margin-bottom:28px}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.head h2{font-size:17px;margin:0;font-weight:700}
.date{background:#ffff00;border:1px solid #b58900;color:#b30000;font-weight:700;padding:3px 10px;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:11px;table-layout:fixed}
th,td{border:1px solid #7a7a7a;padding:3px 5px;vertical-align:middle;word-break:break-word}
thead th{background:#f2d9cc;text-align:center;font-weight:700}
thead th.pc{background:#dbe9f7}
thead th.pd{background:#fdeecf}
thead tr.h1 th{position:sticky;top:0;z-index:3}
thead tr.h2 th{position:sticky;top:26px;z-index:3}
td.c{background:#fbfdff}
td.d{background:#fffdf7}
td.n{text-align:right}
td.t{text-align:left}
td.grp{background:#f7f3f0}
tr.tot td{background:#e9e9e9;font-weight:700;text-align:center}
tr.tot td.n{text-align:right}
col.w{}
@media print{
  body{margin:0}
  thead{display:table-header-group}
  tr{page-break-inside:avoid}
  .section{page-break-after:always}
  .section:last-child{page-break-after:auto}
  @page{size:A3 landscape;margin:10mm}
}
`;

function sectionHtml(title: string, dateLabel: string, rows: Row[]) {
  return (
    `<div class="section">` +
    `<div class="head"><h2>Daily Manpower Mobilization Status (${esc(title)})</h2>` +
    `<div class="date">${esc(dateLabel)}</div></div>` +
    sectionTable(rows) +
    `</div>`
  );
}

export function buildDmrReportHtml(rows: Row[], opts: DmrReportOptions): string {
  const dates = [...new Set(rows.map((r) => String(r.report_date).slice(0, 10)))].sort();
  const sections: string[] = [];

  const teamsInOrder = opts.teams;
  if (opts.dateMode === 'per-date') {
    for (const d of dates) {
      for (const t of teamsInOrder) {
        const sub = rows.filter((r) => String(r.report_date).slice(0, 10) === d && r.discipline === t);
        if (sub.length) sections.push(sectionHtml(t, formatDdMmmYyyy(d), sub));
      }
    }
  } else {
    const label =
      opts.from === opts.to
        ? formatDdMmmYyyy(opts.from)
        : `${formatDdMmmYyyy(opts.from)} ~ ${formatDdMmmYyyy(opts.to)}`;
    for (const t of teamsInOrder) {
      const sub = rows.filter((r) => r.discipline === t);
      if (sub.length) sections.push(sectionHtml(t, label, sub));
    }
  }

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>Daily Manpower Mobilization Status</title><style>${CSS}</style></head>
<body>${sections.join('')}</body></html>`;
}

export async function runDmrReport(opts: DmrReportOptions) {
  if (opts.teams.length === 0) throw new Error('팀을 하나 이상 고르십시오');
  if (opts.from > opts.to) throw new Error('시작일이 종료일보다 늦습니다');

  const rows = await fetchRows(opts);
  if (rows.length === 0) throw new Error('해당 조건의 저장된 행이 없습니다');

  const html = buildDmrReportHtml(rows, opts);
  const w = window.open('', '_blank');
  if (!w) throw new Error('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하십시오.');
  w.document.open();
  w.document.write(html);
  w.document.close();
  if (opts.format === 'pdf') {
    w.onload = () => setTimeout(() => w.print(), 250);
    setTimeout(() => { try { w.print(); } catch { /* noop */ } }, 800);
  }
  return { rowCount: rows.length };
}
