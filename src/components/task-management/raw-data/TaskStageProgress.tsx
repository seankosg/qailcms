import { cn } from "@/lib/utils";

export type StageState = "completed" | "wip" | "delay" | "plan" | "empty";

type Row = Record<string, unknown>;

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v);
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDdMmm(v: unknown): string {
  const d = toDate(v);
  if (!d) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short" });
  return `${day} ${mon}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function classifyStart(row: Row, dataDate: string | null): StageState {
  const actualStart = toDate((row as any).actual_start);
  const planStart = toDate((row as any).plan_start);
  const asOf = toDate(dataDate ?? todayIso())!;
  if (actualStart) return "completed";
  if (!planStart) return "empty";
  if (planStart.getTime() <= asOf.getTime()) return "delay";
  return "plan";
}

export function classifyFinish(row: Row, dataDate: string | null): StageState {
  const actualStart = toDate((row as any).actual_start);
  const actualFinish = toDate((row as any).actual_finish);
  const planEnd = toDate((row as any).plan_end);
  const asOf = toDate(dataDate ?? todayIso())!;
  if (actualFinish) return "completed";
  if (planEnd && planEnd.getTime() <= asOf.getTime()) return "delay";
  if (actualStart && (!planEnd || planEnd.getTime() > asOf.getTime())) return "wip";
  if (!planEnd) return "empty";
  return "plan";
}

const STATE_STYLES: Record<StageState, string> = {
  completed: "bg-emerald-600 border-emerald-600 text-white",
  wip: "bg-amber-400 border-amber-500 text-white",
  delay: "bg-destructive border-destructive text-destructive-foreground",
  plan: "bg-transparent border-muted-foreground/40 text-muted-foreground/60",
  empty: "bg-transparent border-muted-foreground/20 text-muted-foreground/40",
};

const STATE_GLYPH: Record<StageState, string> = {
  completed: "●",
  wip: "◐",
  delay: "⊘",
  plan: "○",
  empty: "○",
};

const STATE_LABEL: Record<StageState, string> = {
  completed: "Completed",
  wip: "WIP",
  delay: "Delay",
  plan: "Plan",
  empty: "—",
};

function Pip({ state, label }: { state: StageState; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none",
        STATE_STYLES[state],
      )}
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>{STATE_GLYPH[state]}</span>
    </span>
  );
}

export function TaskStageProgress({
  row,
  dataDate,
}: {
  row: Row;
  dataDate: string | null;
}) {
  const start = classifyStart(row, dataDate);
  const finish = classifyFinish(row, dataDate);
  const asOf = dataDate ?? todayIso();
  const r = row as any;
  const startInfo = r.actual_start
    ? ` · ${fmtDdMmm(r.actual_start)}`
    : r.plan_start
      ? ` (plan ${fmtDdMmm(r.plan_start)})`
      : "";
  const finishInfo = r.actual_finish
    ? ` · ${fmtDdMmm(r.actual_finish)}`
    : r.plan_end
      ? ` (plan ${fmtDdMmm(r.plan_end)})`
      : "";
  const title = [
    `Data Date: ${fmtDdMmm(asOf)}`,
    `Start: ${STATE_LABEL[start]}${startInfo}`,
    `Finish: ${STATE_LABEL[finish]}${finishInfo}`,
  ].join("\n");
  return (
    <span
      className="inline-flex select-none items-center gap-0.5"
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      <Pip state={start} label={`Start: ${STATE_LABEL[start]}`} />
      <span className="h-px w-2 bg-muted-foreground/30" aria-hidden />
      <Pip state={finish} label={`Finish: ${STATE_LABEL[finish]}`} />
    </span>
  );
}

export function TaskStageProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground">Legend:</span>
      <span className="inline-flex items-center gap-1"><Pip state="completed" label="Completed" /> Completed</span>
      <span className="inline-flex items-center gap-1"><Pip state="wip" label="WIP" /> WIP</span>
      <span className="inline-flex items-center gap-1"><Pip state="delay" label="Delay" /> Delay</span>
      <span className="inline-flex items-center gap-1"><Pip state="plan" label="Plan" /> Plan</span>
      <span className="ml-2">Stages: Start → Finish</span>
    </div>
  );
}