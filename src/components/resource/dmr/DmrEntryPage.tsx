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
import { DmrExportDialog } from './DmrExportDialog';
import { DmrEntryRecordCard } from './DmrEntryRecordCard';
import { DmrEntryProductivityCard } from './DmrEntryProductivityCard';
import { newEntryRow, type EntryRow, type TmOption, type DmrDiscipline } from './entry-types';

type Discipline = DmrDiscipline;
const DISCIPLINES: Discipline[] = ['ARCH', 'ELEC', 'MECH'];

/** 화면을 떠났다 돌아와도 작성 중 내용이 남도록 세션에 초안을 둔다. 저장 전까지만 유효하다. */
const DRAFT_KEY = 'dmr-entry-draft-v1';
type Draft = { reportDate: string; view: Discipline | 'ALL'; rows: EntryRow[]; dirty: boolean };
function readDraft(): Draft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || !Array.isArray(d.rows) || d.rows.length === 0) return null;
    return d;
  } catch {
    return null;
  }
}

export type { EntryRow } from './entry-types';
export { newEntryRow } from './entry-types';

export function DmrEntryPage() {
  const me = useCurrentUser();
  const canEdit = me.data?.canEdit === true;
  const invalidate = useInvalidateDmr();

  const draft0 = useRef<Draft | null>(readDraft()).current;
  const [reportDate, setReportDate] = useState(draft0?.reportDate ?? todayInDoha());
  // 공종 탭은 보기 필터일 뿐이다. 하루치 기록은 세 공종이 한 표에 함께 있다.
  const [view, setView] = useState<Discipline | 'ALL'>(draft0?.view ?? 'ALL');
  const discipline: Discipline = view === 'ALL' ? 'ARCH' : view;
  const [rows, setRows] = useState<EntryRow[]>(draft0?.rows ?? [newEntryRow()]);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const dirtyRef = useRef(draft0?.dirty === true);

  // 작성 중 내용은 매 변경마다 세션에 남긴다 (다른 페이지로 갔다 와도 유지).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ reportDate, view, rows, dirty: dirtyRef.current } satisfies Draft),
      );
    } catch {
      /* 저장 공간 초과는 무시한다 */
    }
  }, [reportDate, view, rows, saving]);
  // 스크린샷의 보고일을 자동 반영할 때, 기준일 변경으로 표가 초기화되지 않게 막는다.
  const keepRowsOnDateChangeRef = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);

  const systemsQ = useDmrSystemMaster();
  const contractorsQ = useDmrContractorMaster();

  // 공종 어휘 매핑은 team_master 가 유일한 근거다. 세 공종 모두 읽는다.
  const teamQ = useQuery({
    queryKey: ['team_master', 'dmr-all'],
    queryFn: async () => {
      const { data } = await supabase.from('team_master').select('code, aliases').in('code', DISCIPLINES);
      const map: Record<string, string[]> = {};
      for (const d of DISCIPLINES) {
        const t = (data ?? []).find((x: any) => String(x.code) === d) as any;
        map[d] = t ? [String(t.code), ...((t.aliases ?? []) as string[]).map(String)] : [d];
      }
      return map;
    },
    staleTime: 300_000,
  });

  /** TM 공종 어휘 → DMR 공종 코드 */
  const disciplineOfTerm = useMemo(() => {
    const m = new Map<string, Discipline>();
    for (const d of DISCIPLINES) for (const t of teamQ.data?.[d] ?? []) m.set(String(t).toUpperCase(), d);
    return m;
  }, [teamQ.data]);

  const tmQ = useQuery({
    queryKey: ['dmr-entry-tm', reportDate, teamQ.data],
    enabled: !!teamQ.data,
    queryFn: async () => {
      const terms = DISCIPLINES.flatMap((d) => teamQ.data?.[d] ?? []);
      const { data, error } = await (supabase as any)
        .rpc('tm_rows_as_of', { _as_of: reportDate })
        .in('discipline', terms);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map<TmOption & { _d: string }>((r) => ({
        _d: String(r.discipline ?? '').toUpperCase(),
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

  /** `${공종}|${task_no}` 키 */
  const tmByKey = useMemo(() => {
    const m = new Map<string, TmOption>();
    for (const t of tmQ.data ?? []) {
      const d = disciplineOfTerm.get(t._d);
      if (!d) continue;
      const k = `${d}|${t.task_no}`;
      if (!m.has(k)) m.set(k, t);
    }
    return m;
  }, [tmQ.data, disciplineOfTerm]);

  // 이미 저장된 행 — 저장된 값 그대로. 세 공종을 모두 불러온다.
  const existingQ = useQuery({
    queryKey: ['dmr-entry-existing', reportDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dmr_entries')
        .select('*')
        .eq('report_date', reportDate)
        .in('discipline', DISCIPLINES)
        .in('plot', ['C', 'D'])
        .order('discipline')
        .order('system_name')
        .order('contractor_name')
        .order('plot')
        .order('id');
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
    staleTime: 0,
  });

  const loadedKey = `${reportDate}|${reloadTick}`;
  useEffect(() => {
    if (!existingQ.data) return;
    if (dirtyRef.current) return; // 미저장 변경 보호
    const byGroup = new Map<string, EntryRow>();
    for (const r of existingQ.data) {
      const gk = `${r.discipline ?? 'ARCH'}|${r.task_no ?? ''}|${r.system_name ?? ''}|${r.contractor_name ?? ''}|${r.plot === 'D' ? 'D' : 'C'}`;
      let row = byGroup.get(gk);
      if (!row) {
        row = newEntryRow({
          key: `s${gk}`,
          discipline: (DISCIPLINES.includes(r.discipline) ? r.discipline : 'ARCH') as Discipline,
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
      // 인원 종류 구분은 폐기됐다. 과거 3행 구조도 총원으로 합쳐 1행으로 보인다.
      row.manpower = String((Number(row.manpower) || 0) + (Number(r.actual_manpower) || 0));
      if (!row.pic_name && r.pic_name) row.pic_name = r.pic_name;
    }
    const loaded = [...byGroup.values()];
    setRows(loaded.length > 0 ? loaded : [newEntryRow()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey, existingQ.data]);

  useEffect(() => {
    if (keepRowsOnDateChangeRef.current) {
      keepRowsOnDateChangeRef.current = false;
      return;
    }
    dirtyRef.current = false;
  }, [reportDate]);

  const tmOptionsByDiscipline = useMemo(() => {
    const out: Record<string, { value: string; label: string; hint?: string }[]> = { ARCH: [], ELEC: [], MECH: [] };
    for (const [k, t] of tmByKey) {
      const d = k.split('|')[0];
      (out[d] ??= []).push({ value: t.task_no, label: t.task_no, hint: t.task_name ?? '' });
    }
    return out;
  }, [tmByKey]);
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
    const row = rows.find((r) => r.key === key);
    const t = taskNo && row ? tmByKey.get(`${row.discipline}|${taskNo}`) : null;
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
    setRows((p) => [...p, newEntryRow({ discipline })]);
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
      let addedRows: EntryRow[] = [];
      const warns: string[] = [];
      const teamCount: Record<string, number> = {};
      const sheetDates = new Set<string>();
      let importIndex = 0;
      for (const r of res?.results ?? []) {
        if (!r.section) continue;
        // 시트 제목의 공종이 그 행들의 공종이다 (ELECT → ELEC). 화면의 탭은 보기 필터일 뿐 분류에 쓰지 않는다.
        const secD: Discipline = DISCIPLINES.includes(r.section.discipline as Discipline)
          ? (r.section.discipline as Discipline)
          : discipline;
        if (!DISCIPLINES.includes(r.section.discipline as Discipline)) {
          warns.push(`시트 제목에서 공종을 읽지 못해 ${secD} 로 두었습니다 — 표에서 Team 을 고치십시오`);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(r.section.report_date ?? ''))) sheetDates.add(r.section.report_date);
        const tmForD = new Map<string, TmOption>();
        for (const [k, t] of tmByKey) if (k.startsWith(`${secD}|`)) tmForD.set(t.task_no, t);
        const seeds = buildDmrEntryRowsFromSection(r.section, tmForD, newEntryRow, importIndex);
        importIndex += r.section.rows?.length ?? 0;
        added = [...added, ...seeds];
        addedRows = [...addedRows, ...seeds.map((s) => ({ ...(s as unknown as EntryRow), discipline: secD }))];
        teamCount[secD] = (teamCount[secD] ?? 0) + seeds.length;
      }
      // 보고일은 스크린샷에서 읽어 자동으로 채운다. 사용자가 이어서 고칠 수 있다.
      let appliedDate = reportDate;
      if (sheetDates.size === 1) {
        const d = [...sheetDates][0];
        if (d !== reportDate) {
          appliedDate = d;
          keepRowsOnDateChangeRef.current = true;
          setReportDate(d);
          warns.push(`시트 보고일 ${d} 로 기준일을 맞췄습니다 — 필요하면 직접 고치십시오`);
        }
      } else if (sheetDates.size > 1) {
        warns.push(`시트마다 보고일이 다릅니다 (${[...sheetDates].join(', ')}) — 기준일 ${reportDate} 을 그대로 씁니다`);
      }
      for (const w of warns) toast.warning(w);
      if (added.length === 0) {
        toast.error(errs.length ? `파싱 실패: ${errs[0].error}` : warns.length ? '넣은 행이 없습니다' : '가져온 행이 없습니다');
        return;
      }
      dirtyRef.current = true;
      setRows((prev) => {
        const base = prev.filter((p) => p.saved || p.task_no || p.system_name || p.contractor_name);
        return [...base, ...addedRows];
      });
      const unmatched = added.filter((a) => a.unmatched).length;
      const multi = added.filter((a) => a.multiCode).length;
      const teamText = DISCIPLINES.filter((d) => teamCount[d]).map((d) => `${d} ${teamCount[d]}행`).join(' · ');
      toast.success(
        `불러오기 ${added.length}행 (${teamText}) · 보고일 ${appliedDate} — TM 미매칭 ${unmatched}건 · 복수 코드 ${multi}건${errs.length ? ` · 실패 ${errs.length}건` : ''}. 확인 후 저장하십시오.`,
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
      // 화면 1행 → 저장 1건. 인원 종류 구분 없이 총원 하나만 저장한다.
      // 공종별로 나눠 같은 날짜로 저장한다 — 저장 버튼 한 번이 하루치 전체를 확정한다.
      const missingAll: string[] = [];
      let total = 0;
      let linked = 0;
      for (const d of DISCIPLINES) {
        const part = valid.filter((r) => r.discipline === d);
        if (part.length === 0) continue;
        const entries = part.map((r) => ({
          system_name: r.system_name.trim(),
          contractor_name: r.contractor_name.trim(),
          plot: r.plot,
          plan_manpower: 0,
          actual_manpower: Number(r.manpower) || 0,
          task_no: r.task_no || null,
          headcount_kind: 'worker' as const,
          pic_name: r.pic_name || null,
        }));
        const res: any = await saveFn({ data: { report_date: reportDate, discipline: d, entries } });
        missingAll.push(...(res?.missing_task_nos ?? []));
        linked += res?.linked_tasks ?? 0;
        total += entries.length;
      }
      setMissing([...new Set(missingAll)]);
      invalidate();
      dirtyRef.current = false;
      await existingQ.refetch();
      setReloadTick((t) => t + 1);
      toast.success(`저장 완료 — ${valid.length}행 / ${total}건 (TM 연결 ${linked}건)`);
    } catch (e: any) {
      toast.error(e?.message ?? '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  const [exportOpen, setExportOpen] = useState(false);

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
            <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setExportOpen(true)}>
              <Download className="h-3.5 w-3.5" />
              엑셀 내보내기
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
              {(['ALL', ...DISCIPLINES] as const).map((d) => (
                <Button key={d} size="sm" variant={view === d ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setView(d)}>
                  {d === 'ALL' ? '전체' : d}
                  <span className="ml-1 text-[10px] opacity-70">
                    {d === 'ALL' ? rows.length : rows.filter((r) => r.discipline === d).length}
                  </span>
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
          rows={view === 'ALL' ? rows : rows.filter((r) => r.discipline === view)}
          tmByKey={tmByKey}
          tmOptionsByDiscipline={tmOptionsByDiscipline}
          contractorOptions={contractorOptions}
          systemOptions={systemOptions}
          canEdit={canEdit}
          saving={saving}
          loading={existingQ.isFetching}
          validCount={valid.length}
          totalCount={rows.length}
          onPatch={patch}
          onPickTask={pickTask}
          onAddRow={addRow}
          onSave={() => void onSave()}
        />

        <DmrEntryProductivityCard reportDate={reportDate} />
      </div>
      <DmrExportDialog open={exportOpen} onOpenChange={setExportOpen} defaultDate={reportDate} />
    </>
  );
}
