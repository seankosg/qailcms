import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Plus, Save, AlertTriangle } from 'lucide-react';
import { dmrDataDateGapDays } from '@/lib/dmr/task-link';
import type { EntryRow, TmOption } from './entry-types';

function SearchSelect({
  value, options, onChange, placeholder, width = 'w-full', disabled,
}: {
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
  placeholder: string;
  width?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? options.filter((o) => o.label.toLowerCase().includes(t) || (o.hint ?? '').toLowerCase().includes(t))
      : options;
    return list.slice(0, 300);
  }, [q, options]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className={`${width} justify-start truncate text-xs font-normal`}>
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" className="mb-2 h-8 text-xs" />
        <ScrollArea className="h-64">
          <div className="space-y-0.5">
            {filtered.length === 0 && <p className="p-2 text-xs text-muted-foreground">결과 없음</p>}
            {filtered.map((o, i) => (
              <button
                key={`${o.value}#${i}`}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}
                className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
              >
                <span className="font-medium">{o.label}</span>
                {o.hint && <span className="ml-2 text-muted-foreground">{o.hint}</span>}
              </button>
            ))}
          </div>
        </ScrollArea>
        {value && (
          <Button variant="ghost" size="sm" className="mt-1 h-7 w-full text-xs" onClick={() => { onChange(''); setOpen(false); }}>
            선택 해제
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

const pctText = (v: number | null) => (v == null ? '' : `${Math.round(v * 10) / 10}%`);

export interface DmrEntryRecordCardProps {
  reportDate: string;
  discipline: string;
  rows: EntryRow[];
  tmByNo: Map<string, TmOption>;
  tmOptions: { value: string; label: string; hint?: string }[];
  contractorOptions: { value: string; label: string }[];
  systemOptions: string[];
  canEdit: boolean;
  saving: boolean;
  loading: boolean;
  validCount: number;
  onPatch: (key: string, patch: Partial<EntryRow>) => void;
  onPickTask: (key: string, taskNo: string) => void;
  onAddRow: () => void;
  onSave: () => void;
}

/** Daily Entry Record — 입력 표 하나만 다룬다. 생산성 분석과 섞지 않는다. */
export function DmrEntryRecordCard({
  reportDate, discipline, rows, tmByNo, tmOptions, contractorOptions, systemOptions,
  canEdit, saving, loading, validCount, onPatch, onPickTask, onAddRow, onSave,
}: DmrEntryRecordCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Daily Entry Record ({rows.length}행 · 저장 시 {rows.length * 3}건)</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={onAddRow}>
            <Plus className="h-3.5 w-3.5" />행 추가
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1 text-xs"
            disabled={!canEdit || saving || loading || validCount === 0}
            onClick={onSave}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '저장 중…' : loading ? '불러오는 중…' : '저장'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <datalist id="dmr-system-suggestions">
          {systemOptions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <table className="w-full min-w-[1700px] text-xs">
          <thead className="bg-muted/50">
            <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
              <th>Plot</th><th>Team</th><th>Task No (TM Code)</th><th>Task / Subtask</th>
              <th>HDEC PIC</th><th>Work Type</th><th>Sub Contractor</th><th>System</th>
              <th>TC Plan %</th><th>TC Actual %</th>
              <th>Worker</th><th>Foreman</th><th>Supervisor</th><th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const live = r.task_no ? tmByNo.get(r.task_no) : null;
              const tm = r.saved && r.snap
                ? {
                    task_name: r.snap.task_name,
                    row_type: r.snap.work_category,
                    cum_plan_pct: r.snap.tplan_pct,
                    cum_actual_pct: r.snap.tactual_pct,
                    data_date: r.snap.task_data_date,
                    plot: live?.plot ?? null,
                    effective_pic: live?.effective_pic ?? null,
                    original_pic: live?.original_pic ?? null,
                    is_delegated: live?.is_delegated ?? null,
                  }
                : live;
              const gap = tm?.data_date
                ? dmrDataDateGapDays({ report_date: reportDate, task_data_date: tm.data_date })
                : null;
              const plotMismatch = !!tm && !!tm.plot && tm.plot !== r.plot;
              // 증분은 서버 정본(tm_rows_as_of)의 기준일 하루치 값만 쓴다.
              const dPlan = live?.tc_plan_pct ?? null;
              const dActual = live?.tc_actual_pct ?? null;
              const total = (Number(r.worker) || 0) + (Number(r.foreman) || 0) + (Number(r.supervisor) || 0);
              const delegated = !!tm?.is_delegated && !!tm?.original_pic && tm.original_pic !== tm.effective_pic;
              return (
                <tr
                  key={r.key}
                  className={`border-t align-top [&>td]:px-2 [&>td]:py-1.5 ${
                    r.unmatched ? 'bg-destructive/10' : r.imported ? 'bg-sky-500/10' : r.saved ? 'bg-muted/30' : ''
                  }`}
                >
                  <td className="w-20">
                    <div className="flex gap-1">
                      {(['C', 'D'] as const).map((p) => (
                        <Button key={p} size="sm" variant={r.plot === p ? 'default' : 'outline'} className="h-7 w-8 p-0 text-xs" onClick={() => onPatch(r.key, { plot: p })}>{p}</Button>
                      ))}
                    </div>
                    {plotMismatch && <div className="mt-0.5 text-[10px] text-amber-600">TM Plot {tm?.plot}</div>}
                  </td>
                  <td className="w-16 whitespace-nowrap">{discipline}</td>
                  <td className="w-64">
                    <div className="mb-1 flex flex-wrap gap-1">
                      {r.unmatched && <Badge variant="destructive" className="text-[10px]">TM 코드 없음</Badge>}
                      {r.multiCode && (
                        <Badge variant="outline" className="border-amber-500 text-[10px] text-amber-600">복수 코드</Badge>
                      )}
                    </div>
                    <SearchSelect
                      value={r.task_no}
                      options={tmOptions}
                      onChange={(v) => onPickTask(r.key, v)}
                      placeholder="TM Code 선택"
                    />
                  </td>
                  <td className="w-64"><div className="truncate">{tm?.task_name ?? '—'}</div></td>
                  <td className="w-40">
                    <Input value={r.pic_name} onChange={(e) => onPatch(r.key, { pic_name: e.target.value })} className="h-8 text-xs" />
                    {delegated && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {tm?.effective_pic} (←{tm?.original_pic})
                      </div>
                    )}
                  </td>
                  <td className="w-24 whitespace-nowrap">{tm?.row_type ?? '—'}</td>
                  <td className="w-52">
                    <SearchSelect
                      value={r.contractor_name}
                      options={contractorOptions}
                      onChange={(v) => onPatch(r.key, { contractor_name: v })}
                      placeholder="Contractor 선택"
                    />
                  </td>
                  <td className="w-52">
                    <Input
                      list="dmr-system-suggestions"
                      value={r.system_name}
                      onChange={(e) => onPatch(r.key, { system_name: e.target.value })}
                      placeholder="System"
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="w-28 whitespace-nowrap">
                    <div>{dPlan == null ? <span className="text-muted-foreground">—</span> : pctText(dPlan)}</div>
                    <div className="text-[10px] text-muted-foreground">{reportDate} 하루치</div>
                  </td>
                  <td className="w-28 whitespace-nowrap">
                    <div>{dActual == null ? <span className="text-muted-foreground">—</span> : pctText(dActual)}</div>
                    <div className="text-[10px] text-muted-foreground">{reportDate} 하루치</div>
                  </td>
                  <td className="w-20"><Input type="number" min={0} value={r.worker} onChange={(e) => onPatch(r.key, { worker: e.target.value })} className="h-8 text-xs" /></td>
                  <td className="w-20"><Input type="number" min={0} value={r.foreman} onChange={(e) => onPatch(r.key, { foreman: e.target.value })} className="h-8 text-xs" /></td>
                  <td className="w-20"><Input type="number" min={0} value={r.supervisor} onChange={(e) => onPatch(r.key, { supervisor: e.target.value })} className="h-8 text-xs" /></td>
                  <td className="w-14 font-medium">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
