import { cn } from "@/lib/utils";

export type StageState = "completed" | "completed_late" | "wip" | "delay" | "plan" | "empty";
export type AlarmState = "done" | "ok" | "caution" | "late" | "risk" | "empty";

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
  if (actualFinish) {
    if (planEnd && actualFinish.getTime() > planEnd.getTime()) return "completed_late";
    return "completed";
  }
  if (planEnd && planEnd.getTime() <= asOf.getTime()) return "delay";
  if (actualStart && (!planEnd || planEnd.getTime() > asOf.getTime())) return "wip";
  if (!planEnd) return "empty";
  return "plan";
}

export function classifyAlarm(row: Row): AlarmState {
  const v = String((row as any).auto_judgment ?? "").trim();
  if (v === "완료") return "done";
  if (v === "정상") return "ok";
  if (v === "주의") return "caution";
  if (v === "지연") return "late";
  if (v === "위험") return "risk";
  return "empty";
}

export const STATE_STYLES: Record<StageState, string> = {
  completed: "bg-transparent border-2 border-emerald-600 text-emerald-600",
  completed_late: "bg-emerald-600 border-emerald-600 text-white",
  wip: "bg-amber-400 border-amber-500 text-white",
  delay: "bg-destructive border-destructive text-destructive-foreground",
  plan: "bg-transparent border-muted-foreground/40 text-muted-foreground/60",
  empty: "bg-transparent border-muted-foreground/20 text-muted-foreground/40",
};

export const STATE_GLYPH: Record<StageState, string> = {
  completed: " ",
  completed_late: "✕",
  wip: "◐",
  delay: "⊘",
  plan: "○",
  empty: "○",
};

export const STATE_LABEL: Record<StageState, string> = {
  completed: "Completed",
  completed_late: "Completed (Late)",
  wip: "WIP",
  delay: "Delay",
  plan: "Plan",
  empty: "—",
};

export const ALARM_STYLES: Record<AlarmState, string> = {
  done: "bg-emerald-600 border-emerald-600 text-white",
  ok: "bg-sky-500 border-sky-500 text-white",
  caution: "bg-amber-400 border-amber-500 text-white",
  late: "bg-orange-600 border-orange-600 text-white",
  risk: "bg-rose-600 border-rose-600 text-white motion-safe:animate-pulse",
  empty: "bg-transparent border-muted-foreground/20 text-muted-foreground/40",
};

export const ALARM_GLYPH: Record<AlarmState, string> = {
  done: "●",
  ok: "●",
  caution: "◐",
  late: "⊘",
  risk: "!",
  empty: "○",
};

export const ALARM_LABEL: Record<AlarmState, string> = {
  done: "완료",
  ok: "정상",
  caution: "주의",
  late: "지연",
  risk: "위험",
  empty: "—",
};

export function Pip({ className, glyph, label }: { className: string; glyph: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none",
        className,
      )}
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>{glyph}</span>
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
  const alarm = classifyAlarm(row);
  const asOf = dataDate ?? todayIso();
  const r = row as any;
  const startInfo = r.actual_start
    ? ` · ${fmtDdMmm(r.actual_start)}`
    : r.plan_start
      ? ` (plan ${fmtDdMmm(r.plan_start)})`
      : "";
  let finishInfo = r.actual_finish
    ? ` · ${fmtDdMmm(r.actual_finish)}`
    : r.plan_end
      ? ` (plan ${fmtDdMmm(r.plan_end)})`
      : "";
  if (finish === "completed_late") {
    const af = toDate(r.actual_finish);
    const pe = toDate(r.plan_end);
    if (af && pe) {
      const days = Math.round((af.getTime() - pe.getTime()) / 86400000);
      finishInfo = ` · ${fmtDdMmm(r.actual_finish)} (plan ${fmtDdMmm(r.plan_end)}, +${days}d)`;
    }
  }
  const title = [
    `Data Date: ${fmtDdMmm(asOf)}`,
    `Start: ${STATE_LABEL[start]}${startInfo}`,
    `Alarm: ${ALARM_LABEL[alarm]}`,
    `Finish: ${STATE_LABEL[finish]}${finishInfo}`,
  ].join("\n");
  return (
    <span
      className="inline-flex select-none items-center gap-0.5"
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      <Pip
        className={STATE_STYLES[start]}
        glyph={STATE_GLYPH[start]}
        label={`Start: ${STATE_LABEL[start]}`}
      />
      <span className="h-px w-2 bg-muted-foreground/30" aria-hidden />
      <Pip
        className={ALARM_STYLES[alarm]}
        glyph={ALARM_GLYPH[alarm]}
        label={`Alarm: ${ALARM_LABEL[alarm]}`}
      />
      <span className="h-px w-2 bg-muted-foreground/30" aria-hidden />
      <Pip
        className={STATE_STYLES[finish]}
        glyph={STATE_GLYPH[finish]}
        label={`Finish: ${STATE_LABEL[finish]}`}
      />
    </span>
  );
}

export function TaskStageProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground">Legend:</span>
      <span className="inline-flex items-center gap-1"><Pip className={STATE_STYLES.completed} glyph={STATE_GLYPH.completed} label="Completed" /> Completed</span>
      <span className="inline-flex items-center gap-1"><Pip className={STATE_STYLES.wip} glyph={STATE_GLYPH.wip} label="WIP" /> WIP</span>
      <span className="inline-flex items-center gap-1"><Pip className={STATE_STYLES.delay} glyph={STATE_GLYPH.delay} label="Delay" /> Delay</span>
      <span className="inline-flex items-center gap-1"><Pip className={STATE_STYLES.plan} glyph={STATE_GLYPH.plan} label="Plan" /> Plan</span>
      <span className="ml-2">Stages: Start → Alarm → Finish</span>
    </div>
  );
}