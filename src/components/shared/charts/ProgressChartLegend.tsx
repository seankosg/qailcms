/**
 * Progress 차트 공통 범례 (표시·상호작용 전용).
 *
 * 값·색상·계산은 절대 만들지 않는다. 모듈이 series(label/color/dataKey 관계)와
 * 토글 상태만 넘기고, 이 컴포넌트는 그 의미를 짧은 2~3단 구조로 보여준다.
 */
import { cn } from "@/lib/utils";
import { formatDdMmmYyyy } from "@/lib/time/doha";

export type ProgressLegendMode =
  | "period-cumulative"
  | "line-plan-actual"
  | "simple-plan-actual"
  | "variance";

export type LegendSample = "bar-plan" | "bar-actual" | "line-dashed" | "line-solid" | "swatch";

export interface ProgressLegendMetric {
  key: string;
  label: string;
  sample: LegendSample;
  /** 표본 색. 주지 않으면 currentColor 계열 기본값 */
  color?: string;
}

export interface ProgressLegendSeries {
  key: string;
  label: string;
  color: string;
}

export interface ProgressChartLegendProps {
  mode: ProgressLegendMode;
  /** 기본 metric 세트를 바꿀 때만 넘긴다 */
  metrics?: ProgressLegendMetric[];
  series?: ProgressLegendSeries[];
  hiddenMetrics?: ReadonlySet<string>;
  hiddenSeries?: ReadonlySet<string>;
  onToggleMetric?: (key: string) => void;
  onToggleSeries?: (key: string) => void;
  onReset?: () => void;
  /** 되돌릴 게 있을 때만 Reset 을 보인다 */
  canReset?: boolean;
  axes?: { left?: string; right?: string };
  marker?: { label: string; date?: string | null };
  lang?: "ko" | "en";
  className?: string;
}

const KO = {
  guide: "범례",
  series: "구분",
  axes: "축",
  left: "왼쪽",
  right: "오른쪽",
  reset: "범례 초기화",
  periodPlan: "기간 계획",
  periodActual: "기간 실적",
  cumPlan: "누적 계획",
  cumActual: "누적 실적",
  plan: "계획",
  actual: "실적",
  variance: "차이 = 실적 − 계획",
  ahead: "선행 (+)",
  behind: "지연 (−)",
};

const EN = {
  guide: "Chart guide",
  series: "Series",
  axes: "Axes",
  left: "Left",
  right: "Right",
  reset: "Reset series",
  periodPlan: "Period Plan",
  periodActual: "Period Actual",
  cumPlan: "Cumulative Plan",
  cumActual: "Cumulative Actual",
  plan: "Plan",
  actual: "Actual",
  variance: "Variance = Actual − Plan",
  ahead: "Ahead (+)",
  behind: "Behind (−)",
};

export function legendDict(lang: "ko" | "en" = "ko") {
  return lang === "en" ? EN : KO;
}

/** mode 별 기본 metric 세트 — 색은 모듈이 덮어쓴다. */
export function defaultMetrics(
  mode: ProgressLegendMode,
  lang: "ko" | "en" = "ko",
): ProgressLegendMetric[] {
  const t = legendDict(lang);
  if (mode === "period-cumulative") {
    return [
      { key: "periodPlan", label: t.periodPlan, sample: "bar-plan" },
      { key: "periodActual", label: t.periodActual, sample: "bar-actual" },
      { key: "cumPlan", label: t.cumPlan, sample: "line-dashed" },
      { key: "cumActual", label: t.cumActual, sample: "line-solid" },
    ];
  }
  if (mode === "line-plan-actual" || mode === "simple-plan-actual") {
    return [
      { key: "actual", label: t.actual, sample: "line-solid" },
      { key: "plan", label: t.plan, sample: "line-dashed" },
    ];
  }
  return [];
}

function Sample({ sample, color }: { sample: LegendSample; color?: string }) {
  const c = color ?? "currentColor";
  if (sample === "line-dashed" || sample === "line-solid") {
    return (
      <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true" className="shrink-0">
        <line
          x1="0"
          y1="4"
          x2="16"
          y2="4"
          stroke={c}
          strokeWidth={sample === "line-solid" ? 3 : 2}
          strokeDasharray={sample === "line-dashed" ? "5 3" : undefined}
        />
      </svg>
    );
  }
  if (sample === "bar-plan") {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 shrink-0 rounded-[2px] border"
        style={{
          borderColor: c,
          backgroundImage: `repeating-linear-gradient(45deg, ${c} 0 2px, transparent 2px 4px)`,
        }}
      />
    );
  }
  if (sample === "bar-actual") {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 shrink-0 rounded-[2px]"
        style={{ backgroundColor: c }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: c }}
    />
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const cls = cn(
    "inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[11px] leading-none",
    active ? "opacity-100" : "opacity-40 line-through decoration-1",
  );
  if (!onClick) {
    return <span className={cls}>{children}</span>;
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        cls,
        "transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {children}
    </button>
  );
}

