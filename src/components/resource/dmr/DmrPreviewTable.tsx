import { useMemo } from 'react';
import type { DmrParsedRow, DmrParsedSection, DmrMetric, DmrPlot } from '@/lib/dmr/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2, Plus } from 'lucide-react';
import { emptyRow, validateRow, diff } from '@/lib/dmr/utils';
import { cn } from '@/lib/utils';

interface Props {
  section: DmrParsedSection;
  onChange: (next: DmrParsedSection) => void;
}

const METRICS: DmrMetric[] = ['plan', 'actual'];
const PLOTS: DmrPlot[] = ['C', 'D', 'TOTAL'];

export function DmrPreviewTable({ section, onChange }: Props) {
  const warnings = useMemo(() => section.rows.flatMap(validateRow), [section]);

  function setRow(idx: number, patch: Partial<DmrParsedRow>) {
    const rows = section.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange({ ...section, rows });
  }
  function setValue(idx: number, m: DmrMetric, p: DmrPlot, v: number) {
    const row = section.rows[idx];
    const nv = Math.max(0, Math.floor(Number(v) || 0));
    const values = { ...row.values, [m]: { ...row.values[m], [p]: nv } };
    setRow(idx, { values });
  }
  function addRow() {
    onChange({ ...section, rows: [...section.rows, emptyRow()] });
  }
  function removeRow(idx: number) {
    onChange({ ...section, rows: section.rows.filter((_, i) => i !== idx) });
  }

  return (
    <div className="space-y-2">
      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-medium">검산 경고 {warnings.length}건</div>
          <ul className="mt-1 max-h-24 list-disc overflow-auto pl-4">
            {warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
            {warnings.length > 8 && <li>… 외 {warnings.length - 8}건</li>}
          </ul>
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th rowSpan={2} className="sticky left-0 z-10 bg-muted/80 px-2 py-1 text-left">System</th>
              <th rowSpan={2} className="px-2 py-1 text-left">Contractor</th>
              {METRICS.map((m) => (
                <th key={m} colSpan={3} className="border-l px-2 py-1 text-center capitalize">{m}</th>
              ))}
              <th rowSpan={2} className="border-l px-2 py-1 text-center">Δ Actual−Plan<br/>(Total)</th>
              <th rowSpan={2} className="border-l px-1"></th>
            </tr>
            <tr>
              {METRICS.flatMap((m) =>
                PLOTS.map((p) => (
                  <th key={`${m}-${p}`} className="border-l px-1 py-0.5 text-center font-normal text-muted-foreground">{p}</th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, idx) => {
              const rw = validateRow(row);
              const d = diff(row.values.actual.TOTAL, row.values.plan.TOTAL);
              return (
                <tr key={idx} className={cn('border-t hover:bg-muted/30', rw.length > 0 && 'bg-amber-500/5')}>
                  <td className="sticky left-0 z-[5] bg-background px-1 py-0.5">
                    <Input value={row.system} onChange={(e) => setRow(idx, { system: e.target.value })} className="h-7 text-xs" />
                  </td>
                  <td className="px-1 py-0.5">
                    <Input value={row.contractor} onChange={(e) => setRow(idx, { contractor: e.target.value })} className="h-7 text-xs" />
                  </td>
                  {METRICS.flatMap((m) =>
                    PLOTS.map((p) => (
                      <td key={`${m}-${p}`} className="border-l px-1 py-0.5">
                        <Input
                          type="number"
                          value={row.values[m][p]}
                          onChange={(e) => setValue(idx, m, p, Number(e.target.value))}
                          className="h-7 w-14 text-right text-xs"
                        />
                      </td>
                    )),
                  )}
                  <td className={cn('border-l px-2 py-0.5 text-center font-medium', d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : 'text-muted-foreground')}>
                    {d > 0 ? `+${d}` : d}
                  </td>
                  <td className="border-l px-1 py-0.5">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeRow(idx)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" onClick={addRow}>
        <Plus className="mr-1 h-3 w-3" /> 행 추가
      </Button>
    </div>
  );
}