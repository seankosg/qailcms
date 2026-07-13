import { cn } from "@/lib/utils";
import {
  formatDdMmm,
  isActualComplete,
  isClosureComplete,
  isStageDelayedAsOf,
  isStageDone,
  todayIso,
} from "@/lib/defect-management/stage-utils";

type StageName = "start" | "completion" | "closure";
type StageState = "done" | "wip" | "planned" | "hold" | "empty";
type Row = Record<string, any>;

function classifyStage(item: Row, stage: StageName, asOfDate: string): StageState {
  if (isStageDone(item, stage)) return "done";
  if (isStageDelayedAsOf(item, stage, asOfDate)) return "hold";

  const completionStatus = String(item.completion_status ?? "").toLowerCase();
  const closureStatus = String(item.closure_status ?? "").toLowerCase();
  if (stage === "start" && item.actual_start_date) return "wip";
  if (stage === "completion") {
    const pct = Number(item.actual_progress_pct ?? 0);
    const normalized = pct > 1 ? pct : pct * 100;
    if (completionStatus === "wip" || (normalized > 0 && normalized < 100)) return "wip";
  }
  if (stage === "closure") {
    if (closureStatus === "wip" || (isActualComplete(item) && !isClosureComplete(item))) return "wip";
  }

  const plan =
    stage === "start"
      ? item.planned_start_date
      : stage === "completion"
        ? item.planned_completion_date
        : item.planned_closure_date;
  return plan ? "planned" : "empty";
}

function Pip({ state, label }: { state: StageState; label: string }) {
  const styles: Record<StageState, string> = {
    done: "bg-emerald-600 border-emerald-600 text-white",
    wip: "bg-amber-400 border-amber-500 text-white",
    planned: "bg-transparent border-muted-foreground/40 text-muted-foreground/60",
    hold: "bg-destructive border-destructive text-destructive-foreground",
    empty: "bg-transparent border-muted-foreground/20 text-muted-foreground/40",
  };
  const glyph: Record<StageState, string> = {
    done: "●",
    wip: "◐",
    planned: "○",
    hold: "⊘",
    empty: "○",
  };
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold leading-none",
        styles[state],
      )}
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>{glyph[state]}</span>
    </span>
  );
}

const stateLabel = (state: StageState) =>
  state === "done" ? "Done" : state === "wip" ? "WIP" : state === "hold" ? "Delay" : state === "planned" ? "Planned" : "—";

export function DefectStageProgress({ item, asOfDate = null }: { item: Row; asOfDate?: string | null }) {
  const delayAsOfDate = asOfDate ?? todayIso();
  const start = classifyStage(item, "start", delayAsOfDate);
  const completion = classifyStage(item, "completion", delayAsOfDate);
  const closure = classifyStage(item, "closure", delayAsOfDate);
  const title = [
    `Delay as of ${formatDdMmm(delayAsOfDate)}`,
    `Start: ${stateLabel(start)}${item.actual_start_date ? ` · ${formatDdMmm(item.actual_start_date)}` : item.planned_start_date ? ` (plan ${formatDdMmm(item.planned_start_date)})` : ""}`,
    `Completion: ${stateLabel(completion)}${item.actual_completion_date ? ` · ${formatDdMmm(item.actual_completion_date)}` : item.planned_completion_date ? ` (plan ${formatDdMmm(item.planned_completion_date)})` : ""}`,
    `Closure: ${stateLabel(closure)}${item.actual_closure_date ? ` · ${formatDdMmm(item.actual_closure_date)}` : item.planned_closure_date ? ` (plan ${formatDdMmm(item.planned_closure_date)})` : ""}`,
  ].join("\n");

  return (
    <span className="inline-flex select-none items-center gap-0.5" title={title} onClick={(event) => event.stopPropagation()}>
      <Pip state={start} label={`Start: ${stateLabel(start)}`} />
      <span className="h-px w-2 bg-muted-foreground/30" aria-hidden />
      <Pip state={completion} label={`Completion: ${stateLabel(completion)}`} />
      <span className="h-px w-2 bg-muted-foreground/30" aria-hidden />
      <Pip state={closure} label={`Closure: ${stateLabel(closure)}`} />
    </span>
  );
}

export function DefectStageProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground">Legend:</span>
      <span className="inline-flex items-center gap-1"><Pip state="done" label="Done" /> Done</span>
      <span className="inline-flex items-center gap-1"><Pip state="wip" label="WIP" /> WIP</span>
      <span className="inline-flex items-center gap-1"><Pip state="planned" label="Planned" /> Planned</span>
      <span className="inline-flex items-center gap-1"><Pip state="hold" label="Delay" /> Delay</span>
      <span className="ml-2">Stages: Start → Completion → Closure</span>
    </div>
  );
}