import { cn } from "@/lib/utils";
import {
  formatDdMmm,
  isActualComplete,
  isClosureComplete,
  isStageDelayedAsOf,
  isStageDone,
  SNAG_STAGES,
  todayIso,
} from "@/lib/defect-management/stage-utils";

export type StageName = "start" | "rectified" | "pre_inspection" | "dar_inspection" | "closure" | "ho";
export type StageState = "done" | "wip" | "planned" | "hold" | "empty";
type Row = Record<string, any>;

const STAGE_TITLES: Record<StageName, string> = {
  start: "Start",
  rectified: "Rectified",
  pre_inspection: "Pre-Inspection",
  dar_inspection: "DAR-Inspection",
  closure: "Closure",
  ho: "Hand Over",
};
const PLAN_FIELD: Record<StageName, string> = {
  start: "planned_start_date",
  rectified: "planned_rectified_date",
  pre_inspection: "planned_pre_inspection_date",
  dar_inspection: "planned_dar_inspection_date",
  closure: "planned_closure_date",
  ho: "planned_ho_date",
};
const ACTUAL_FIELD: Record<StageName, string> = {
  start: "actual_start_date",
  rectified: "actual_rectified_date",
  pre_inspection: "actual_pre_inspection_date",
  dar_inspection: "actual_dar_inspection_date",
  closure: "actual_closure_date",
  ho: "actual_ho_date",
};

export function classifyStage(item: Row, stage: StageName, asOfDate: string): StageState {
  if (isStageDone(item, stage)) return "done";
  if (isStageDelayedAsOf(item, stage, asOfDate)) return "hold";

  const completionStatus = String(item.rectified_status ?? "").toLowerCase();
  const closureStatus = String(item.closure_status ?? "").toLowerCase();
  if (stage === "start" && item.actual_start_date) return "wip";
  if (stage === "rectified") {
    if (completionStatus === "not start yet") {
      return item.planned_rectified_date ? "planned" : "empty";
    }
    if (completionStatus === "not finish yet") return "wip";
    const pct = Number(item.actual_progress_pct ?? 0);
    const normalized = pct > 1 ? pct : pct * 100;
    if (completionStatus === "wip" || (normalized > 0 && normalized < 100)) return "wip";
  }
  if (stage === "closure") {
    if (closureStatus === "wip" || (isActualComplete(item) && !isClosureComplete(item))) return "wip";
  }

  return item[PLAN_FIELD[stage]] ? "planned" : "empty";
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
  const states = SNAG_STAGES.map((s) => ({ stage: s as StageName, state: classifyStage(item, s as StageName, delayAsOfDate) }));
  const title = [
    `Delay as of ${formatDdMmm(delayAsOfDate)}`,
    ...states.map(({ stage, state }) => {
      const a = item[ACTUAL_FIELD[stage]];
      const p = item[PLAN_FIELD[stage]];
      const suffix = a ? ` · ${formatDdMmm(a)}` : p ? ` (plan ${formatDdMmm(p)})` : "";
      return `${STAGE_TITLES[stage]}: ${stateLabel(state)}${suffix}`;
    }),
  ].join("\n");

  return (
    <span className="inline-flex select-none items-center gap-0.5" title={title} onClick={(event) => event.stopPropagation()}>
      {states.map(({ stage, state }, i) => (
        <span key={stage} className="inline-flex items-center gap-0.5">
          {i > 0 ? <span className="h-px w-2 bg-muted-foreground/30" aria-hidden /> : null}
          <Pip state={state} label={`${STAGE_TITLES[stage]}: ${stateLabel(state)}`} />
        </span>
      ))}
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
      <span className="ml-2">Stages: Start → Rectified → Pre-Ins → DAR-Ins → Closure → H/O</span>
    </div>
  );
}