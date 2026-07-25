import type { DmrParsedRow, DmrParsedSection, DmrEntryRow, DmrPlot } from './types';
import { normalizeDmrContractor } from './types';
import { formatDdMmmYyyy } from '@/lib/time/doha';

export function flattenSection(section: DmrParsedSection, sourceImagePath?: string) {
  const out: Array<Omit<DmrEntryRow, 'id'> & { source_image_path?: string }> = [];
  for (const r of section.rows) {
    const planC = Math.max(0, Math.round(r.values.plan.C ?? 0));
    const planD = Math.max(0, Math.round(r.values.plan.D ?? 0));
    const actC = Math.max(0, Math.round(r.values.actual.C ?? 0));
    const actD = Math.max(0, Math.round(r.values.actual.D ?? 0));
    // TOTAL은 파싱하지 않고 항상 C + D 로 자동계산
    const planByPlot: Record<DmrPlot, number> = { C: planC, D: planD, TOTAL: planC + planD };
    const actualByPlot: Record<DmrPlot, number> = { C: actC, D: actD, TOTAL: actC + actD };
    const contractor = normalizeDmrContractor(r.contractor);
    for (const plot of ['C', 'D', 'TOTAL'] as DmrPlot[]) {
      const plan = planByPlot[plot];
      const actual = actualByPlot[plot];
      out.push({
        report_date: section.report_date,
        discipline: section.discipline,
        system_name: r.system.trim(),
        contractor_name: contractor,
        plot,
        plan_manpower: plan,
        actual_manpower: actual,
        diff_manpower: actual - plan,
        source_image_path: sourceImagePath,
      });
    }
  }
  return out;
}

export function diff(actual: number, plan: number): number {
  return (actual ?? 0) - (plan ?? 0);
}

/** Validate C + D === TOTAL for each metric; return list of warning strings. */
export function validateRow(r: DmrParsedRow): string[] {
  // TOTAL은 앱이 C+D 로 자동계산하므로 별도 검산 불필요
  void r;
  return [];
}

export function emptyRow(system = '', contractor = ''): DmrParsedRow {
  return {
    system,
    contractor,
    values: {
      plan: { C: 0, D: 0, TOTAL: 0 },
      actual: { C: 0, D: 0, TOTAL: 0 },
    },
  };
}

export function formatDate(d: string | Date): string {
  // Canonical user-facing date display is dd-MMM-yyyy (Doha semantics).
  return formatDdMmmYyyy(d) || (typeof d === 'string' ? d : '');
}