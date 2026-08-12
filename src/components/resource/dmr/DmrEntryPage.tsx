import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { todayInDoha } from '@/lib/time/doha';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDmrSystemMaster, useDmrContractorMaster, useInvalidateDmr } from '@/hooks/useDmrEntries';
import { saveDmrTaskEntries } from '@/lib/dmr-task-entry.functions';
import { parseDmrImages } from '@/lib/dmr-parse.functions';
import { buildDmrEntryRowsFromSection } from '@/lib/dmr/entry-import';
import { exportDmrTeamsWorkbook } from '@/lib/dmr/export-dmr-team';
import { DMR_HEADCOUNT_KINDS } from '@/lib/dmr/task-link';
import { DmrEntryRecordCard } from './DmrEntryRecordCard';
import { DmrEntryProductivityCard } from './DmrEntryProductivityCard';
import { newEntryRow, type EntryRow, type TmOption } from './entry-types';

type Discipline = 'ARCH' | 'ELEC' | 'MECH';
const DISCIPLINES: Discipline[] = ['ARCH', 'ELEC', 'MECH'];

export type { EntryRow } from './entry-types';
export { newEntryRow } from './entry-types';

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
        tc_plan_pct: r.tc_plan_pct ?? null,
        tc_actual_pct: r.tc_actual_pct ?? null,
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
  const systemOptions = useMemo(() => (systemsQ.data ?? []).map((s) => s.name), [systemsQ.data]);

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
  const parseFn = useServerFn(parseDmrImages);
  const [importing, setImporting] = useState(false);

  /** 스크린샷 → 같은 표의 행으로 채워 넣는다. 자동 저장하지 않는다. */
  async function onImportFiles(files: File[]) {
    if (files.length === 0) return;
    setImporting(true);
    try {
      const storagePaths: string[] = [];
      for (const f of files.slice(0, 3)) {
        const ext = f.name.split('.').pop() || 'png';
        const path = `${me.data?.id ?? 'anon'}/${Date.now()}-entry.${ext}`;
        const up = await supabase.storage.from('dmr-uploads').upload(path, f, { upsert: false });
        if (up.error) throw new Error(up.error.message);
        storagePaths.push(path);
      }
      if (storagePaths.length === 0) {
        toast.error('스크린샷 이미지 파일만 읽을 수 있습니다');
        return;
      }
      const res: any = await parseFn({ data: { storagePaths } });
      const errs = (res?.results ?? []).filter((r: any) => r.error);
      let added: ReturnType<typeof buildDmrEntryRowsFromSection> = [];
      const warns: string[] = [];
      for (const r of res?.results ?? []) {
        if (!r.section) continue;
        // 공종·보고일은 경고용으로만 쓴다. 기준일을 자동으로 바꾸지 않는다.
        if (r.section.discipline && r.section.discipline !== discipline) {
          warns.push(`제목 공종 ${r.section.discipline} — 화면 공종 ${discipline} 과 다릅니다. 넣지 않았습니다`);
          continue;
        }
        if (r.section.report_date && r.section.report_date !== reportDate) {
          warns.push(`시트 보고일 ${r.section.report_date} — 기준일 ${reportDate} 과 다릅니다`);
        }
        added = [...added, ...buildDmrEntryRowsFromSection(r.section, tmByNo, newEntryRow)];
      }
      for (const w of warns) toast.warning(w);
      if (added.length === 0) {
        toast.error(errs.length ? `파싱 실패: ${errs[0].error}` : warns.length ? '넣은 행이 없습니다' : '가져온 행이 없습니다');
        return;
      }
      dirtyRef.current = true;
      setRows((prev) => {
        const base = prev.filter((p) => p.saved || p.task_no || p.system_name || p.contractor_name);
        return [...base, ...added];
      });
      const unmatched = added.filter((a) => a.unmatched).length;
      const multi = added.filter((a) => a.multiCode).length;
      toast.success(
        `불러오기 ${added.length}행 — TM 미매칭 ${unmatched}건 · 복수 코드 ${multi}건${errs.length ? ` · 실패 ${errs.length}건` : ''}. 확인 후 저장하십시오.`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? '불러오기 실패');
    } finally {
      setImporting(false);
    }
  }

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
      await existingQ.refetch();
      setReloadTick((t) => t + 1);
      toast.success(`저장 완료 — ${valid.length}행 / ${entries.length}건 (TM 연결 ${res?.linked_tasks ?? 0}건)`);
    } catch (e: any) {
      toast.error(e?.message ?? '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  const [exporting, setExporting] = useState(false);

  /** 공종 셋을 파일 하나로. 공종은 탭으로 나뉜다. */
  async function onExport() {
    setExporting(true);
    try {
      const r = await exportDmrTeamsWorkbook({ disciplines: [...DISCIPLINES], reportDate });
      toast.success(
        `엑셀 1개 파일 — ${r.byDiscipline.map((b) => `${b.discipline} ${b.rowCount}행`).join(' · ')}`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? '내보내기 실패');
    } finally {
      setExporting(false);
    }
  }

  const unmatchedCount = rows.filter((r) => r.unmatched).length;
  const multiCodeCount = rows.filter((r) => r.multiCode).length;

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">DMR Daily Entry</h1>
            <p className="text-xs text-muted-foreground">출면기록부 작성 — TM 코드에서 시작한다</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => void onExport()} disabled={exporting}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              엑셀 (ARCH·ELEC·MECH 탭)
            </Button>
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
            <label className="ml-auto">
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                disabled={!canEdit || importing}
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? []);
                  e.currentTarget.value = '';
                  void onImportFiles(fs);
                }}
              />
              <span
                className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border px-3 text-xs ${
                  !canEdit || importing ? 'pointer-events-none opacity-50' : 'hover:bg-accent'
                }`}
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importing ? '읽는 중…' : '스크린샷 불러오기'}
              </span>
            </label>
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

        {multiCodeCount > 0 && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            한 줄에 코드가 여럿인 행 {multiCodeCount}건 — 코드마다 같은 인원을 실었습니다. 다르면 직접 고치십시오.
          </div>
        )}

        {missing.length > 0 && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
            TM 에서 찾지 못한 코드: {missing.join(', ')} — 해당 행은 TM 값 없이 저장되었습니다.
          </div>
        )}

        <DmrEntryRecordCard
          reportDate={reportDate}
          discipline={discipline}
          rows={rows}
          tmByNo={tmByNo}
          tmOptions={tmOptions}
          contractorOptions={contractorOptions}
          systemOptions={systemOptions}
          canEdit={canEdit}
          saving={saving}
          loading={existingQ.isFetching}
          validCount={valid.length}
          onPatch={patch}
          onPickTask={pickTask}
          onAddRow={addRow}
          onSave={() => void onSave()}
        />

        <DmrEntryProductivityCard reportDate={reportDate} />
      </div>
    </>
  );
}
