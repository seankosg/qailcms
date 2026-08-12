import { describe, it, expect } from 'vitest';
import { buildDmrEntryRowsFromSection } from '@/lib/dmr/entry-import';

let n = 0;
const make = (i: any) => ({ key: String(++n), task_no: '', system_name: '', contractor_name: '', plot: 'C', pic_name: '', worker: '0', foreman: '0', supervisor: '0', ...i });
const tm = new Map<string, any>([
  ['ME-C-06', { plot: 'C', effective_pic: 'A' }],
  ['ME-D-05', { plot: 'D', effective_pic: 'B' }],
  ['ME-C-11', { plot: 'C', effective_pic: 'C' }],
  ['ME-C-17', { plot: 'C', effective_pic: 'D' }],
  ['ME-D-08-06', { plot: 'D', effective_pic: 'E' }],
  ['AR-C-T-12', { plot: 'C', effective_pic: 'F' }],
  ['AR-C-P-02', { plot: 'C', effective_pic: 'G' }],
]);
const sec = (rows: any[]) => ({ discipline: 'MECH', report_date: '2026-08-11', rows } as any);

describe('dmr entry import', () => {
  it('merges duplicate codes, drops totals, keeps codeless', () => {
    const out = buildDmrEntryRowsFromSection(sec([
      { task_no: 'ME-C-06', count: 27, system: 'HVAC', contractor: 'X' },
      { task_no: 'ME-C-06', count: 9, system: 'HVAC', contractor: 'X' },
      { task_no: 'ME-D-05', count: 14, system: 'PL', contractor: 'X' },
      { task_no: 'ME-D-05', count: 10, system: 'PL', contractor: 'X' },
      { task_no: 'ME-C-11', count: 77, system: 'HVAC', contractor: 'X' },
      { task_no: 'ME-C-17', count: 18, system: 'HVAC', contractor: 'X' },
      { task_no: 'Monitoring', count: 3, system: 'FF', contractor: 'X' },
      { task_no: 'ME-D-08-06', count: 5, system: 'FF', contractor: 'X' },
      { task_no: '', count: 7, system: 'HDEC Operator & storekeeper', contractor: 'HDEC_Direct' },
      { task_no: '', count: 5, system: 'Laydown', contractor: 'HDEC_Direct' },
      { task_no: '', count: 0, system: 'Zero', contractor: 'X' },
      { task_no: '', count: 240, system: 'Total', contractor: '' },
      { task_no: '', count: 97, system: 'HDEC_Total', contractor: '' },
    ]), tm, make as any);
    const by = (c: string) => out.filter(r => r.task_no === c).reduce((s, r) => s + Number(r.worker), 0);
    expect(by('ME-C-06')).toBe(36);
    expect(by('ME-D-05')).toBe(24);
    expect(by('ME-C-11')).toBe(77);
    expect(by('ME-C-17')).toBe(18);
    expect(out.find(r => r.task_no === 'ME-D-08-06')!.plot).toBe('D');
    expect(out.filter(r => !r.task_no).map(r => Number(r.worker)).sort()).toEqual([3, 5, 7]);
    expect(out.some(r => /Total/i.test(r.system_name))).toBe(false);
    expect(out.some(r => r.system_name === 'Zero')).toBe(false);
  });

  it('multi-code row gives each code the full headcount', () => {
    const out = buildDmrEntryRowsFromSection(sec([
      { task_no: 'AR-C-T-12, AR-C-P-02', count: 4, system: 'S', contractor: 'X' },
    ]), tm, make as any);
    expect(out.length).toBe(2);
    expect(out.map(r => Number(r.worker))).toEqual([4, 4]);
    expect(out.every(r => r.multiCode)).toBe(true);
    expect(out.every(r => !r.unmatched)).toBe(true);
  });

  it('matches codes written with en-dash / lowercase / spaces', () => {
    const out = buildDmrEntryRowsFromSection(sec([
      { task_no: 'me–c–11', count: 12, system: 'HVAC', contractor: 'X' },
      { task_no: 'ME - C - 17', count: 3, system: 'HVAC', contractor: 'X' },
    ]), tm, make as any);
    expect(out.map(r => r.task_no).sort()).toEqual(['ME-C-11', 'ME-C-17']);
    expect(out.every(r => !r.unmatched)).toBe(true);
  });
});
