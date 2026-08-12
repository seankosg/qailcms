import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp, Plus, RefreshCcw, Save, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
  if (r.task_name?.trim()) return r.task_name.trim();
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
/** 선택 칸 너비 — 항상 맨 왼쪽 고정 */
const SELECT_COL_W = 76;

interface Layout { order: string[]; visibility: Record<string, boolean>; frozen: string[] }

/** 임의 객체를 Layout 형태로 정규화한다 (서버/로컬 공통). */
function normalizeLayout(p: Partial<Layout> | null | undefined): Layout {
  const order = Array.isArray(p?.order) ? p!.order.filter((k) => DEFAULT_ORDER.includes(k)) : [];
  for (const k of DEFAULT_ORDER) if (!order.includes(k)) order.push(k);
  return {
    order,
    visibility: p?.visibility && typeof p.visibility === 'object' ? p.visibility : {},
    frozen: Array.isArray(p?.frozen) ? p!.frozen.filter((k) => DEFAULT_ORDER.includes(k)) : [],
  };
}

function loadLayout(): Layout {
  const fallback: Layout = { order: DEFAULT_ORDER, visibility: {}, frozen: [] };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Layout>;
    return normalizeLayout(p);
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
  workTypeOptions: string[];
  canEdit: boolean;
  saving: boolean;
  loading: boolean;
  validCount: number;
  totalCount: number;
  onPatch: (key: string, patch: Partial<EntryRow>) => void;
  onPickTask: (key: string, taskNo: string) => void;
  onAddRow: () => void;
  onSave: () => void;
  /** 선택한 행을 표에서 지운다 (저장 전 편집 상태 기준) */
  onDeleteRows: (keys: string[]) => void;
  /** 행을 위/아래로 한 칸 옮긴다 */
  onMoveRow: (key: string, dir: -1 | 1) => void;
  /** 페이지에 로딩된 내용(로컬 초안)을 삭제한다. DB/Raw Data에는 반영하지 않는다. */
  onReset: () => void;
}

