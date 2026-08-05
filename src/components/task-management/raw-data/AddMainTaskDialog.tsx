import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, Plus, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  DISCIPLINES, ROW_TYPES, STATUS_MANUAL, RISK_LEVELS, PLOTS,
  type Discipline,
} from "@/lib/task-management/columns";
import {
  addMainTaskWithSubs, allocateMainTaskNo,
} from "@/lib/task-management/hierarchy.functions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTeamOptions } from "@/lib/team/team-master";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (result: { main_task_no: string; sub_task_nos: string[] }) => void;
  defaultDiscipline?: Discipline | null;
}

interface SubDraft {
  task_name: string;
  sub_task_desc: string;
  row_type: string;
  risk: string;
  hdec_pic_name: string;
  category: string;
  plan_start: string;
  plan_end: string;
  hdec_eng_name: string;
  floor_level: string;
  location: string;
  status_manual: string;
}

function emptySub(seed?: Partial<SubDraft>): SubDraft {
  return {
    task_name: "", sub_task_desc: "", row_type: "", risk: "",
    hdec_pic_name: "", category: "", plan_start: "", plan_end: "",
    hdec_eng_name: "", floor_level: "", location: "", status_manual: "예정",
    ...seed,
  };
}

export function AddMainTaskDialog({ open, onOpenChange, onCreated, defaultDiscipline }: Props) {
  const { data: me } = useCurrentUser();
  const canCreate = !!me && !me.isGuest && !me.isSuperGuest;
  const roleLocked = !!me && (me.isUser || me.isDSuperUser) && !me.isSeniorUser && !me.isAdmin && !me.isSuperUser;
  const lockedPic = roleLocked && me?.isUser ? (me.hdec_pic_name ?? "") : "";
  const lockedTeam = roleLocked ? (me?.team ?? "") : "";

  const [discipline, setDiscipline] = useState<Discipline>(defaultDiscipline ?? "ARCH");
  const [taskNo, setTaskNo] = useState("");
  const [taskName, setTaskName] = useState("");
  const [team, setTeam] = useState<string>("");
  const [category, setCategory] = useState("");
  const [hdecPic, setHdecPic] = useState("");
  const [risk, setRisk] = useState<string>("");
  const [hdecEng, setHdecEng] = useState("");
  const [floorLevel, setFloorLevel] = useState("");
  const [location, setLocation] = useState("");
  const [plot, setPlot] = useState("");
  const [rowType, setRowType] = useState("");
  const [subs, setSubs] = useState<SubDraft[]>([emptySub()]);
  const [saving, setSaving] = useState(false);

  const allocFn = useServerFn(allocateMainTaskNo);
  const submitFn = useServerFn(addMainTaskWithSubs);

  useEffect(() => {
    if (!open) return;
    setDiscipline(defaultDiscipline ?? "ARCH");
    setTaskNo("");
    setTaskName("");
    setTeam(lockedTeam || (defaultDiscipline ?? "ARCH"));
    setCategory("");
    setHdecPic(lockedPic || "");
    setRisk("");
    setHdecEng("");
    setFloorLevel("");
    setLocation("");
    setPlot("");
    setRowType("");
    setSubs([emptySub({ hdec_pic_name: lockedPic || "" })]);
    // 채번 프리필
    allocFn({ data: { discipline: (defaultDiscipline ?? "ARCH") as Discipline } })
      .then((r) => setTaskNo(r.next))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // discipline 변경 시 채번 재요청
  useEffect(() => {
    if (!open) return;
    allocFn({ data: { discipline } }).then((r) => setTaskNo(r.next)).catch(() => {});
    if (roleLocked && !lockedTeam) setTeam(discipline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discipline]);

  // Sub No 실시간 미리보기
  const subNos = useMemo(
    () => subs.map((_, i) => `${taskNo || "?"}-${String(i + 1).padStart(2, "0")}`),
    [subs, taskNo],
  );

  // 롤업 미리보기
  const rollup = useMemo(() => {
    const starts = subs.map((s) => s.plan_start).filter(Boolean).sort();
    const ends = subs.map((s) => s.plan_end).filter(Boolean).sort();
    return {
      plan_start: starts[0] ?? "",
      plan_end: ends[ends.length - 1] ?? "",
    };
  }, [subs]);

  // 필수/오류 계산
  const validation = useMemo(() => {
    const missing: string[] = [];
    const dateErr: string[] = [];
    if (!taskNo.trim()) missing.push("Main Task No");
    if (!taskName.trim()) missing.push("Main Task 이름");
    if (!team.trim()) missing.push("Main Team");
    if (!category.trim()) missing.push("Main Category");
    if (!hdecPic.trim()) missing.push("Main HDEC PIC");
    if (!risk.trim()) missing.push("Main Risk");
    subs.forEach((s, i) => {
      const p = `Sub #${i + 1}`;
      if (!s.task_name.trim()) missing.push(`${p} Task 이름`);
      if (!s.sub_task_desc.trim()) missing.push(`${p} Sub-Task 설명`);
      if (!s.row_type.trim()) missing.push(`${p} Work Type`);
      if (!s.risk.trim()) missing.push(`${p} Risk`);
      if (!s.hdec_pic_name.trim()) missing.push(`${p} HDEC PIC`);
      if (!s.category.trim()) missing.push(`${p} Category`);
      if (!s.plan_start.trim()) missing.push(`${p} P.Start`);
      if (!s.plan_end.trim()) missing.push(`${p} P.Finish`);
      if (s.plan_start && s.plan_end && s.plan_end < s.plan_start) {
        dateErr.push(`${p}: P.Finish < P.Start`);
      }
    });
    return { missing, dateErr, ok: missing.length === 0 && dateErr.length === 0 };
  }, [taskNo, taskName, team, category, hdecPic, risk, subs]);

  function updateSub(idx: number, patch: Partial<SubDraft>) {
    setSubs((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function addSubRow() {
    setSubs((prev) => [...prev, emptySub({
      hdec_pic_name: lockedPic || hdecPic || "",
      category, risk,
    })]);
  }
  function removeSub(idx: number) {
    setSubs((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function handleSave() {
    if (!validation.ok) {
      const el = document.querySelector<HTMLElement>("[data-invalid='true']");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus?.();
      return;
    }
    setSaving(true);
    try {
      const res = await submitFn({
        data: {
          discipline,
          main: {
            task_no: taskNo.trim(),
            task_name: taskName.trim(),
            team: team.trim(),
            category: category.trim(),
            hdec_pic_name: hdecPic.trim(),
            risk: risk.trim(),
            hdec_eng_name: hdecEng.trim() || null,
            floor_level: floorLevel.trim() || null,
            location: location.trim() || null,
            plot: plot.trim() || null,
            row_type: rowType.trim() || null,
          },
          subs: subs.map((s) => ({
            task_name: s.task_name.trim(),
            sub_task_desc: s.sub_task_desc.trim(),
            row_type: s.row_type.trim(),
            risk: s.risk.trim(),
            hdec_pic_name: s.hdec_pic_name.trim(),
            category: s.category.trim(),
            plan_start: s.plan_start,
            plan_end: s.plan_end,
            hdec_eng_name: s.hdec_eng_name.trim() || null,
            floor_level: s.floor_level.trim() || null,
            location: s.location.trim() || null,
            status_manual: s.status_manual || "예정",
          })),
        },
      });
      toast.success(`Task 추가 완료: ${res.main_task_no} (Sub ${res.sub_task_nos.length}개)`);
      onOpenChange(false);
      onCreated?.(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setSaving(false);
    }
  }

  if (!canCreate && open) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>권한 없음</DialogTitle></DialogHeader>
          <div className="py-4 text-sm text-muted-foreground">Guest 계정은 Task를 추가할 수 없습니다.</div>
        </DialogContent>
      </Dialog>
    );
  }

  const reqStar = <span className="text-rose-500">*</span>;
  const optHint = <span className="ml-1 text-[10px] text-muted-foreground">(선택)</span>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[980px] overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="text-base">Task 추가 (Main + Sub)</DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(92vh-140px)] overflow-y-auto px-5 py-4 space-y-5">
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            빨간 <span className="text-rose-500">*</span> = 필수, 회색 (선택) = 선택 입력. 자동 계산 필드는 회색 배경으로 편집할 수 없습니다.
          </div>

          {/* MAIN */}
          <section className="rounded-lg border">
            <header className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold">Main Task</header>
            <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
              <Field label={<>Discipline {reqStar}</>}>
                <Select value={discipline} onValueChange={(v) => setDiscipline(v as Discipline)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DISCIPLINES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={<>Task No {reqStar}</>} invalid={!taskNo.trim()}>
                <Input value={taskNo} onChange={(e) => setTaskNo(e.target.value)} className="h-8" data-invalid={!taskNo.trim()} />
              </Field>
              <Field label={<>Task 이름 {reqStar}</>} invalid={!taskName.trim()} className="col-span-2">
                <Input value={taskName} onChange={(e) => setTaskName(e.target.value)} className="h-8" data-invalid={!taskName.trim()} />
              </Field>
              <Field label={<>Team {reqStar}</>} invalid={!team.trim()}>
                <Select value={team} onValueChange={setTeam} disabled={!!lockedTeam}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {["ARCH", "ELEC", "MECH"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={<>Category {reqStar}</>} invalid={!category.trim()}>
                <Input value={category} onChange={(e) => setCategory(e.target.value)} className="h-8" data-invalid={!category.trim()} />
              </Field>
              <Field label={<>HDEC PIC {reqStar}</>} invalid={!hdecPic.trim()}>
                <Input value={hdecPic} onChange={(e) => setHdecPic(e.target.value)} className="h-8" data-invalid={!hdecPic.trim()} disabled={!!lockedPic} />
              </Field>
              <Field label={<>Risk {reqStar}</>} invalid={!risk.trim()}>
                <Select value={risk} onValueChange={setRisk}>
                  <SelectTrigger className="h-8" data-invalid={!risk.trim()}><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {RISK_LEVELS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={<>HDEC ENG {optHint}</>}>
                <Input value={hdecEng} onChange={(e) => setHdecEng(e.target.value)} className="h-8" />
              </Field>
              <Field label={<>Level {optHint}</>}>
                <Input value={floorLevel} onChange={(e) => setFloorLevel(e.target.value)} className="h-8" />
              </Field>
              <Field label={<>Location {optHint}</>}>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} className="h-8" />
              </Field>
              <Field label={<>Plot {optHint}</>}>
                <Select value={plot || "__none__"} onValueChange={(v) => setPlot(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(비우기)</SelectItem>
                    {PLOTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={<>Work Type {optHint}</>}>
                <Select value={rowType || "__none__"} onValueChange={(v) => setRowType(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(비우기)</SelectItem>
                    {ROW_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <ReadOnlyField label="P.Start (Sub 자동 롤업)" value={rollup.plan_start || "—"} />
              <ReadOnlyField label="P.Finish (Sub 자동 롤업)" value={rollup.plan_end || "—"} />
            </div>
          </section>

          {/* SUBS */}
          <section className="rounded-lg border">
            <header className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
              <span className="text-xs font-semibold">Sub Tasks ({subs.length})</span>
              <Button size="sm" variant="outline" className="h-7" onClick={addSubRow}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Sub 추가
              </Button>
            </header>
            <div className="space-y-4 p-3">
              {subs.map((s, i) => (
                <div key={i} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-mono text-muted-foreground">
                      Sub #{i + 1} · <span className="rounded bg-muted px-1.5 py-0.5">{subNos[i]}</span>
                    </div>
                    {subs.length > 1 && (
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeSub(i)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Field label={<>Task 이름 {reqStar}</>} invalid={!s.task_name.trim()} className="col-span-2">
                      <Input value={s.task_name} onChange={(e) => updateSub(i, { task_name: e.target.value })} className="h-8" data-invalid={!s.task_name.trim()} />
                    </Field>
                    <Field label={<>Sub-Task 설명 {reqStar}</>} invalid={!s.sub_task_desc.trim()} className="col-span-2">
                      <Textarea rows={1} value={s.sub_task_desc} onChange={(e) => updateSub(i, { sub_task_desc: e.target.value })} className="min-h-8" data-invalid={!s.sub_task_desc.trim()} />
                    </Field>
                    <Field label={<>Work Type {reqStar}</>} invalid={!s.row_type.trim()}>
                      <Select value={s.row_type} onValueChange={(v) => updateSub(i, { row_type: v })}>
                        <SelectTrigger className="h-8" data-invalid={!s.row_type.trim()}><SelectValue placeholder="선택" /></SelectTrigger>
                        <SelectContent>{ROW_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label={<>Risk {reqStar}</>} invalid={!s.risk.trim()}>
                      <Select value={s.risk} onValueChange={(v) => updateSub(i, { risk: v })}>
                        <SelectTrigger className="h-8" data-invalid={!s.risk.trim()}><SelectValue placeholder="선택" /></SelectTrigger>
                        <SelectContent>{RISK_LEVELS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label={<>HDEC PIC {reqStar}</>} invalid={!s.hdec_pic_name.trim()}>
                      <Input value={s.hdec_pic_name} onChange={(e) => updateSub(i, { hdec_pic_name: e.target.value })} className="h-8" data-invalid={!s.hdec_pic_name.trim()} disabled={!!lockedPic} />
                    </Field>
                    <Field label={<>Category {reqStar}</>} invalid={!s.category.trim()}>
                      <Input value={s.category} onChange={(e) => updateSub(i, { category: e.target.value })} className="h-8" data-invalid={!s.category.trim()} />
                    </Field>
                    <Field label={<>P.Start {reqStar}</>} invalid={!s.plan_start.trim()}>
                      <Input type="date" value={s.plan_start} onChange={(e) => updateSub(i, { plan_start: e.target.value })} className="h-8 font-mono text-xs" data-invalid={!s.plan_start.trim()} />
                    </Field>
                    <Field label={<>P.Finish {reqStar}</>} invalid={!s.plan_end.trim() || (!!s.plan_start && !!s.plan_end && s.plan_end < s.plan_start)}>
                      <Input type="date" value={s.plan_end} onChange={(e) => updateSub(i, { plan_end: e.target.value })} className="h-8 font-mono text-xs" data-invalid={!s.plan_end.trim() || (!!s.plan_start && !!s.plan_end && s.plan_end < s.plan_start)} />
                    </Field>
                    <Field label={<>Status {optHint}</>}>
                      <Select value={s.status_manual || "예정"} onValueChange={(v) => updateSub(i, { status_manual: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUS_MANUAL.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label={<>HDEC ENG {optHint}</>}>
                      <Input value={s.hdec_eng_name} onChange={(e) => updateSub(i, { hdec_eng_name: e.target.value })} className="h-8" />
                    </Field>
                    <Field label={<>Level {optHint}</>}>
                      <Input value={s.floor_level} onChange={(e) => updateSub(i, { floor_level: e.target.value })} className="h-8" />
                    </Field>
                    <Field label={<>Location {optHint}</>}>
                      <Input value={s.location} onChange={(e) => updateSub(i, { location: e.target.value })} className="h-8" />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
          <div className="flex items-center gap-2">
            <StatusPill validation={validation} saving={saving} />
            <Button onClick={handleSave} disabled={saving || !validation.ok}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              저장
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, children, className, invalid,
}: { label: React.ReactNode; children: React.ReactNode; className?: string; invalid?: boolean }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className={cn("text-[11px]", invalid && "text-rose-600")}>{label}</Label>
      <div className={cn(invalid && "[&_input]:border-rose-400 [&_[role=combobox]]:border-rose-400 [&_textarea]:border-rose-400")}>
        {children}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex h-8 items-center rounded-md border bg-muted/60 px-2 font-mono text-xs text-muted-foreground">
        {value}
      </div>
    </div>
  );
}

function StatusPill({
  validation, saving,
}: { validation: { missing: string[]; dateErr: string[]; ok: boolean }; saving: boolean }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> 저장 중…
      </span>
    );
  }
  if (validation.ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> 저장 가능
      </span>
    );
  }
  const missingLabel = validation.missing.length ? `필수 ${validation.missing.length}개 미입력` : null;
  const dateLabel = validation.dateErr.length ? `날짜 오류 ${validation.dateErr.length}건` : null;
  const items = [...validation.missing, ...validation.dateErr];
  const preview = items.slice(0, 5);
  const extra = items.length - preview.length;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex cursor-help items-center gap-1 rounded-full px-2.5 py-1 text-xs",
              validation.missing.length
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {[missingLabel, dateLabel].filter(Boolean).join(" · ")}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <ul className="space-y-0.5 text-[11px]">
            {preview.map((m) => <li key={m}>• {m}</li>)}
            {extra > 0 && <li className="text-muted-foreground">+{extra}건 더</li>}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}