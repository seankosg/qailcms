import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Save } from 'lucide-react';
import { SortPriorityBadge } from '@/components/common/SortPriorityBadge';
import { DmrColumnOrderMenu } from './DmrColumnOrderMenu';
import { cn } from '@/lib/utils';
import type { EntryRow, TmOption } from './entry-types';

/** 검색 대조용 접기 — 대시·공백·기호를 지운다. "AR-C-06" → "ARC06" */
const foldCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** a 가 b 의 부분수열인가 — "ARC06" 은 "ARCT06" 안에 순서대로 들어 있다. */
function isSubsequence(a: string, b: string) {
  if (!a) return true;
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j++) if (a[i] === b[j]) i++;
  return i === a.length;
}

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
    if (!t) return options.slice(0, 300);
    const folded = foldCode(t);
    const list = options.filter((o) => {
      if (o.label.toLowerCase().includes(t) || (o.hint ?? '').toLowerCase().includes(t)) return true;
      // 중간 마디가 빠진 코드(AR-C-06 ↔ AR-C-T-06)도 찾히게 한다.
      return !!folded && isSubsequence(folded, foldCode(o.label));
    });
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

/** ARCH 는 Task 명칭이 비고 System 만 채워지는 경우가 있다. 그럴 때만 System 값을 Task 로 쓴다. */
function resolveTaskName(r: EntryRow, name: string | null): string | null {
  if (name && String(name).trim()) return name;
  if (r.discipline === 'ARCH' && r.system_name?.trim()) return r.system_name.trim();
  return name;
}

type SortKey =
  | 'plot' | 'discipline' | 'task_no' | 'task_name' | 'pic_name' | 'work_type'
  | 'contractor_name' | 'system_name' | 'tc_plan_pct' | 'tc_actual_pct' | 'manpower';

interface SortEntry { id: SortKey; desc: boolean }

/** 열 정의 — 순서·표시·고정 설정과 정렬 키를 한 곳에서 관리한다. */
const SORT_COLUMNS: { id: SortKey; label: string; width: number }[] = [
  { id: 'plot', label: 'Plot', width: 88 },
  { id: 'discipline', label: 'Team', width: 108 },
  { id: 'task_no', label: 'Task No (TM Code)', width: 260 },
  { id: 'task_name', label: 'Task / Subtask', width: 260 },
  { id: 'pic_name', label: 'HDEC PIC', width: 168 },
  { id: 'work_type', label: 'Work Type', width: 112 },
  { id: 'contractor_name', label: 'Sub Contractor', width: 212 },
  { id: 'system_name', label: 'System', width: 212 },
  { id: 'tc_plan_pct', label: 'TC Plan %', width: 116 },
  { id: 'tc_actual_pct', label: 'TC Actual %', width: 116 },
  { id: 'manpower', label: 'Total', width: 100 },
];

const COL_BY_ID = Object.fromEntries(SORT_COLUMNS.map((c) => [c.id, c])) as Record<SortKey, { id: SortKey; label: string; width: number }>;
const DEFAULT_ORDER: string[] = SORT_COLUMNS.map((c) => c.id);
const COL_LABELS: Record<string, string> = Object.fromEntries(SORT_COLUMNS.map((c) => [c.id, c.label]));
const LAYOUT_KEY = 'dmr-entry-record-columns-v1';

interface Layout { order: string[]; visibility: Record<string, boolean>; frozen: string[] }

function loadLayout(): Layout {
  const fallback: Layout = { order: DEFAULT_ORDER, visibility: {}, frozen: [] };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Layout>;
    const order = Array.isArray(p.order) ? p.order.filter((k) => DEFAULT_ORDER.includes(k)) : [];
    for (const k of DEFAULT_ORDER) if (!order.includes(k)) order.push(k);
    return {
      order,
      visibility: p.visibility && typeof p.visibility === 'object' ? p.visibility : {},
      frozen: Array.isArray(p.frozen) ? p.frozen.filter((k) => DEFAULT_ORDER.includes(k)) : [],
    };
  } catch {
    return fallback;
  }
}

export interface DmrEntryRecordCardProps {
  reportDate: string;
  rows: EntryRow[];
  /** `${discipline}|${task_no}` 키 */
  tmByKey: Map<string, TmOption>;
  tmOptionsByDiscipline: Record<string, { value: string; label: string; hint?: string }[]>;
  contractorOptions: { value: string; label: string }[];
  systemOptions: string[];
  canEdit: boolean;
  saving: boolean;
  loading: boolean;
  validCount: number;
  totalCount: number;
  onPatch: (key: string, patch: Partial<EntryRow>) => void;
  onPickTask: (key: string, taskNo: string) => void;
  onAddRow: () => void;
  onSave: () => void;
}

