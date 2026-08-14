import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  SPL_STAGE_STATES,
  SPL_STATE_CELL,
  SPL_STATE_LABEL,
  SPL_STATE_TEXT,
  SPL_NA_HATCH,
  splStateBarStyle,
  type SplStageState,
} from "@/lib/spl/stage-state";

export type StageCounts = Record<SplStageState, number>;

/**
 * 단계 상자 — 여섯 상태 2행 3열 + 스택바.
 * 생김새(테두리·모서리·글자 크기)는 SplKpiCard 를 따른다.
 */
export function SplStageBox({
  code,
  label,
  counts,
  hereCount,
  aconex,
  roundNo,
  active,
  activeState,
  onPick,
}: {
  code: string;
  label: string;
  counts: StageCounts;
  hereCount: number;
  aconex?: boolean;
  roundNo?: number | null;
  active?: boolean;
  activeState?: SplStageState | null;
  onPick: (state: SplStageState | null) => void;
}) {
  const total = SPL_STAGE_STATES.reduce((a, s) => a + counts[s], 0);
  const hoverLine = SPL_STAGE_STATES.map((s) => `${SPL_STATE_LABEL[s]} ${counts[s]}`).join(" · ");

  return (
    <div
      className={cn(
        "min-w-[126px] shrink-0 rounded-lg border p-2 transition hover:border-primary/60",
        active && "border-primary ring-1 ring-primary/30",
      )}
      title={hoverLine}
    >
      <button type="button" onClick={() => onPick(null)} className="block w-full text-left">
        <div className="flex items-start justify-between gap-1">
          <div className="text-[11px] font-semibold tabular-nums">
            {code}
            {aconex && <span className="ml-1 font-normal text-muted-foreground">· Aconex</span>}
            {roundNo === 2 && (
              <span className="ml-1 rounded border px-1 text-[9px] font-normal text-muted-foreground">R2</span>
            )}
          </div>
          <span
            className="rounded border px-1 text-[9px] tabular-nums text-muted-foreground"
            title="Current stage rows in this band"
          >
            Current Stage {hereCount}
          </span>
        </div>
        <div className="truncate text-[10px] text-muted-foreground" title={label}>
          {label}
        </div>
      </button>

      <div className="mt-1 grid grid-cols-3 gap-1">
        {SPL_STAGE_STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              "rounded border px-1 py-0.5 text-left transition hover:border-primary/60",
              SPL_STATE_CELL[s],
              active && activeState === s && "border-primary ring-1 ring-primary/30",
            )}
            style={s === "na" ? ({ backgroundImage: SPL_NA_HATCH } as CSSProperties) : undefined}
            title={`${SPL_STATE_LABEL[s]} ${counts[s]}`}
          >
            <div className={cn("text-sm font-semibold tabular-nums leading-tight", SPL_STATE_TEXT[s])}>
              {counts[s].toLocaleString()}
            </div>
            <div className="text-[9px] leading-tight text-muted-foreground">{SPL_STATE_LABEL[s]}</div>
          </button>
        ))}
      </div>

      {/* 스택바 — 조각 사이 2px 틈 */}
      <div className="mt-1 flex h-1.5 gap-[2px]">
        {SPL_STAGE_STATES.filter((s) => counts[s] > 0).map((s) => (
          <div
            key={s}
            className="rounded-[1px]"
            style={{ ...splStateBarStyle(s), flexGrow: counts[s], flexBasis: 0 }}
            title={`${SPL_STATE_LABEL[s]} ${counts[s]}`}
          />
        ))}
        {total === 0 && <div className="flex-1 rounded-[1px] bg-muted" />}
      </div>
    </div>
  );
}
