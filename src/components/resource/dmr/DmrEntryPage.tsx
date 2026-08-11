import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save, Download, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { todayInDoha } from '@/lib/time/doha';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDmrSystemMaster, useDmrContractorMaster, useInvalidateDmr } from '@/hooks/useDmrEntries';
import { saveDmrTaskEntries } from '@/lib/dmr-task-entry.functions';
import { exportDmrTeamWorkbook } from '@/lib/dmr/export-dmr-team';
import { DMR_HEADCOUNT_KINDS, DMR_HEADCOUNT_KIND_LABEL, dmrDataDateGapDays, type DmrHeadcountKind } from '@/lib/dmr/task-link';

type Discipline = 'ARCH' | 'ELEC' | 'MECH';
const DISCIPLINES: Discipline[] = ['ARCH', 'ELEC', 'MECH'];

interface EntryRow {
  key: string;
  system_name: string;
  contractor_name: string;
  plot: 'C' | 'D';
  task_no: string;
  headcount_kind: DmrHeadcountKind;
  pic_name: string;
  plan_manpower: string;
  actual_manpower: string;
  /** 서버에서 불러온 행인가 (신규 입력 행과 구분) */
  saved?: boolean;
  /** 저장 당시 박힌 TM 값. 불러온 행은 이 값을 그대로 보여 준다(재계산 금지). */
  snap?: {
    task_name: string | null;
    task_level: string | null;
    work_category: string | null;
    tplan_pct: number | null;
    tactual_pct: number | null;
    task_data_date: string | null;
  };
}

interface TmOption {
  task_no: string;
  task_name: string | null;
  level: string | null;
  row_type: string | null;
  cum_plan_pct: number | null;
  cum_actual_pct: number | null;
  data_date: string | null;
  plot: string | null;
}

let seq = 0;
const newRow = (): EntryRow => ({
  key: `r${++seq}`,
  system_name: '',
  contractor_name: '',
  plot: 'C',
  task_no: '',
  headcount_kind: 'worker',
  pic_name: '',
  plan_manpower: '0',
  actual_manpower: '0',
});

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
      ? options.filter((o) => o.label.toLowerCase().includes(t) || o.value.toLowerCase().includes(t))
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

