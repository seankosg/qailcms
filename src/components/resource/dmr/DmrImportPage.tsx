import { useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { parseDmrImages } from '@/lib/dmr-parse.functions';
import { saveDmrEntries } from '@/lib/dmr-import.functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loader2, Upload, ImageIcon, CheckCircle2, XCircle, CloudUpload, Sparkles } from 'lucide-react';
import { DmrPreviewTable } from './DmrPreviewTable';
import { DISCIPLINE_LABEL, normalizeDmrContractor, isDmrDirectContractor, type DmrDiscipline, type DmrParsedSection } from '@/lib/dmr/types';
import { flattenSection } from '@/lib/dmr/utils';
import { formatDdMmmYyyy } from '@/lib/time/doha';

const SLOTS: DmrDiscipline[] = ['ARCH', 'ELEC', 'MECH'];

type SlotStage = 'idle' | 'uploading' | 'parsing' | 'done' | 'error';

interface Slot {
  file: File | null;
  previewUrl: string | null;
  storagePath: string | null;
  section: DmrParsedSection | null;
  error: string | null;
  stage: SlotStage;
  progress: number; // 0..100
}

function emptySlot(): Slot {
  return { file: null, previewUrl: null, storagePath: null, section: null, error: null, stage: 'idle', progress: 0 };
}

export function DmrImportPage() {
  const { data: me } = useCurrentUser();
  const canEdit = !!me?.canEdit || !!me?.isAdmin;
  const navigate = useNavigate();
  const parseFn = useServerFn(parseDmrImages);
  const saveFn = useServerFn(saveDmrEntries);

  const [slots, setSlots] = useState<Record<DmrDiscipline, Slot>>({
    ARCH: emptySlot(),
    ELEC: emptySlot(),
    MECH: emptySlot(),
  });
  const [reportDate, setReportDate] = useState<string>('');
  const [overwrite, setOverwrite] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const cancelRequestedRef = useRef(false);
  const requestCancel = () => {
    if (!cancelRequestedRef.current) {
      cancelRequestedRef.current = true;
      setIsCancelling(true);
      toast.warning('취소 요청됨. 진행 중 작업이 완료된 뒤 중단됩니다.');
    }
  };
  const isBusy = parsing || saving;

  function setSlot(d: DmrDiscipline, patch: Partial<Slot>) {
    setSlots((prev) => ({ ...prev, [d]: { ...prev[d], ...patch } }));
  }

  function pickFile(d: DmrDiscipline, f: File | null) {
    const prev = slots[d];
    if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
    setSlot(d, {
      file: f,
      previewUrl: f ? URL.createObjectURL(f) : null,
      storagePath: null,
      section: null,
      error: null,
      stage: 'idle',
      progress: 0,
    });
  }

  async function uploadAndParse() {
    if (!me?.id) { toast.error('로그인이 필요합니다'); return; }
    const active = SLOTS.filter((d) => slots[d].file);
    if (active.length === 0) { toast.error('이미지를 최소 1장 업로드하세요'); return; }

    setParsing(true);
    cancelRequestedRef.current = false;
    setIsCancelling(false);
    try {
      // Reset stages for active slots
      for (const d of active) setSlot(d, { stage: 'uploading', progress: 5, error: null, section: null });

      // 1) Upload each file to storage sequentially, updating per-slot progress
      const uploaded: Array<{ discipline: DmrDiscipline; path: string }> = [];
      for (const d of active) {
        if (cancelRequestedRef.current) {
          setSlot(d, { stage: 'error', progress: 100, error: '사용자 취소' });
          continue;
        }
        try {
          const s = slots[d];
          const file = s.file!;
          const ext = file.name.split('.').pop() || 'png';
          const path = `${me.id}/${Date.now()}-${d}.${ext}`;
          setSlot(d, { stage: 'uploading', progress: 30 });
          const up = await supabase.storage.from('dmr-uploads').upload(path, file, { upsert: false });
          if (up.error) throw new Error(up.error.message);
          uploaded.push({ discipline: d, path });
          setSlot(d, { storagePath: path, stage: 'uploading', progress: 55 });
        } catch (e: unknown) {
          setSlot(d, { stage: 'error', progress: 100, error: `upload: ${e instanceof Error ? e.message : String(e)}` });
        }
      }

      if (uploaded.length === 0) throw new Error('모든 파일 업로드에 실패했습니다');
      if (cancelRequestedRef.current) throw new Error('__CANCELLED__');

      // 2) Parse each uploaded image individually so we can update per-slot progress
      for (const d of uploaded.map((u) => u.discipline)) setSlot(d, { stage: 'parsing', progress: 70 });

      let ok = 0;
      await Promise.all(
        uploaded.map(async (u) => {
          if (cancelRequestedRef.current) {
            setSlot(u.discipline, { stage: 'error', progress: 100, error: '사용자 취소' });
            return;
          }
          try {
            const { results } = await parseFn({ data: { storagePaths: [u.path] } });
            const r = results[0];
            if (r.error || !r.section) throw new Error(r.error ?? 'parse failed');
            const section: DmrParsedSection = { ...r.section, discipline: u.discipline };
            setSlot(u.discipline, { section, error: null, stage: 'done', progress: 100 });
            if (!reportDate) setReportDate(section.report_date);
            ok += 1;
          } catch (e: unknown) {
            setSlot(u.discipline, {
              stage: 'error',
              progress: 100,
              error: `parse: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }),
      );

      if (cancelRequestedRef.current) toast.info('DMR 파싱 취소됨');
      else toast.success(`파싱 완료: ${ok}/${uploaded.length}장`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === '__CANCELLED__') toast.info('DMR 파싱 취소됨');
      else toast.error(msg);
    } finally {
      setParsing(false);
      cancelRequestedRef.current = false;
      setIsCancelling(false);
    }
  }

  async function saveAll() {
    const active = SLOTS.filter((d) => slots[d].section && slots[d].section!.rows.length > 0);
    if (active.length === 0) { toast.error('저장할 데이터가 없습니다'); return; }
    if (!reportDate) { toast.error('Report Date를 입력하세요'); return; }

    setSaving(true);
    cancelRequestedRef.current = false;
    setIsCancelling(false);
    try {
      if (cancelRequestedRef.current) throw new Error('__CANCELLED__');
      const entries = active.flatMap((d) => {
        const s = slots[d].section!;
        const withDate: DmrParsedSection = { ...s, report_date: reportDate, discipline: d };
        return flattenSection(withDate, slots[d].storagePath ?? undefined);
      });

      // Build master upserts
      const sysSet = new Map<string, { discipline: DmrDiscipline; name: string }>();
      const conSet = new Map<string, { name: string; is_direct: boolean }>();
      for (const d of active) {
        for (const r of slots[d].section!.rows) {
          const sk = `${d}::${r.system.trim()}`;
          if (!sysSet.has(sk)) sysSet.set(sk, { discipline: d, name: r.system.trim() });
          const ck = normalizeDmrContractor(r.contractor);
          if (!conSet.has(ck)) conSet.set(ck, { name: ck, is_direct: !!r.is_direct || isDmrDirectContractor(ck) });
        }
      }

      const res = await saveFn({
        data: {
          entries,
          systemMasters: [...sysSet.values()],
          contractorMasters: [...conSet.values()],
          overwrite,
        },
      });

      toast.success(`저장 완료: ${res.inserted}/${res.total} 행`);
      navigate({ to: '/resource/dmr/raw-data' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === '__CANCELLED__') toast.info('DMR 저장 취소됨');
      else toast.error(msg);
    } finally {
      setSaving(false);
      cancelRequestedRef.current = false;
      setIsCancelling(false);
    }
  }

  if (!canEdit) {
    return <div className="rounded-md border p-6 text-sm text-muted-foreground">임포트 권한이 없습니다 (senior_user 이상).</div>;
  }

  const anySection = SLOTS.some((d) => slots[d].section);
  const activeCount = SLOTS.filter((d) => slots[d].file).length;
  const overallProgress = activeCount
    ? Math.round(SLOTS.reduce((sum, d) => sum + (slots[d].file ? slots[d].progress : 0), 0) / activeCount)
    : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">DMR Import</h1>
        <p className="text-xs text-muted-foreground">Daily Manpower Report 이미지 최대 3장(ARCH / ELEC / MECH)을 업로드하면 AI가 자동 추출합니다.</p>
      </div>

      {/* Slots */}
      <div className="grid gap-3 lg:grid-cols-3">
        {SLOTS.map((d) => {
          const s = slots[d];
          return (
            <div key={d} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{d}</div>
                  <div className="text-[11px] text-muted-foreground">{DISCIPLINE_LABEL[d]}</div>
                </div>
                <SlotBadge slot={s} />
              </div>
              <Input type="file" accept="image/*" onChange={(e) => pickFile(d, e.target.files?.[0] ?? null)} className="text-xs" />
              {s.previewUrl ? (
                <div className="relative aspect-video overflow-hidden rounded border bg-muted/40">
                  <img src={s.previewUrl} alt={d} className="h-full w-full object-contain" />
                </div>
              ) : (
                <div className="flex aspect-video items-center justify-center rounded border border-dashed bg-muted/20 text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              {(s.stage === 'uploading' || s.stage === 'parsing' || s.stage === 'done' || s.stage === 'error') && s.file && (
                <div className="space-y-1">
                  <Progress value={s.progress} className="h-1.5" />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {s.stage === 'uploading' && <><CloudUpload className="h-3 w-3" /> 업로드 중…</>}
                      {s.stage === 'parsing' && <><Sparkles className="h-3 w-3 animate-pulse" /> AI 파싱 중…</>}
                      {s.stage === 'done' && <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> 완료</>}
                      {s.stage === 'error' && <><XCircle className="h-3 w-3 text-destructive" /> 실패</>}
                    </span>
                    <span>{s.progress}%</span>
                  </div>
                </div>
              )}
              {s.error && <div className="rounded bg-destructive/10 p-2 text-[11px] text-destructive">{s.error}</div>}
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
        <Button onClick={uploadAndParse} disabled={parsing}>
          {parsing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          업로드 & AI 파싱
        </Button>
        {isBusy && (
          <Button variant="destructive" onClick={requestCancel} disabled={isCancelling}>
            {isCancelling ? '취소 중…' : '취소'}
          </Button>
        )}
        {activeCount > 0 && (parsing || overallProgress > 0) && (
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>전체 진행률</span>
              <span>{overallProgress}%</span>
            </div>
            <Progress value={overallProgress} className="h-2" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Report Date</Label>
          <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="w-40 text-xs" />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={overwrite} onCheckedChange={setOverwrite} id="overwrite" />
          <Label htmlFor="overwrite" className="text-xs">기존 값 덮어쓰기</Label>
        </div>
        <div className="ml-auto">
          <Button onClick={saveAll} disabled={saving || !anySection}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            DB에 저장
          </Button>
        </div>
      </div>

      {/* Preview tables */}
      {anySection && (
        <div className="space-y-4">
          {SLOTS.map((d) => {
            const s = slots[d];
            if (!s.section) return null;
            return (
              <div key={d} className="space-y-2 rounded-md border p-3">
                <div className="text-sm font-semibold">{d} · {s.section.rows.length}행 · {formatDdMmmYyyy(s.section.report_date) || s.section.report_date}</div>
                <DmrPreviewTable
                  section={s.section}
                  onChange={(next) => setSlot(d, { section: next })}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SlotBadge({ slot }: { slot: Slot }) {
  if (slot.stage === 'done' && slot.section) {
    return (
      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        Parsed · {slot.section.rows.length}행
      </span>
    );
  }
  if (slot.stage === 'uploading') {
    return <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">Uploading…</span>;
  }
  if (slot.stage === 'parsing') {
    return <span className="rounded bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">Parsing…</span>;
  }
  if (slot.stage === 'error') {
    return <span className="rounded bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">Failed</span>;
  }
  return null;
}