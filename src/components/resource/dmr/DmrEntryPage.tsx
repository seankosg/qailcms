import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Plus, Save, Download, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { todayInDoha } from '@/lib/time/doha';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDmrSystemMaster, useDmrContractorMaster, useInvalidateDmr } from '@/hooks/useDmrEntries';
import { saveDmrTaskEntries } from '@/lib/dmr-task-entry.functions';
import { exportDmrTeamWorkbook } from '@/lib/dmr/export-dmr-team';
import {
  DMR_HEADCOUNT_KINDS,
  dmrDataDateGapDays,
  buildDmrPrevSnapshotMap,
  dmrSegmentDelta,
  dmrSegmentDays,
} from '@/lib/dmr/task-link';

type Discipline = 'ARCH' | 'ELEC' | 'MECH';
const DISCIPLINES: Discipline[] = ['ARCH', 'ELEC', 'MECH'];

/**
 * 작성 표는 TM 코드에서 시작한다. Work Type · Plot · 담당자 · 진도율은 코드에서 따라온다.
 * 화면 1행 = 인원종류 3건(worker/foreman/supervisor). 0 인 종류도 반드시 함께 보낸다.
 * 계획 인원은 화면에서 받지 않는다(서버로는 항상 0).
 */
export interface EntryRow {
  key: string;
  task_no: string;
  system_name: string;
  contractor_name: string;
  plot: 'C' | 'D';
  pic_name: string;
  worker: string;
  foreman: string;
  supervisor: string;
  saved?: boolean;
  /** 파싱(엑셀·이미지)으로 채워 넣은 행 */
  imported?: boolean;
  /** TM 에서 코드를 찾지 못한 파싱 행 */
  unmatched?: boolean;
  /** 저장 당시 박힌 TM 값 — 불러온 행은 재계산하지 않는다 */
  snap?: {
    task_name: string | null;
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
  effective_pic: string | null;
  original_pic: string | null;
  is_delegated: boolean | null;
}

let seq = 0;
export const newEntryRow = (init: Partial<EntryRow> = {}): EntryRow => ({
  key: `r${++seq}`,
  task_no: '',
  system_name: '',
  contractor_name: '',
  plot: 'C',
  pic_name: '',
  worker: '0',
  foreman: '0',
  supervisor: '0',
  ...init,
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

export function DmrEntryPage() {
  const me = useCurrentUser();
  const canEdit = me.data?.canEdit === true;
  const invalidate = useInvalidateDmr();

  const [reportDate, setReportDate] = useState(todayInDoha());
  const [discipline, setDiscipline] = useState<Discipline>('ARCH');
  const [rows, setRows] = useState<EntryRow[]>([newEntryRow()]);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const dirtyRef = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);

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
        effective_pic: r.effective_pic ?? null,
        original_pic: r.original_pic ?? null,
        is_delegated: r.is_delegated ?? null,
      }));
    },
    staleTime: 60_000,
  });

  const tmByNo = useMemo(() => {
    const m = new Map<string, TmOption>();
    for (const t of tmQ.data ?? []) if (!m.has(t.task_no)) m.set(t.task_no, t);
    return m;
  }, [tmQ.data]);

  // 이미 저장된 행 — 저장된 값 그대로. (task_no·System·Contractor·Plot) 묶음의 3행을 1행으로 되접는다.
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

  // 직전 기록 — 화면에서 한 번만 부른다. 코드마다 따로 부르지 않는다.
  const prevQ = useQuery({
    queryKey: ['dmr-entry-prev', reportDate, discipline],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dmr_entries')
        .select('task_no, report_date, tplan_pct, tactual_pct')
        .eq('discipline', discipline)
        .lt('report_date', reportDate)
        .not('task_no', 'is', null)
        .order('report_date', { ascending: false })
        .limit(20000);
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
    staleTime: 60_000,
  });

  const prevMap = useMemo(
    () => buildDmrPrevSnapshotMap((prevQ.data ?? []) as any[], reportDate),
    [prevQ.data, reportDate],
  );

  const loadedKey = `${reportDate}|${discipline}|${reloadTick}`;
  useEffect(() => {
    if (!existingQ.data) return;
    if (dirtyRef.current) return; // 미저장 변경 보호
    const byGroup = new Map<string, EntryRow>();
    for (const r of existingQ.data) {
      const gk = `${r.task_no ?? ''}|${r.system_name ?? ''}|${r.contractor_name ?? ''}|${r.plot === 'D' ? 'D' : 'C'}`;
      let row = byGroup.get(gk);
      if (!row) {
        row = newEntryRow({
          key: `s${gk}`,
          task_no: r.task_no ?? '',
          system_name: r.system_name ?? '',
          contractor_name: r.contractor_name ?? '',
          plot: (r.plot === 'D' ? 'D' : 'C') as 'C' | 'D',
          pic_name: r.pic_name ?? '',
          saved: true,
          snap: {
            task_name: r.task_name ?? null,
            work_category: r.work_category ?? null,
            tplan_pct: r.tplan_pct ?? null,
            tactual_pct: r.tactual_pct ?? null,
            task_data_date: r.task_data_date ?? null,
          },
        });
        byGroup.set(gk, row);
      }
      const kind = DMR_HEADCOUNT_KINDS.includes(r.headcount_kind) ? r.headcount_kind : 'worker';
      (row as any)[kind] = String(r.actual_manpower ?? 0);
      if (!row.pic_name && r.pic_name) row.pic_name = r.pic_name;
    }
    const loaded = [...byGroup.values()];
    setRows(loaded.length > 0 ? loaded : [newEntryRow()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, existingQ.data]);

  useEffect(() => {
    dirtyRef.current = false;
  }, [reportDate, discipline]);

  const tmOptions = useMemo(
    () => (tmQ.data ?? []).map((t) => ({ value: t.task_no, label: t.task_no, hint: t.task_name ?? '' })),
    [tmQ.data],
  );
  const contractorOptions = useMemo(
    () => (contractorsQ.data ?? []).map((c) => ({ value: c.name, label: c.name })),
    [contractorsQ.data],
  );

  const patch = (key: string, p: Partial<EntryRow>) => {
    dirtyRef.current = true;
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };

  /** TM 코드를 고르면 Work Type · Plot · 담당자가 따라온다. 추정하지 않는다. */
  const pickTask = (key: string, taskNo: string) => {
    const t = taskNo ? tmByNo.get(taskNo) : null;
    patch(key, {
      task_no: taskNo,
      unmatched: false,
      ...(t
        ? {
            plot: (t.plot === 'D' ? 'D' : t.plot === 'C' ? 'C' : undefined) as any,
            pic_name: t.effective_pic ?? '',
          }
        : {}),
    });
  };

  const addRow = () => {
    dirtyRef.current = true;
    setRows((p) => [...p, newEntryRow()]);
  };

  const saveFn = useServerFn(saveDmrTaskEntries);
  const valid = rows.filter((r) => r.system_name.trim() && r.contractor_name.trim());

  async function onSave() {
    if (!canEdit || valid.length === 0) return;
    setSaving(true);
    setMissing([]);
    try {
      // 화면 1행 → 인원종류 3건. 0 인 종류도 함께 보낸다(3→0 정정이 반영되어야 한다).
      const entries = valid.flatMap((r) =>
        DMR_HEADCOUNT_KINDS.map((kind) => ({
          system_name: r.system_name.trim(),
          contractor_name: r.contractor_name.trim(),
          plot: r.plot,
          plan_manpower: 0,
          actual_manpower: Number((r as any)[kind]) || 0,
          task_no: r.task_no || null,
          headcount_kind: kind,
          pic_name: r.pic_name || null,
        })),
      );
      const res: any = await saveFn({ data: { report_date: reportDate, discipline, entries } });
      setMissing(res?.missing_task_nos ?? []);
      invalidate();
      dirtyRef.current = false;
      await Promise.all([existingQ.refetch(), prevQ.refetch()]);
      setReloadTick((t) => t + 1);
      toast.success(`저장 완료 — ${valid.length}행 / ${entries.length}건 (TM 연결 ${res?.linked_tasks ?? 0}건)`);
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

  const unmatchedCount = rows.filter((r) => r.unmatched).length;

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">DMR Daily Entry</h1>
            <p className="text-xs text-muted-foreground">출면기록부 작성 — TM 코드에서 시작한다</p>
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
            <span className="text-xs text-muted-foreground">TM 후보 {tmQ.data?.length ?? 0}건 (기준일 {reportDate})</span>
            <span className="text-xs text-muted-foreground">
              {existingQ.isFetching ? '저장된 행 불러오는 중…' : `저장된 묶음 ${rows.filter((r) => r.saved).length}행`}
            </span>
          </CardContent>
        </Card>

        {!canEdit && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            읽기 전용입니다. 저장은 senior_user 이상만 가능합니다.
          </div>
        )}

        {unmatchedCount > 0 && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
            불러온 행 중 TM 에서 찾지 못한 코드 {unmatchedCount}건 — 코드 칸이 비어 있습니다. 직접 고르십시오.
          </div>
        )}

        {missing.length > 0 && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
            TM 에서 찾지 못한 코드: {missing.join(', ')} — 해당 행은 TM 값 없이 저장되었습니다.
          </div>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">입력 표 ({rows.length}행 · 저장 시 {rows.length * 3}건)</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" />행 추가
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1 text-xs"
                disabled={!canEdit || saving || existingQ.isFetching || valid.length === 0}
                onClick={onSave}
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? '저장 중…' : existingQ.isFetching ? '불러오는 중…' : '저장'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <datalist id="dmr-system-suggestions">
              {(systemsQ.data ?? []).map((s) => <option key={s.name} value={s.name} />)}
            </datalist>
            <table className="w-full min-w-[1500px] text-xs">
              <thead className="bg-muted/50">
                <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                  <th>TM Code</th><th>Work Type</th><th>당일 계획%</th><th>당일 실적%</th>
                  <th>Worker</th><th>Foreman</th><th>Supervisor</th><th>총합</th>
                  <th>System</th><th>Contractor</th><th>Plot</th><th>담당자</th>
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
                  const prev = r.task_no ? prevMap.get(r.task_no) : undefined;
                  // 계획·실적 증분은 같은 직전 행을 기준으로 잡는다.
                  const dPlan = dmrSegmentDelta(tm?.cum_plan_pct ?? null, prev?.tplan_pct);
                  const dActual = dmrSegmentDelta(tm?.cum_actual_pct ?? null, prev?.tactual_pct);
                  const segDays = dmrSegmentDays(reportDate, prev?.report_date);
                  const total =
                    (Number(r.worker) || 0) + (Number(r.foreman) || 0) + (Number(r.supervisor) || 0);
                  const delegated = !!tm?.is_delegated && !!tm?.original_pic && tm.original_pic !== tm.effective_pic;
                  return (
                    <tr
                      key={r.key}
                      className={`border-t align-top [&>td]:px-2 [&>td]:py-1.5 ${
                        r.unmatched ? 'bg-destructive/10' : r.imported ? 'bg-sky-500/10' : r.saved ? 'bg-muted/30' : ''
                      }`}
                    >
                      <td className="w-72">
                        <div className="mb-1 flex gap-1">
                          <Badge variant={r.saved ? 'secondary' : 'outline'} className="text-[10px]">
                            {r.saved ? '저장됨' : '신규'}
                          </Badge>
                          {r.imported && <Badge variant="outline" className="text-[10px]">불러온 값</Badge>}
                          {r.unmatched && <Badge variant="destructive" className="text-[10px]">TM 코드 없음</Badge>}
                        </div>
                        <SearchSelect
                          value={r.task_no}
                          options={tmOptions}
                          onChange={(v) => pickTask(r.key, v)}
                          placeholder="TM Code 선택"
                        />
                        {tm && (
                          <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                            <div className="truncate">{tm.task_name ?? '—'}</div>
                            <div>누계 계획 {pctText(tm.cum_plan_pct) || '—'} · 누계 실적 {pctText(tm.cum_actual_pct) || '—'}</div>
                            <div>Data Date {tm.data_date ?? '—'}</div>
                            {gap != null && gap !== 0 && (
                              <Badge variant="destructive" className="gap-1 text-[10px]">
                                <AlertTriangle className="h-3 w-3" />Data Date 격차 {gap}일
                              </Badge>
                            )}
                            {plotMismatch && <div className="text-amber-600">경고: TM Plot {tm.plot} ≠ 입력 Plot {r.plot}</div>}
                          </div>
                        )}
                      </td>
                      <td className="w-24 whitespace-nowrap">{tm?.row_type ?? '—'}</td>
                      <td className="w-32 whitespace-nowrap">
                        <div>{dPlan == null ? <span className="text-muted-foreground">—</span> : pctText(dPlan)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {prev ? `직전 기록 ${prev.report_date}${segDays != null ? ` (${segDays}일)` : ''}` : '직전 기록 없음'}
                        </div>
                      </td>
                      <td className="w-32 whitespace-nowrap">
                        <div>{dActual == null ? <span className="text-muted-foreground">—</span> : pctText(dActual)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {prev ? `직전 기록 ${prev.report_date}${segDays != null ? ` (${segDays}일)` : ''}` : '직전 기록 없음'}
                        </div>
                      </td>
                      <td className="w-20"><Input type="number" min={0} value={r.worker} onChange={(e) => patch(r.key, { worker: e.target.value })} className="h-8 text-xs" /></td>
                      <td className="w-20"><Input type="number" min={0} value={r.foreman} onChange={(e) => patch(r.key, { foreman: e.target.value })} className="h-8 text-xs" /></td>
                      <td className="w-20"><Input type="number" min={0} value={r.supervisor} onChange={(e) => patch(r.key, { supervisor: e.target.value })} className="h-8 text-xs" /></td>
                      <td className="w-14 font-medium">{total}</td>
                      <td className="w-52">
                        <Input
                          list="dmr-system-suggestions"
                          value={r.system_name}
                          onChange={(e) => patch(r.key, { system_name: e.target.value })}
                          placeholder="System (제안 목록에서 고르거나 직접 입력)"
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="w-52">
                        <SearchSelect
                          value={r.contractor_name}
                          options={contractorOptions}
                          onChange={(v) => patch(r.key, { contractor_name: v })}
                          placeholder="Contractor 선택"
                        />
                      </td>
                      <td>
                        <div className="flex gap-1">
                          {(['C', 'D'] as const).map((p) => (
                            <Button key={p} size="sm" variant={r.plot === p ? 'default' : 'outline'} className="h-7 w-8 p-0 text-xs" onClick={() => patch(r.key, { plot: p })}>{p}</Button>
                          ))}
                        </div>
                      </td>
                      <td className="w-40">
                        <Input value={r.pic_name} onChange={(e) => patch(r.key, { pic_name: e.target.value })} className="h-8 text-xs" />
                        {delegated && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {tm?.effective_pic} (←{tm?.original_pic})
                          </div>
                        )}
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