/** Daily Entry Record — 입력 표 하나만 다룬다. 생산성 분석과 섞지 않는다. */
export function DmrEntryRecordCard({
  reportDate, rows, tmByKey, tmOptionsByDiscipline, contractorOptions, systemOptions, workTypeOptions,
  canEdit, saving, loading, validCount, totalCount, onPatch, onPickTask, onAddRow, onSave, onDeleteRows, onMoveRow, onReset,
}: DmrEntryRecordCardProps) {
  const [sorting, setSorting] = useState<SortEntry[]>([]);
  const [layout, setLayout] = useState<Layout>(() => loadLayout());
  const [selected, setSelected] = useState<string[]>([]);

  /** 컬럼 설정은 계정 단위로 서버에 저장한다 (로컬은 캐시 겸 폴백). */
  const columnPref = useUserViewPreference(LAYOUT_KEY);
  const prefAppliedRef = useRef(false);
  useEffect(() => {
    if (prefAppliedRef.current || !columnPref.ready) return;
    prefAppliedRef.current = true;
    if (columnPref.state) setLayout(normalizeLayout(columnPref.state as Partial<Layout>));
  }, [columnPref.ready, columnPref.state]);

  /** Task/Subtask 자유 입력 보조 목록 — TM 명칭을 제안으로만 쓴다 */
  const taskNameOptions = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(tmOptionsByDiscipline)) {
      for (const o of list) if (o.hint?.trim()) set.add(o.hint.trim());
    }
    return [...set].slice(0, 500);
  }, [tmOptionsByDiscipline]);

  useEffect(() => {
    try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* 저장 실패는 무시 */ }
    if (prefAppliedRef.current) columnPref.save(layout as unknown as Record<string, unknown>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  /** 좌측 고정열 먼저, 그 뒤 나머지 순서. 숨김열은 제외. */
  const shownKeys = useMemo(() => {
    const frozen = layout.frozen.filter((k) => layout.visibility[k] !== false);
    const rest = layout.order.filter((k) => !frozen.includes(k) && layout.visibility[k] !== false);
    return [...frozen, ...rest] as SortKey[];
  }, [layout]);

  const stickyLeft = useMemo(() => {
    const map: Record<string, number> = {};
    let acc = SELECT_COL_W; // 선택 칸이 항상 맨 왼쪽에 고정된다
    for (const k of layout.frozen) {
      if (layout.visibility[k] === false) continue;
      map[k] = acc;
      acc += COL_BY_ID[k as SortKey]?.width ?? 120;
    }
    return map;
  }, [layout]);

  const isFrozen = (k: string) => layout.frozen.includes(k) && layout.visibility[k] !== false;

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
        case 'work_type': return (r.work_type?.trim() || (r.saved && r.snap ? r.snap.work_category : live?.row_type)) ?? '';
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
          {selected.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="h-8 gap-1 text-xs"
              onClick={() => {
                onDeleteRows(selected);
                setSelected([]);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />선택 삭제 ({selected.length})
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            title="페이지에 로딩된 내용을 지웁니다 (DB/Raw Data에는 반영되지 않음)"
            onClick={onReset}
          >
            <RefreshCcw className="h-3.5 w-3.5" /> 초기화
          </Button>
          <DmrColumnOrderMenu
            order={layout.order}
            visibility={layout.visibility}
            frozenExtras={layout.frozen}
            labelByKey={COL_LABELS}
            defaultOrder={DEFAULT_ORDER}
            onOrderChange={(order) => setLayout((p) => ({ ...p, order }))}
            onVisibilityChange={(visibility) => setLayout((p) => ({ ...p, visibility }))}
            onFrozenChange={(frozen) => setLayout((p) => ({ ...p, frozen }))}
          />
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
      <CardContent className="p-0">
        <datalist id="dmr-system-suggestions">
          {systemOptions
            .filter((s) => s && String(s).trim())
            .map((s, i) => (
              <option key={`${s}#${i}`} value={s} />
            ))}
        </datalist>
        <datalist id="dmr-task-suggestions">
          {taskNameOptions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <datalist id="dmr-work-type-suggestions">
          {workTypeOptions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <datalist id="dmr-contractor-suggestions">
          {contractorOptions.map((o) => <option key={o.value} value={o.value} />)}
        </datalist>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-xs" style={{ minWidth: SELECT_COL_W + shownKeys.reduce((n, k) => n + (COL_BY_ID[k]?.width ?? 120), 0) }}>
            <thead>
              <tr>
                <th
                  className="sticky top-0 left-0 z-30 border-b bg-muted px-2 py-2 text-left"
                  style={{ width: SELECT_COL_W, minWidth: SELECT_COL_W }}
                >
                  <Checkbox
                    checked={sortedRows.length > 0 && selected.length === sortedRows.length}
                    onCheckedChange={(v) => setSelected(v === true ? sortedRows.map((r) => r.key) : [])}
                    aria-label="전체 선택"
                  />
                </th>
                {shownKeys.map((k) => {
                  const c = COL_BY_ID[k];
                  const idx = sorting.findIndex((s) => s.id === k);
                  const entry = idx >= 0 ? sorting[idx] : null;
                  const frozen = isFrozen(k);
                  return (
                    <th
                      key={k}
                      className={cn(
                        'sticky top-0 z-20 whitespace-nowrap border-b bg-muted px-2 py-2 text-left',
                        frozen && 'z-30',
                      )}
                      style={{ width: c.width, minWidth: c.width, left: frozen ? stickyLeft[k] : undefined, position: frozen ? 'sticky' : undefined }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(k)}
                        title="클릭: 오름차순 → 내림차순 → 해제 (여러 컬럼 클릭 시 순서대로 우선순위)"
                        className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-muted-foreground/10"
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

                const cell = (k: SortKey) => {
                  switch (k) {
                    case 'plot':
                      return (
                        <>
                          <div className="flex gap-1">
                            {(['C', 'D'] as const).map((p) => (
                              <Button key={p} size="sm" variant={r.plot === p ? 'default' : 'outline'} className="h-7 w-8 p-0 text-xs" onClick={() => onPatch(r.key, { plot: p })}>{p}</Button>
                            ))}
                          </div>
                          {plotMismatch && <div className="mt-0.5 text-[10px] text-amber-600">TM Plot {tm?.plot}</div>}
                        </>
                      );
                    case 'discipline':
                      return (
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
                      );
                    case 'task_no':
                      return (
                        <>
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
                        </>
                      );
                    case 'task_name': {
                      const fallback = resolveTaskName({ ...r, task_name: '' }, (r.saved && r.snap ? r.snap.task_name : tm?.task_name) ?? null) ?? '';
                      if (!r.task_no) {
                        return (
                          <Input
                            list="dmr-task-suggestions"
                            value={r.task_name?.trim() ? r.task_name : fallback}
                            onChange={(e) => onPatch(r.key, { task_name: e.target.value })}
                            placeholder="Task / Subtask"
                            className="h-8 text-xs"
                          />
                        );
                      }
                      return <span className="whitespace-nowrap">{fallback || '—'}</span>;
                    }
                    case 'pic_name':
                      return (
                        <>
                          <Input value={r.pic_name} onChange={(e) => onPatch(r.key, { pic_name: e.target.value })} className="h-8 text-xs" />
                          {delegated && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {tm?.effective_pic} (←{tm?.original_pic})
                            </div>
                          )}
                        </>
                      );
                    case 'work_type': {
                      const fallback = (r.saved && r.snap ? r.snap.work_category : tm?.row_type) ?? '';
                      if (!r.task_no) {
                        return (
                          <Input
                            list="dmr-work-type-suggestions"
                            value={r.work_type?.trim() ? r.work_type : fallback}
                            onChange={(e) => onPatch(r.key, { work_type: e.target.value })}
                            placeholder="Work Type"
                            className="h-8 text-xs"
                          />
                        );
                      }
                      return <span className="whitespace-nowrap">{fallback || '—'}</span>;
                    }
                    case 'contractor_name':
                      return (
                        <Input
                          list="dmr-contractor-suggestions"
                          value={r.contractor_name}
                          onChange={(e) => onPatch(r.key, { contractor_name: e.target.value })}
                          placeholder="Sub Contractor"
                          className="h-8 text-xs"
                        />
                      );
                    case 'system_name':
                      return (
                        <Input
                          list="dmr-system-suggestions"
                          autoComplete="on"
                          value={r.system_name}
                          onChange={(e) => onPatch(r.key, { system_name: e.target.value })}
                          placeholder="System (직접 입력 또는 제안 선택)"
                          className="h-8 text-xs"
                        />
                      );
                    case 'tc_plan_pct':
                      return (
                        <>
                          <div>{dPlan == null ? <span className="text-muted-foreground">—</span> : pctText(dPlan)}</div>
                          <div className="text-[10px] text-muted-foreground">{reportDate} 하루치</div>
                        </>
                      );
                    case 'tc_actual_pct':
                      return (
                        <>
                          <div>{dActual == null ? <span className="text-muted-foreground">—</span> : pctText(dActual)}</div>
                          <div className="text-[10px] text-muted-foreground">{reportDate} 하루치</div>
                        </>
                      );
                    case 'manpower':
                      return <Input type="number" min={0} value={r.manpower} onChange={(e) => onPatch(r.key, { manpower: e.target.value })} className="h-8 text-xs" />;
                    default:
                      return null;
                  }
                };

                const rowTone = r.unmatched ? 'bg-destructive/10' : r.imported ? 'bg-sky-500/10' : r.saved ? 'bg-muted/30' : '';
                return (
                  <tr key={r.key} className={cn('border-t align-top', rowTone)}>
                    <td
                      className={cn('sticky left-0 z-10 bg-background px-2 py-1.5')}
                      style={{ width: SELECT_COL_W, minWidth: SELECT_COL_W }}
                    >
                      <div className={cn('-mx-2 -my-1.5 px-2 py-1.5', rowTone)}>
                        <div className="flex items-center gap-1">
                          <Checkbox
                            checked={selected.includes(r.key)}
                            onCheckedChange={(v) =>
                              setSelected((p) => (v === true ? [...new Set([...p, r.key])] : p.filter((k) => k !== r.key)))
                            }
                            aria-label="행 선택"
                          />
                          <div className="flex flex-col">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-4 w-5"
                              title={sorting.length > 0 ? '정렬을 해제해야 이동할 수 있습니다' : '위로 이동'}
                              disabled={sorting.length > 0 || sortedRows.findIndex((x) => x.key === r.key) === 0}
                              onClick={() => onMoveRow(r.key, -1)}
                              aria-label="위로 이동"
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-4 w-5"
                              title={sorting.length > 0 ? '정렬을 해제해야 이동할 수 있습니다' : '아래로 이동'}
                              disabled={sorting.length > 0 || sortedRows.findIndex((x) => x.key === r.key) === sortedRows.length - 1}
                              onClick={() => onMoveRow(r.key, 1)}
                              aria-label="아래로 이동"
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </td>
                    {shownKeys.map((k) => {
                      const c = COL_BY_ID[k];
                      const frozen = isFrozen(k);
                      return (
                        <td
                          key={k}
                          className={cn('px-2 py-1.5', frozen && 'sticky z-10 bg-background')}
                          style={{ width: c.width, minWidth: c.width, left: frozen ? stickyLeft[k] : undefined }}
                        >
                          {frozen && rowTone ? <div className={cn('-mx-2 -my-1.5 px-2 py-1.5', rowTone)}>{cell(k)}</div> : cell(k)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
