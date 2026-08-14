/**
 * DMR Dashboard — 화면이 쓰는 값의 조립층.
 *
 * 계산 정본은 src/lib/dmr/productivity.ts 한 벌뿐이다.
 * 이 파일은 정본이 만든 행(ProductivityRow)과 원천 인원 행(DmrManpowerRow)을
 * "고르고(필터) · 묶고(그룹) · 세는(합계)" 일만 한다. 산식을 새로 만들지 않는다.
 */
import {
  aggregateByContractor,
  aggregateByTeam,
  classifyCode,
  contractorSubtotals,
  summarize,
  type CodeClass,
  type ContractorRow,
  type ContractorSubtotal,
  type DmrManpowerRow,
  type Period,
  type ProductivityRow,
  type ProductivitySummary,
  type TeamAgg,
} from './productivity';

export type ContractorType = 'all' | 'direct' | 'sub';
export type QualityFilter = 'all' | CodeClass | 'dateGap';
export type TrendGroupBy = 'total' | 'team' | 'plot' | 'contractor' | 'system';

export interface DmrDashFilters {
  plots: string[];
  teams: string[];
  contractors: string[];
  systems: string[];
  workTypes: string[];
  headcountKinds: string[];
  codes: string[];
  contractorType: ContractorType;
  quality: QualityFilter;
  search: string;
}

export const EMPTY_FILTERS: DmrDashFilters = {
  plots: [],
  teams: [],
  contractors: [],
  systems: [],
  workTypes: [],
  headcountKinds: [],
  codes: [],
  contractorType: 'all',
  quality: 'all',
  search: '',
};

export function filtersAreEmpty(f: DmrDashFilters): boolean {
  return (
    f.plots.length === 0 &&
    f.teams.length === 0 &&
    f.contractors.length === 0 &&
    f.systems.length === 0 &&
    f.workTypes.length === 0 &&
    f.headcountKinds.length === 0 &&
    f.codes.length === 0 &&
    f.contractorType === 'all' &&
    f.quality === 'all' &&
    !f.search.trim()
  );
}

const sortKo = (a: string, b: string) => a.localeCompare(b, 'ko');
const uniqSorted = (v: Iterable<string>) => Array.from(new Set(v)).filter(Boolean).sort(sortKo);

export interface DmrDashOptions {
  plots: string[];
  teams: string[];
  contractors: string[];
  systems: string[];
  workTypes: string[];
  headcountKinds: string[];
  codes: string[];
}

export function buildOptions(rows: ProductivityRow[], dmrRows: DmrManpowerRow[]): DmrDashOptions {
  const plots: string[] = [];
  const teams: string[] = [];
  const contractors: string[] = [];
  const systems: string[] = [];
  const workTypes: string[] = [];
  const kinds: string[] = [];
  const codes: string[] = [];
  for (const r of rows) {
    codes.push(r.task_no);
    if (r.plot) plots.push(r.plot);
    plots.push(...r.dmr_plots);
    if (r.team) teams.push(r.team);
    teams.push(...r.dmr_teams);
    if (r.work_type) workTypes.push(r.work_type);
    workTypes.push(...r.dmr_work_categories);
    systems.push(...r.systems);
    kinds.push(...r.headcount_kinds);
    for (const c of r.contractors) contractors.push(c.name);
  }
  for (const d of dmrRows) {
    if (d.plot) plots.push(d.plot);
    if (d.discipline) teams.push(d.discipline);
    if (d.system_name) systems.push(d.system_name);
    if (d.contractor_name) contractors.push(d.contractor_name);
    if (d.work_category) workTypes.push(d.work_category);
    if (d.headcount_kind) kinds.push(d.headcount_kind);
  }
  return {
    plots: uniqSorted(plots),
    teams: uniqSorted(teams),
    contractors: uniqSorted(contractors),
    systems: uniqSorted(systems),
    workTypes: uniqSorted(workTypes),
    headcountKinds: uniqSorted(kinds),
    codes: uniqSorted(codes),
  };
}

const hits = (sel: string[], vals: Array<string | null | undefined>) =>
  sel.length === 0 || vals.some((v) => !!v && sel.includes(v));