export function DmrEntryPage() {
  const me = useCurrentUser();
  const canEdit = me.data?.canEdit === true;
  const invalidate = useInvalidateDmr();

  const [reportDate, setReportDate] = useState(todayInDoha());
  const [discipline, setDiscipline] = useState<Discipline>('ARCH');
  const [rows, setRows] = useState<EntryRow[]>([newRow()]);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  const systemsQ = useDmrSystemMaster();
  const contractorsQ = useDmrContractorMaster();

  // 공종 어휘 매핑은 team_master 가 유일한 근거다.
  const teamQ = useQuery({
    queryKey: ['team_master', discipline],
    queryFn: async () => {
      const { data } = await supabase.from('team_master').select('code, aliases').eq('code', discipline).maybeSingle();
      const t = data as any;
      return t ? [String(t.code), ...((t.aliases ?? []) as string[])] : [discipline];
    },
    staleTime: 300_000,
  });

  const tmQ = useQuery({
    queryKey: ['dmr-entry-tm', reportDate, teamQ.data],
    enabled: !!teamQ.data,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc('tm_rows_as_of', { _as_of: reportDate })
        .in('discipline', teamQ.data as string[]);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map<TmOption>((r) => ({
        task_no: String(r.task_no),
        task_name: r.task_name ?? null,
        level: r.level ?? null,
        row_type: r.row_type ?? null,
        cum_plan_pct: r.cum_plan_pct ?? null,
        cum_actual_pct: r.cum_actual_pct ?? null,
        data_date: r.data_date ?? null,
        plot: r.plot ?? null,
      }));
    },
    staleTime: 60_000,
  });

  const tmByNo = useMemo(() => {
    const m = new Map<string, TmOption>();
    for (const t of tmQ.data ?? []) if (!m.has(t.task_no)) m.set(t.task_no, t);
    return m;
  }, [tmQ.data]);

  // 이미 저장된 행을 불러온다 — 저장된 값 그대로. TM 값을 다시 계산하지 않는다.
  const existingQ = useQuery({
    queryKey: ['dmr-entry-existing', reportDate, discipline],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dmr_entries')
        .select('*')
        .eq('report_date', reportDate)
        .eq('discipline', discipline)
        .in('plot', ['C', 'D'])
        .order('system_name')
        .order('contractor_name')
        .order('plot')
        .order('id');
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
    staleTime: 0,
  });

  const loadedKey = `${reportDate}|${discipline}|${existingQ.dataUpdatedAt}`;
  useEffect(() => {
    if (!existingQ.data) return;
    const loaded: EntryRow[] = existingQ.data.map((r) => ({
      key: `s${r.id}`,
      system_name: r.system_name ?? '',
      contractor_name: r.contractor_name ?? '',
      plot: (r.plot === 'D' ? 'D' : 'C') as 'C' | 'D',
      task_no: r.task_no ?? '',
      headcount_kind: (DMR_HEADCOUNT_KINDS.includes(r.headcount_kind) ? r.headcount_kind : 'worker') as DmrHeadcountKind,
      pic_name: r.pic_name ?? '',
      plan_manpower: String(r.plan_manpower ?? 0),
      actual_manpower: String(r.actual_manpower ?? 0),
      saved: true,
      snap: {
        task_name: r.task_name ?? null,
        task_level: r.task_level ?? null,
        work_category: r.work_category ?? null,
        tplan_pct: r.tplan_pct ?? null,
        tactual_pct: r.tactual_pct ?? null,
        task_data_date: r.task_data_date ?? null,
      },
    }));
    setRows(loaded.length > 0 ? loaded : [newRow()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);

  const tmOptions = useMemo(
    () => (tmQ.data ?? []).map((t) => ({ value: t.task_no, label: t.task_no, hint: t.task_name ?? '' })),
    [tmQ.data],
  );
  const systemOptions = useMemo(
    () => (systemsQ.data ?? []).map((s) => ({ value: s.name, label: s.name })),
    [systemsQ.data],
  );
  const contractorOptions = useMemo(
    () => (contractorsQ.data ?? []).map((c) => ({ value: c.name, label: c.name })),
    [contractorsQ.data],
  );

  // (System × Contractor × Plot × 인원종류) 묶음 합계 — 저장하지 않는다
  const groupTotals = useMemo(() => {
    const m = new Map<string, { plan: number; actual: number }>();
    for (const r of rows) {
      const k = `${r.system_name}|${r.contractor_name}|${r.plot}|${r.headcount_kind}`;
      const cur = m.get(k) ?? { plan: 0, actual: 0 };
      cur.plan += Number(r.plan_manpower) || 0;
      cur.actual += Number(r.actual_manpower) || 0;
      m.set(k, cur);
    }
    return m;
  }, [rows]);

  const patch = (key: string, p: Partial<EntryRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const saveFn = useServerFn(saveDmrTaskEntries);

  const valid = rows.filter((r) => r.system_name && r.contractor_name);

  async function onSave() {
    if (!canEdit || valid.length === 0) return;
    setSaving(true);
    setMissing([]);
    try {
      // 사용자가 친 것만 보낸다. TM 파생값은 서버가 다시 읽어 박는다.
      const res: any = await saveFn({
        data: {
          report_date: reportDate,
          discipline,
          entries: valid.map((r) => ({
            system_name: r.system_name,
            contractor_name: r.contractor_name,
            plot: r.plot,
            plan_manpower: Number(r.plan_manpower) || 0,
            actual_manpower: Number(r.actual_manpower) || 0,
            task_no: r.task_no || null,
            headcount_kind: r.headcount_kind,
            pic_name: r.pic_name || null,
          })),
        },
      });
      setMissing(res?.missing_task_nos ?? []);
      invalidate();
      toast.success(`저장 완료 — ${res?.saved ?? valid.length}행 (TM 연결 ${res?.linked_tasks ?? 0}건)`);
    } catch (e: any) {
      toast.error(e?.message ?? '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  async function onExport(d: Discipline) {
    try {
      const r = await exportDmrTeamWorkbook({ discipline: d, reportDate });
      toast.success(`${d} 엑셀 ${r.rowCount}행 내보냄`);
    } catch (e: any) {
      toast.error(e?.message ?? '내보내기 실패');
    }
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">DMR Daily Entry</h1>
            <p className="text-xs text-muted-foreground">출면기록부 작성 — 한 행이 곧 기록 한 건이다</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {DISCIPLINES.map((d) => (
              <Button key={d} variant="outline" size="sm" className="gap-1 text-xs" onClick={() => onExport(d)}>
                <Download className="h-3.5 w-3.5" />{d} 엑셀
              </Button>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">기준일 · 공종</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="h-8 w-40 text-xs" />
            <div className="flex gap-1">
              {DISCIPLINES.map((d) => (
                <Button key={d} size="sm" variant={discipline === d ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setDiscipline(d)}>
                  {d}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              TM 후보 {tmQ.data?.length ?? 0}건 (기준일 {reportDate})
            </span>
          </CardContent>
        </Card>

        {!canEdit && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            읽기 전용입니다. 저장은 senior_user 이상만 가능합니다.
          </div>
        )}

        {missing.length > 0 && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
            TM 에서 찾지 못한 코드: {missing.join(', ')} — 해당 행은 TM 값 없이 저장되었습니다.
          </div>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">입력 표 ({rows.length}행)</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setRows((p) => [...p, newRow()])}>
                <Plus className="h-3.5 w-3.5" />행 추가
              </Button>
              <Button size="sm" className="h-8 gap-1 text-xs" disabled={!canEdit || saving || valid.length === 0} onClick={onSave}>
                <Save className="h-3.5 w-3.5" />{saving ? '저장 중…' : '저장'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[1200px] text-xs">
              <thead className="bg-muted/50">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                  <th>System</th><th>Contractor</th><th>Plot</th><th>TM Code</th>
                  <th>인원종류</th><th>담당자</th><th>계획</th><th>실제</th><th>묶음 합계</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tm = r.task_no ? tmByNo.get(r.task_no) : null;
                  const gap = tm?.data_date
                    ? dmrDataDateGapDays({ report_date: reportDate, task_data_date: tm.data_date })
                    : null;
                  const plotMismatch = !!tm && !!tm.plot && tm.plot !== r.plot;
                  const g = groupTotals.get(`${r.system_name}|${r.contractor_name}|${r.plot}|${r.headcount_kind}`);
                  return (
                    <tr key={r.key} className="border-t align-top [&>td]:px-2 [&>td]:py-1.5">
                      <td className="w-52"><SearchSelect value={r.system_name} options={systemOptions} onChange={(v) => patch(r.key, { system_name: v })} placeholder="System 선택" /></td>
                      <td className="w-52"><SearchSelect value={r.contractor_name} options={contractorOptions} onChange={(v) => patch(r.key, { contractor_name: v })} placeholder="Contractor 선택" /></td>
                      <td>
                        <div className="flex gap-1">
                          {(['C', 'D'] as const).map((p) => (
                            <Button key={p} size="sm" variant={r.plot === p ? 'default' : 'outline'} className="h-7 w-8 p-0 text-xs" onClick={() => patch(r.key, { plot: p })}>{p}</Button>
                          ))}
                        </div>
                      </td>
                      <td className="w-72">
                        <SearchSelect value={r.task_no} options={tmOptions} onChange={(v) => patch(r.key, { task_no: v })} placeholder="TM Code 선택" />
                        {tm && (
                          <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                            <div className="truncate">{tm.task_name ?? '—'}</div>
                            <div>
                              {tm.level ?? '—'} · Work Type {tm.row_type ?? '—'} · 계획 {tm.cum_plan_pct ?? '—'}% · 실적 {tm.cum_actual_pct ?? '—'}%
                            </div>
                            <div>Data Date {tm.data_date ?? '—'}</div>
                            {gap != null && gap !== 0 && (
                              <Badge variant="destructive" className="gap-1 text-[10px]">
                                <AlertTriangle className="h-3 w-3" />Data Date 격차 {gap}일
                              </Badge>
                            )}
                            {plotMismatch && (
                              <div className="text-amber-600">경고: TM Plot {tm.plot} ≠ 입력 Plot {r.plot}</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="flex gap-1">
                          {DMR_HEADCOUNT_KINDS.map((k) => (
                            <Button key={k} size="sm" variant={r.headcount_kind === k ? 'default' : 'outline'} className="h-7 px-2 text-[11px]" onClick={() => patch(r.key, { headcount_kind: k })}>
                              {DMR_HEADCOUNT_KIND_LABEL[k]}
                            </Button>
                          ))}
                        </div>
                      </td>
                      <td className="w-32"><Input value={r.pic_name} onChange={(e) => patch(r.key, { pic_name: e.target.value })} className="h-8 text-xs" /></td>
                      <td className="w-20"><Input type="number" min={0} value={r.plan_manpower} onChange={(e) => patch(r.key, { plan_manpower: e.target.value })} className="h-8 text-xs" /></td>
                      <td className="w-20"><Input type="number" min={0} value={r.actual_manpower} onChange={(e) => patch(r.key, { actual_manpower: e.target.value })} className="h-8 text-xs" /></td>
                      <td className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {g ? `계획 ${g.plan} / 실제 ${g.actual}` : '—'}
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setRows((p) => (p.length > 1 ? p.filter((x) => x.key !== r.key) : p))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