/** Daily Entry Record — 입력 표 하나만 다룬다. 생산성 분석과 섞지 않는다. */
export function DmrEntryRecordCard({
  reportDate, rows, tmByKey, tmOptionsByDiscipline, contractorOptions, systemOptions,
  canEdit, saving, loading, validCount, totalCount, onPatch, onPickTask, onAddRow, onSave,
}: DmrEntryRecordCardProps) {
  const [sorting, setSorting] = useState<SortEntry[]>([]);

  const toggleSort = (id: SortKey) => {
    setSorting((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      if (i === -1) return [...prev, { id, desc: false }];
      if (!prev[i].desc) {
        const next = [...prev];
        next[i] = { id, desc: true };
        return next;
      }
      return prev.filter((s) => s.id !== id);
    });
  };

  const sortedRows = useMemo(() => {
    // 기본 정렬: 스크린샷에서 불러온 원래 순서. importIndex 없는 행은 뒤로.
    const base = sorting.length === 0
      ? [...rows].sort((a, b) => (a.importIndex ?? Number.MAX_SAFE_INTEGER) - (b.importIndex ?? Number.MAX_SAFE_INTEGER))
      : [...rows];
    if (sorting.length === 0) return base;
    const valueOf = (r: EntryRow, id: SortKey): string | number | null => {
      const live = r.task_no ? tmByKey.get(`${r.discipline}|${r.task_no}`) : null;
      switch (id) {
        case 'plot': return r.plot ?? '';
        case 'discipline': return r.discipline ?? '';
        case 'task_no': return r.task_no ?? '';
        case 'task_name':
          return resolveTaskName(r, (r.saved && r.snap ? r.snap.task_name : live?.task_name) ?? null) ?? '';
        case 'pic_name': return r.pic_name ?? '';
        case 'work_type': return (r.saved && r.snap ? r.snap.work_category : live?.row_type) ?? '';
        case 'contractor_name': return r.contractor_name ?? '';
        case 'system_name': return r.system_name ?? '';
        case 'tc_plan_pct': return live?.tc_plan_pct ?? null;
        case 'tc_actual_pct': return live?.tc_actual_pct ?? null;
        case 'manpower': return r.manpower === '' || r.manpower == null ? null : Number(r.manpower);
        default: return '';
      }
    };
    const cmp = (a: string | number | null, b: string | number | null) => {
      const aEmpty = a === null || a === '';
      const bEmpty = b === null || b === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1; // 빈 값은 항상 뒤로
      if (bEmpty) return -1;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
    };
    return base.sort((ra, rb) => {
      for (const s of sorting) {
        const c = cmp(valueOf(ra, s.id), valueOf(rb, s.id));
        if (c !== 0) return s.desc ? -c : c;
      }
      return 0;
    });
  }, [rows, sorting, tmByKey]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">
          Daily Entry Record (보이는 {rows.length}행 · 전체 {totalCount}행 · 저장 시 {validCount}건)
        </CardTitle>
        <div className="flex gap-2">
          {sorting.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSorting([])}>
              정렬 해제 ({sorting.length})
            </Button>
          )}
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
              {SORT_COLUMNS.map((c) => {
                const idx = sorting.findIndex((s) => s.id === c.id);
                const entry = idx >= 0 ? sorting[idx] : null;
                return (
                  <th key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.id)}
                      title="클릭: 오름차순 → 내림차순 → 해제 (여러 컬럼 클릭 시 순서대로 우선순위)"
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-muted"
                    >
                      <span>{c.label}</span>
                      {entry ? (
                        entry.desc ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUp className="h-3 w-3 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />
                      )}
                      <SortPriorityBadge index={idx} total={sorting.length} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => {
              const live = r.task_no ? tmByKey.get(`${r.discipline}|${r.task_no}`) : null;
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
              const plotMismatch = !!tm && !!tm.plot && tm.plot !== r.plot;
              // 증분은 서버 정본(tm_rows_as_of)의 기준일 하루치 값만 쓴다.
              const dPlan = live?.tc_plan_pct ?? null;
              const dActual = live?.tc_actual_pct ?? null;
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
                  <td className="w-24">
                    <div className="flex gap-0.5">
                      {(['ARCH', 'ELEC', 'MECH'] as const).map((d) => (
                        <Button
                          key={d}
                          size="sm"
                          variant={r.discipline === d ? 'default' : 'outline'}
                          className="h-7 px-1 text-[10px]"
                          disabled={r.saved}
                          onClick={() => onPatch(r.key, { discipline: d, task_no: '' })}
                        >
                          {d}
                        </Button>
                      ))}
                    </div>
                  </td>
                  <td className="w-64">
                    <div className="mb-1 flex flex-wrap gap-1">
                      {r.unmatched && <Badge variant="destructive" className="text-[10px]">TM 코드 없음</Badge>}
                      {r.multiCode && (
                        <Badge variant="outline" className="border-amber-500 text-[10px] text-amber-600">복수 코드</Badge>
                      )}
                    </div>
                    <SearchSelect
                      value={r.task_no}
                      options={tmOptionsByDiscipline[r.discipline] ?? []}
                      onChange={(v) => onPickTask(r.key, v)}
                      placeholder="TM Code 선택"
                    />
                  </td>
                  <td className="w-64">
                    <div className="truncate">{resolveTaskName(r, tm?.task_name ?? null) ?? '—'}</div>
                  </td>
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
                  <td className="w-24"><Input type="number" min={0} value={r.manpower} onChange={(e) => onPatch(r.key, { manpower: e.target.value })} className="h-8 text-xs" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