export function ProgressChartLegend({
  mode,
  metrics,
  series = [],
  hiddenMetrics,
  hiddenSeries,
  onToggleMetric,
  onToggleSeries,
  onReset,
  canReset,
  axes,
  marker,
  lang = "ko",
  className,
}: ProgressChartLegendProps) {
  const t = legendDict(lang);
  const items = metrics ?? defaultMetrics(mode, lang);
  const showSeries = series.length > 1;
  const showReset = Boolean(onReset) && (canReset ?? true);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-muted/20 px-3 py-2 text-[11px]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="mr-1 shrink-0 font-semibold uppercase tracking-wide text-muted-foreground">
          {mode === "variance" ? t.variance : t.guide}
        </span>
        {items.map((m) => (
          <Chip
            key={m.key}
            active={!hiddenMetrics?.has(m.key)}
            onClick={onToggleMetric ? () => onToggleMetric(m.key) : undefined}
          >
            <Sample sample={m.sample} color={m.color} />
            <span>{m.label}</span>
          </Chip>
        ))}
        {marker && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground">
            <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
              <line
                x1="4"
                y1="0"
                x2="4"
                y2="14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
            </svg>
            <span>
              {marker.label}
              {marker.date ? ` ${formatDdMmmYyyy(marker.date) || marker.date}` : ""}
            </span>
          </span>
        )}
      </div>

      {showSeries && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="mr-1 shrink-0 font-semibold uppercase tracking-wide text-muted-foreground">
            {t.series}
          </span>
          {series.map((s) => (
            <Chip
              key={s.key}
              active={!hiddenSeries?.has(s.key)}
              onClick={onToggleSeries ? () => onToggleSeries(s.key) : undefined}
            >
              <Sample sample="swatch" color={s.color} />
              <span>{s.label}</span>
            </Chip>
          ))}
          {showReset && (
            <button
              type="button"
              onClick={onReset}
              className="ml-auto inline-flex h-[26px] items-center rounded-md border px-2 text-[11px] text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.reset}
            </button>
          )}
        </div>
      )}

      {(axes?.left || axes?.right) && (
        <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
          <span className="mr-1 shrink-0 font-semibold uppercase tracking-wide">{t.axes}</span>
          <span>
            {axes.left ? `${t.left}: ${axes.left}` : ""}
            {axes.left && axes.right ? " · " : ""}
            {axes.right ? `${t.right}: ${axes.right}` : ""}
          </span>
          {!showSeries && showReset && (
            <button
              type="button"
              onClick={onReset}
              className="ml-auto inline-flex h-[26px] items-center rounded-md border px-2 text-[11px] transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.reset}
            </button>
          )}
        </div>
      )}

      {!showSeries && !axes?.left && !axes?.right && showReset && (
        <div className="flex">
          <button
            type="button"
            onClick={onReset}
            className="ml-auto inline-flex h-[26px] items-center rounded-md border px-2 text-[11px] text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.reset}
          </button>
        </div>
      )}
    </div>
  );
}

/** Variance 전용 한 줄 — 양수/음수 색 표본만 보여준다(계산 없음). */
export function VarianceLegend({
  aheadColor,
  behindColor,
  unitNote,
  lang = "ko",
  className,
}: {
  aheadColor: string;
  behindColor: string;
  /** 예: "Variance (No.)" — 축 단위를 한 번만 적는다 */
  unitNote?: string;
  lang?: "ko" | "en";
  className?: string;
}) {
  const t = legendDict(lang);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <span className="font-semibold uppercase tracking-wide">{t.variance}</span>
      <span className="inline-flex items-center gap-1.5">
        <Sample sample="bar-actual" color={aheadColor} />
        {t.ahead}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Sample sample="bar-actual" color={behindColor} />
        {t.behind}
      </span>
      {unitNote && <span className="ml-auto">{unitNote}</span>}
    </div>
  );
}