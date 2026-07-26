import { Fragment, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { ScheduleCell } from "@/components/schedule/ScheduleCell";
import {
  type Bucket,
  type MatrixResult,
  type Stage,
  STAGE_LABELS,
  STAGE_SHORT_LABELS,
  formatBucketLabel,
} from "@/lib/abd/progress-utils";

interface Props {
  data: MatrixResult;
  bucket: Bucket;
  stagesToShow: Stage[];
  today: string;
  asOfLabel: string;
  groupHeader: string;
  onCellClick?: (
    groupKeyRaw: string[],
    bucketIso: string,
    stage: Stage | "all",
    field: "planned" | "actual",
  ) => void;
}

const W_GROUP = 220;
const W_NUM = 48;
const W_PCT = 48;
const W_TOTAL_BLOCK = W_NUM * 3 + W_PCT;
const W_PLAN_BLOCK = W_NUM * 3 + W_PCT;
const STICKY_LEFT_WIDTH = W_GROUP + W_TOTAL_BLOCK + W_PLAN_BLOCK;

const OPAQUE_STYLE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(hsl(var(--card)), hsl(var(--card))), linear-gradient(hsl(var(--card)), hsl(var(--card)))",
  backgroundColor: "hsl(var(--card))",
};

export function AbdScheduleMatrix({
  data,
  bucket,
  stagesToShow,
  today,
  asOfLabel,
  groupHeader,
  onCellClick,
}: Props) {
  const cellWidth = bucket === "day" ? 64 : 96;

  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const leftBodyRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    const header = headerScrollRef.current;
    const body = bodyScrollRef.current;
    const leftBody = leftBodyRef.current;
    if (!header || !body) return;

    const onHeader = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      body.scrollLeft = header.scrollLeft;
      requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    };
    const onBody = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      header.scrollLeft = body.scrollLeft;
      if (leftBody) leftBody.scrollTop = body.scrollTop;
      requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    };
    const onLeftWheel = (event: WheelEvent) => {
      event.preventDefault();
      body.scrollTop += event.deltaY;
      body.scrollLeft += event.deltaX;
      if (leftBody) leftBody.scrollTop = body.scrollTop;
      header.scrollLeft = body.scrollLeft;
    };

    header.addEventListener("scroll", onHeader);
    body.addEventListener("scroll", onBody);
    leftBody?.addEventListener("wheel", onLeftWheel, { passive: false });
    return () => {
      header.removeEventListener("scroll", onHeader);
      body.removeEventListener("scroll", onBody);
      leftBody?.removeEventListener("wheel", onLeftWheel);
    };
  }, []);

  const todayBucketIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < data.buckets.length; i++) {
      if (data.buckets[i] === today) {
        idx = i;
        break;
      }
      if (data.buckets[i] > today) break;
      idx = i;
    }
    return idx;
  }, [data.buckets, today]);

  const didAutoScrollRef = useRef<string>("");
  useEffect(() => {
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (!body || todayBucketIdx < 0) return;
    const scrollKey = `${data.buckets.length}|${cellWidth}|${todayBucketIdx}`;
    if (didAutoScrollRef.current === scrollKey) return;
    didAutoScrollRef.current = scrollKey;

    const offsetCells = 2;
    const target = Math.max(0, (todayBucketIdx - offsetCells) * cellWidth);
    syncingRef.current = true;
    body.scrollLeft = target;
    if (header) header.scrollLeft = target;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, [todayBucketIdx, data.buckets.length, cellWidth]);

  const isMultiStage = stagesToShow.length > 1;
  const aggregateStageArg: Stage | "all" = isMultiStage ? "all" : stagesToShow[0];

  const timelineGridWidth = data.buckets.length * cellWidth;

  const colVirtualizer = useVirtualizer({
    count: data.buckets.length,
    getScrollElement: () => bodyScrollRef.current,
    estimateSize: () => cellWidth,
    horizontal: true,
    overscan: 4,
  });

  const virtualCols = colVirtualizer.getVirtualItems();
  const leftPad = virtualCols.length > 0 ? virtualCols[0].start : 0;
  const rightPad =
    virtualCols.length > 0 ? colVirtualizer.getTotalSize() - virtualCols[virtualCols.length - 1].end : 0;

  const stageLabel = isMultiStage
    ? stagesToShow.map((s) => STAGE_LABELS[s]).join(" + ")
    : STAGE_LABELS[stagesToShow[0]];
  const totalBlockTitle = isMultiStage
    ? `${stagesToShow.map((s) => STAGE_LABELS[s]).join(" + ")} progress / (items × ${stagesToShow.length})`
    : `${stageLabel} progress / items`;

  return (
    <div className="rounded-md border border-border bg-card">
      {/* Sticky header */}
      <div className="sticky top-0 z-30" style={OPAQUE_STYLE}>
        <div className="flex border-b border-border text-[11px] font-semibold">
          <div
            className="z-40 flex shrink-0 flex-col shadow-[2px_0_4px_-2px_hsl(var(--border))]"
            style={{ width: STICKY_LEFT_WIDTH, ...OPAQUE_STYLE }}
          >
            <div className="flex border-b border-border">
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                style={{ width: W_GROUP }}
              >
                <span className="truncate" title={groupHeader}>
                  {groupHeader}
                </span>
              </div>
              <div
                className="flex items-center justify-center py-1.5 text-[10px] uppercase tracking-wide text-foreground border-l border-border"
                style={{ width: W_TOTAL_BLOCK, minWidth: W_TOTAL_BLOCK, ...OPAQUE_STYLE }}
                title="Overall scope across full timeline"
              >
                Total Scope
              </div>
              <div
                className="flex items-center justify-center py-1.5 text-[10px] uppercase tracking-wide text-foreground border-l-2 border-r border-border"
                style={{ width: W_PLAN_BLOCK, minWidth: W_PLAN_BLOCK, ...OPAQUE_STYLE }}
                title={`Cumulative plan vs actual through ${asOfLabel}`}
              >
                Up to {asOfLabel}
              </div>
            </div>
            <div className="flex">
              <div className="flex items-center px-3 py-2" style={{ width: W_GROUP }} />
              <div className="flex" style={OPAQUE_STYLE}>
                <HeaderNum width={W_NUM} title={`${stageLabel} total scope`}>
                  Total
                </HeaderNum>
                <HeaderNum width={W_NUM} title={`${stageLabel} done count`}>
                  Done
                </HeaderNum>
                <HeaderNum width={W_PCT} title={totalBlockTitle}>
                  %
                </HeaderNum>
                <HeaderNum width={W_NUM} title="Total - Done">
                  Remain
                </HeaderNum>
              </div>
              <div className="flex" style={OPAQUE_STYLE}>
                <HeaderNum width={W_NUM} borderLeft title={`Plan up to ${asOfLabel}`}>
                  Plan
                </HeaderNum>
                <HeaderNum width={W_NUM} title={`Actual up to ${asOfLabel}`}>
                  Actual
                </HeaderNum>
                <HeaderNum width={W_PCT} title={`Actual / Plan up to ${asOfLabel}`}>
                  %
                </HeaderNum>
                <HeaderNum width={W_NUM} borderRight title="Actual - Plan">
                  Diff
                </HeaderNum>
              </div>
            </div>
          </div>

          <div
            ref={headerScrollRef}
            className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable]"
            style={OPAQUE_STYLE}
          >
            <div className="flex flex-col" style={{ width: timelineGridWidth, minWidth: timelineGridWidth }}>
              <div
                className="flex items-center justify-center border-b border-border py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                style={{ width: timelineGridWidth, minWidth: timelineGridWidth }}
              >
                Timeline
              </div>
              <div className="flex">
                <div className="flex" style={{ width: timelineGridWidth, minWidth: timelineGridWidth }}>
                  {data.buckets.map((b, i) => {
                    const lbl = formatBucketLabel(b, bucket);
                    const isToday = i === todayBucketIdx;
                    return (
                      <div
                        key={b}
                        className={cn(
                          "flex flex-col items-center justify-center border-r border-border px-1 py-1.5 text-center",
                          isToday && "border-l-2 border-l-primary bg-primary/10",
                        )}
                        style={{ width: cellWidth, minWidth: cellWidth }}
                      >
                        <div className="leading-tight">{lbl.primary}</div>
                        <div className="text-[9px] font-normal text-muted-foreground leading-tight">
                          {lbl.secondary}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex">
        <div
          ref={leftBodyRef}
          className="max-h-[calc(100dvh-360px)] shrink-0 overflow-hidden shadow-[2px_0_4px_-2px_hsl(var(--border))]"
          style={{ width: STICKY_LEFT_WIDTH, ...OPAQUE_STYLE }}
        >
          {data.rows.map((row) => {
            const showStageRows = isMultiStage;
            return (
              <Fragment key={`left-${row.key}`}>
                <div
                  className={cn(
                    "flex border-b border-border text-xs h-14",
                    showStageRows ? "font-semibold" : "hover:bg-accent/30",
                  )}
                  style={OPAQUE_STYLE}
                >
                  <div className="flex items-center gap-1 px-2 text-left" style={{ width: W_GROUP }}>
                    <span className="truncate font-medium" title={row.label}>
                      {row.label}
                    </span>
                  </div>
                  <div className="flex">
                    <TotalDoneCells total={row.total} done={row.doneCount} bold py="py-0" />
                  </div>
                  <div className="flex">
                    <PlanActualCells plan={row.cumPlan} actual={row.cumActual} asOfLabel={asOfLabel} bold py="py-0" />
                  </div>
                </div>

                {showStageRows &&
                  stagesToShow.map((st) => {
                    const sr = row.stages[st];
                    return (
                      <div
                        key={`left-${row.key}-${st}`}
                        className="flex border-b border-border text-[11px] h-14 hover:bg-accent/20"
                        style={OPAQUE_STYLE}
                      >
                        <div
                          className="flex items-center gap-2 px-2 pl-8 text-muted-foreground"
                          style={{ width: W_GROUP }}
                        >
                          <span
                            className={cn(
                              "inline-flex h-4 min-w-7 px-1 items-center justify-center rounded text-[9px] font-semibold",
                              st === "draft_start" && "bg-secondary text-secondary-foreground",
                              st === "draft_finish" && "bg-violet-500/15 text-violet-700 dark:text-violet-400",
                              st === "submission" && "bg-primary/20 text-primary",
                              st === "dar" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                            )}
                          >
                            {STAGE_SHORT_LABELS[st]}
                          </span>
                        </div>
                        <div className="flex">
                          <TotalDoneCells total={sr.total} done={sr.totalDone} py="py-0" />
                        </div>
                        <div className="flex">
                          <PlanActualCells plan={sr.cumPlan} actual={sr.cumActual} asOfLabel={asOfLabel} py="py-0" />
                        </div>
                      </div>
                    );
                  })}
              </Fragment>
            );
          })}
        </div>

        <div
          ref={bodyScrollRef}
          className="max-h-[calc(100dvh-360px)] min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
        >
          <div style={{ width: timelineGridWidth, minWidth: timelineGridWidth }}>
            {data.rows.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No data in selected range.</div>
            )}
            {data.rows.map((row) => {
              const showStageRows = isMultiStage;
              return (
                <Fragment key={row.key}>
                  <div
                    className={cn(
                      "flex border-b border-border text-xs h-14",
                      showStageRows ? "bg-muted/30 font-semibold" : "hover:bg-accent/30",
                    )}
                  >
                    {leftPad > 0 && <div style={{ width: leftPad, minWidth: leftPad }} />}
                    {virtualCols.map((vc) => {
                      const c = row.combined[vc.index];
                      if (!c) return null;
                      return (
                        <ScheduleCell
                          key={c.bucket}
                          plan={c.plan}
                          actual={c.actual}
                          isFuture={vc.index > todayBucketIdx}
                          isToday={vc.index === todayBucketIdx}
                          width={cellWidth}
                          onPlanClick={
                            onCellClick
                              ? () => onCellClick(row.groupKeyRaw, c.bucket, aggregateStageArg, "planned")
                              : undefined
                          }
                          onActualClick={
                            onCellClick
                              ? () => onCellClick(row.groupKeyRaw, c.bucket, aggregateStageArg, "actual")
                              : undefined
                          }
                        />
                      );
                    })}
                    {rightPad > 0 && <div style={{ width: rightPad, minWidth: rightPad }} />}
                  </div>

                  {showStageRows &&
                    stagesToShow.map((st) => {
                      const sr = row.stages[st];
                      return (
                        <div
                          key={st}
                          className="flex border-b border-border bg-muted/20 text-[11px] h-14 hover:bg-accent/20"
                        >
                          {leftPad > 0 && <div style={{ width: leftPad, minWidth: leftPad }} />}
                          {virtualCols.map((vc) => {
                            const c = sr.cells[vc.index];
                            if (!c) return null;
                            return (
                              <ScheduleCell
                                key={c.bucket}
                                plan={c.plan}
                                actual={c.actual}
                                isFuture={vc.index > todayBucketIdx}
                                isToday={vc.index === todayBucketIdx}
                                width={cellWidth}
                                onPlanClick={
                                  onCellClick
                                    ? () => onCellClick(row.groupKeyRaw, c.bucket, st, "planned")
                                    : undefined
                                }
                                onActualClick={
                                  onCellClick
                                    ? () => onCellClick(row.groupKeyRaw, c.bucket, st, "actual")
                                    : undefined
                                }
                              />
                            );
                          })}
                          {rightPad > 0 && <div style={{ width: rightPad, minWidth: rightPad }} />}
                        </div>
                      );
                    })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderNum({
  width,
  children,
  title,
  borderLeft,
  borderRight,
}: {
  width: number;
  children: React.ReactNode;
  title?: string;
  borderLeft?: boolean;
  borderRight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-end px-1.5 py-2 border-l border-border",
        borderLeft && "border-l-2",
        borderRight && "border-r border-border",
      )}
      style={{ width, minWidth: width }}
      title={title}
    >
      {children}
    </div>
  );
}

function NumCell({
  width,
  children,
  className,
  py = "py-2",
  borderLeft,
  borderRight,
  title,
}: {
  width: number;
  children: React.ReactNode;
  className?: string;
  py?: string;
  borderLeft?: boolean;
  borderRight?: boolean;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-end px-1.5 tabular-nums border-l border-border",
        borderLeft && "border-l-2",
        borderRight && "border-r border-border",
        py,
        className,
      )}
      style={{ width, minWidth: width }}
      title={title}
    >
      {children}
    </div>
  );
}

function TotalDoneCells({
  total,
  done,
  bold,
  py,
}: {
  total: number;
  done: number;
  bold?: boolean;
  py: string;
}) {
  const pct = total > 0 ? (done / total) * 100 : null;
  const remain = total - done;
  return (
    <>
      <NumCell width={W_NUM} py={py}>
        {total}
      </NumCell>
      <NumCell width={W_NUM} py={py} className={bold ? "font-semibold" : ""}>
        {done}
      </NumCell>
      <NumCell width={W_PCT} py={py} className="text-muted-foreground text-[10px]">
        {pct === null ? "—" : `${pct.toFixed(0)}%`}
      </NumCell>
      <NumCell
        width={W_NUM}
        py={py}
        className={cn(remain > 0 ? "text-schedule-short" : "text-muted-foreground")}
      >
        {remain}
      </NumCell>
    </>
  );
}

function PlanActualCells({
  plan,
  actual,
  asOfLabel,
  bold,
  py,
}: {
  plan: number;
  actual: number;
  asOfLabel: string;
  bold?: boolean;
  py: string;
}) {
  const pct = plan > 0 ? (actual / plan) * 100 : null;
  const diff = actual - plan;
  const accent =
    pct === null ? "" : pct < 100 ? "text-schedule-short" : pct > 100 ? "text-schedule-over" : "";
  const diffAccent =
    diff < 0 ? "text-schedule-short" : diff > 0 ? "text-schedule-over" : "text-muted-foreground";
  return (
    <>
      <NumCell width={W_NUM} py={py} borderLeft title={`Plan up to ${asOfLabel}`}>
        {plan}
      </NumCell>
      <NumCell
        width={W_NUM}
        py={py}
        title={`Actual up to ${asOfLabel}`}
        className={cn(bold && "font-semibold", accent)}
      >
        {actual}
      </NumCell>
      <NumCell width={W_PCT} py={py} className={cn("text-[10px]", accent)}>
        {pct === null ? "—" : `${pct.toFixed(0)}%`}
      </NumCell>
      <NumCell width={W_NUM} py={py} borderRight className={cn(diffAccent, bold && "font-semibold")}>
        {diff > 0 ? `+${diff}` : diff}
      </NumCell>
    </>
  );
}