/** 필터는 "어떤 코드를 볼지"만 정한다 — 분모(인원)는 코드 전체를 그대로 쓴다. */
export function filterRows(
  rows: ProductivityRow[],
  f: DmrDashFilters,
  directNames: Set<string>,
): ProductivityRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (!hits(f.plots, [r.plot, ...r.dmr_plots])) return false;
    if (!hits(f.teams, [r.team, ...r.dmr_teams])) return false;
    if (!hits(f.systems, r.systems)) return false;
    if (!hits(f.workTypes, [r.work_type, ...r.dmr_work_categories])) return false;
    if (!hits(f.headcountKinds, r.headcount_kinds)) return false;
    if (f.codes.length > 0 && !f.codes.includes(r.task_no)) return false;
    const names = r.contractors.map((c) => c.name);
    if (!hits(f.contractors, names)) return false;
    if (f.contractorType === 'direct' && !names.some((n) => directNames.has(n))) return false;
    if (f.contractorType === 'sub' && !names.some((n) => !directNames.has(n))) return false;
    if (f.quality !== 'all') {
      if (f.quality === 'dateGap') {
        if (!r.data_date_gap) return false;
      } else if (classifyCode(r) !== f.quality) return false;
    }
    if (q && !`${r.task_no} ${r.task_name}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** 코드 → 추이 차트 그룹 키. 코드가 여러 값에 걸치면 각 그룹에 들어간다. */
export function buildCodeGroups(
  rows: ProductivityRow[],
  groupBy: TrendGroupBy,
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    let keys: string[];
    switch (groupBy) {
      case 'team':
        keys = uniqSorted([r.team, ...r.dmr_teams]);
        break;
      case 'plot':
        keys = uniqSorted([r.plot, ...r.dmr_plots]);
        break;
      case 'contractor':
        keys = uniqSorted(r.contractors.map((c) => c.name));
        break;
      case 'system':
        keys = uniqSorted(r.systems);
        break;
      default:
        keys = ['전체'];
    }
    m.set(r.task_no, keys.length > 0 ? keys : ['(미지정)']);
  }
  return m;
}

/* ────────────────────── 인원 상세 (Manpower) ────────────────────── */

export interface ManpowerMatrix {
  dates: string[];
  keys: Array<{ key: string; label: string; sub: string }>;
  cell: (key: string, date: string) => { plan: number; actual: number };
  rowTotal: (key: string) => { plan: number; actual: number };
  colTotal: (date: string) => { plan: number; actual: number };
  total: { plan: number; actual: number };
}

type MatrixKind = 'team' | 'contractor' | 'system';

export function buildManpowerMatrix(
  dmrRows: DmrManpowerRow[],
  kind: MatrixKind,
): ManpowerMatrix {
  const dates = uniqSorted(dmrRows.map((r) => r.report_date));
  const keyOf = (r: DmrManpowerRow) =>
    (kind === 'team' ? r.discipline : kind === 'contractor' ? r.contractor_name : r.system_name) ??
    '(미지정)';
  const subOf = new Map<string, Set<string>>();
  const cells = new Map<string, { plan: number; actual: number }>();
  const rowT = new Map<string, { plan: number; actual: number }>();
  const colT = new Map<string, { plan: number; actual: number }>();
  const total = { plan: 0, actual: 0 };
  const add = (
    m: Map<string, { plan: number; actual: number }>,
    k: string,
    plan: number,
    actual: number,
  ) => {
    const a = m.get(k) ?? { plan: 0, actual: 0 };
    a.plan += plan;
    a.actual += actual;
    m.set(k, a);
  };
  for (const r of dmrRows) {
    const k = keyOf(r);
    const plan = Number(r.plan_manpower ?? 0) || 0;
    const actual = Number(r.actual_manpower ?? 0) || 0;
    add(cells, `${k}\u0001${r.report_date}`, plan, actual);
    add(rowT, k, plan, actual);
    add(colT, r.report_date, plan, actual);
    total.plan += plan;
    total.actual += actual;
    const s = subOf.get(k) ?? new Set<string>();
    const sub = kind === 'contractor' ? r.system_name : r.contractor_name;
    if (sub) s.add(sub);
    subOf.set(k, s);
  }
  const keys = uniqSorted(Array.from(rowT.keys())).map((k) => ({
    key: k,
    label: k,
    sub: Array.from(subOf.get(k) ?? []).sort(sortKo).join(', '),
  }));
  const zero = { plan: 0, actual: 0 };
  return {
    dates,
    keys,
    cell: (k, d) => cells.get(`${k}\u0001${d}`) ?? zero,
    rowTotal: (k) => rowT.get(k) ?? zero,
    colTotal: (d) => colT.get(d) ?? zero,
    total,
  };
}

/* ────────────────────── 모델 ────────────────────── */

export interface DmrDashboardModel {
  period: Period;
  options: DmrDashOptions;
  /** 필터 적용 후 코드 행 */
  rows: ProductivityRow[];
  /** 필터 전 전체 코드 수 (모집단) */
  populationCodes: number;
  summary: ProductivitySummary;
  teamRows: TeamAgg[];
  contractor: { rows: ContractorRow[]; soloCodes: number; sharedCodes: number };
  contractorSubtotals: ContractorSubtotal[];
  /** 선택된 코드에 붙은 인원 행 (분모는 좁히지 않는다) */
  dmrRowsInScope: DmrManpowerRow[];
  /** TM Code 가 없어 코드에 붙지 못한 인원 행 수 */
  unlinkedManpowerRows: number;
  unlinkedManpower: number;
  codeGroups: Map<string, string[]>;
}

export function buildDashboardModel(args: {
  period: Period;
  rows: ProductivityRow[];
  dmrRows: DmrManpowerRow[];
  filters: DmrDashFilters;
  directNames: Set<string>;
  groupBy: TrendGroupBy;
}): DmrDashboardModel {
  const { period, rows, dmrRows, filters, directNames, groupBy } = args;
  const filtered = filterRows(rows, filters, directNames);
  const codeSet = new Set(filtered.map((r) => r.task_no));
  const inScope = dmrRows.filter((r) => {
    const c = (r.task_no ?? '').trim();
    return !!c && codeSet.has(c);
  });
  let unlinkedRows = 0;
  let unlinkedMp = 0;
  for (const r of dmrRows) {
    if (!(r.task_no ?? '').trim()) {
      unlinkedRows += 1;
      unlinkedMp += Number(r.actual_manpower ?? 0) || 0;
    }
  }
  const contractor = aggregateByContractor(filtered);
  return {
    period,
    options: buildOptions(rows, dmrRows),
    rows: filtered,
    populationCodes: rows.length,
    summary: summarize(filtered, period),
    teamRows: aggregateByTeam(filtered),
    contractor,
    contractorSubtotals: contractorSubtotals(contractor.rows),
    dmrRowsInScope: inScope,
    unlinkedManpowerRows: unlinkedRows,
    unlinkedManpower: unlinkedMp,
    codeGroups: buildCodeGroups(filtered, groupBy),
  };
}
