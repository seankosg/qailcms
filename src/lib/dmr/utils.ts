import type { DmrParsedRow, DmrParsedSection, DmrEntryRow, DmrDiscipline, DmrPlot, DmrMetric } from './types';

export function flattenSection(section: DmrParsedSection, sourceImagePath?: string) {
  const out: Array<Omit<DmrEntryRow, 'id'> & { source_image_path?: string }> = [];
  for (const r of section.rows) {
    for (const plot of ['C', 'D', 'TOTAL'] as DmrPlot[]) {
      for (const metric of ['target', 'today', 'yesterday'] as DmrMetric[]) {
        out.push({
          report_date: section.report_date,
          discipline: section.discipline,
          system_name: r.system.trim(),
          contractor_name: r.contractor.trim(),
          plot,
          metric,
          manpower: Math.max(0, Math.round(r.values[metric][plot] ?? 0)),
          source_image_path: sourceImagePath,
        });
      }
    }
  }
  return out;
}

export function diff(today: number, yesterday: number): number {
  return (today ?? 0) - (yesterday ?? 0);
}

/** Validate C + D === TOTAL for each metric; return list of warning strings. */
export function validateRow(r: DmrParsedRow): string[] {
  const w: string[] = [];
  for (const m of ['target', 'today', 'yesterday'] as DmrMetric[]) {
    const v = r.values[m];
    if ((v.C ?? 0) + (v.D ?? 0) !== (v.TOTAL ?? 0)) {
      w.push(`${r.system} / ${r.contractor}: ${m} C(${v.C})+D(${v.D}) ≠ TOTAL(${v.TOTAL})`);
    }
  }
  return w;
}

export function emptyRow(system = '', contractor = ''): DmrParsedRow {
  return {
    system,
    contractor,
    values: {
      target: { C: 0, D: 0, TOTAL: 0 },
      today: { C: 0, D: 0, TOTAL: 0 },
      yesterday: { C: 0, D: 0, TOTAL: 0 },
    },
  };
}

export function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return String(d);
  return date.toISOString().slice(0, 10);
}