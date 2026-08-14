import { describe, expect, it } from 'vitest';
import {
  buildCodeGroups,
  buildManpowerMatrix,
  filterRows,
  EMPTY_FILTERS,
} from './dashboard-model';
import {
  buildDailyPoints,
  classifyCode,
  summarize,
  type DmrManpowerRow,
  type Period,
  type ProductivityRow,
} from './productivity';

const period: Period = { kind: 'range', start: '2026-08-01', end: '2026-08-02' } as Period;

function row(p: Partial<ProductivityRow>): ProductivityRow {
  return {
    task_no: 'A-1',
    task_name: 'Task',
    work_type: 'Sub',
    team: 'ARCH',
    plot: 'C',
    contractors: [{ name: 'Sub1', manpower: 10 }],
    systems: ['SYS'],
    dmr_teams: ['ARCH'],
    dmr_plots: ['C'],
    dmr_work_categories: [],
    headcount_kinds: ['worker'],
    plan_pct: 0.01,
    actual_pct: 0.02,
    manpower: 10,
    plan_manpower: 8,
    record_days: 2,
    productivity: 0.002,
    plan_productivity: 0.001,
    achievement: 2,
    extra_manpower: 0,
    extra_manpower_per_day: 0,
    data_date_gap: 0,
    kind: '가',
    note: '',
    ...(p as any),
  } as ProductivityRow;
}

describe('DMR dashboard model', () => {
  it('코드 분류 합계 = 모집단', () => {
    const rows = [
      row({ task_no: 'A', actual_pct: 0.01, manpower: 5 }),
      row({ task_no: 'B', actual_pct: 0, manpower: 5 }),
      row({ task_no: 'C', actual_pct: -0.01, manpower: 5 }),
      row({ task_no: 'D', actual_pct: 0.01, manpower: 0 }),
    ];
    const s = summarize(rows, period);
    expect(s.productiveCodes + s.noProgressCodes + s.correctedCodes + s.exceptionalCodes).toBe(s.codes);
    expect(rows.map(classifyCode)).toEqual(['productive', 'noProgress', 'corrected', 'exceptional']);
  });

  it('인원 합계 = 계획 + 차이', () => {
    const s = summarize([row({ manpower: 10, plan_manpower: 8 })], period);
    expect(s.manpower).toBe(10);
    expect(s.planManpower).toBe(8);
    expect(s.manpowerVariance).toBe(2);
    expect(s.manpowerAchievement).toBeCloseTo(1.25);
  });

  it('필터는 코드 모집단만 좁힌다', () => {
    const rows = [row({ task_no: 'A', team: 'ARCH' }), row({ task_no: 'B', team: 'ELEC', dmr_teams: ['ELEC'] })];
    const out = filterRows(rows, { ...EMPTY_FILTERS, teams: ['ELEC'] }, new Set());
    expect(out.map((r) => r.task_no)).toEqual(['B']);
  });

  it('날짜별 실적 합 = 기간 실적 합', () => {
    const rows = [row({ task_no: 'A' })];
    const dates = ['2026-08-01', '2026-08-02'];
    const byDate = new Map([
      ['2026-08-01', new Map([['A', { plan: 0.004, actual: 0.008 }]])],
      ['2026-08-02', new Map([['A', { plan: 0.006, actual: 0.012 }]])],
    ]);
    const dmrRows: DmrManpowerRow[] = [
      {
        report_date: '2026-08-01', task_no: 'A', actual_manpower: 4, plan_manpower: 4,
        headcount_kind: 'worker', discipline: 'ARCH', system_name: 'SYS', plot: 'C',
        contractor_name: 'Sub1', work_category: null,
      },
      {
        report_date: '2026-08-02', task_no: 'A', actual_manpower: 6, plan_manpower: 4,
        headcount_kind: 'worker', discipline: 'ARCH', system_name: 'SYS', plot: 'C',
        contractor_name: 'Sub1', work_category: null,
      },
    ];
    const pts = buildDailyPoints({ dates, byDate, dmrRows, codeGroups: buildCodeGroups(rows, 'total') });
    expect(pts).toHaveLength(2);
    expect(pts.reduce((a, p) => a + p.actualProgress, 0)).toBeCloseTo(0.02);
    expect(pts.reduce((a, p) => a + p.manpower, 0)).toBe(10);
    expect(pts[1].actualProductivity).toBeCloseTo(0.012 / 6);
  });

  it('인원 매트릭스 합계가 행·열 합과 일치한다', () => {
    const dmrRows: DmrManpowerRow[] = [
      { report_date: '2026-08-01', task_no: 'A', actual_manpower: 3, plan_manpower: 2, headcount_kind: 'worker', discipline: 'ARCH', system_name: 'S1', plot: 'C', contractor_name: 'Sub1', work_category: null },
      { report_date: '2026-08-02', task_no: 'A', actual_manpower: 4, plan_manpower: 5, headcount_kind: 'worker', discipline: 'ELEC', system_name: 'S2', plot: 'C', contractor_name: 'Sub2', work_category: null },
    ];
    const m = buildManpowerMatrix(dmrRows, 'contractor');
    const rowSum = m.keys.reduce((a, k) => a + m.rowTotal(k.key).actual, 0);
    const colSum = m.dates.reduce((a, d) => a + m.colTotal(d).actual, 0);
    expect(rowSum).toBe(m.total.actual);
    expect(colSum).toBe(m.total.actual);
    expect(m.total.plan).toBe(7);
  });
});
