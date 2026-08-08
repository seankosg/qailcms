// TM KPI Analysis — Plan vs Actual S-Curve 시리즈 빌더.
// 수치 정본: derived.ts 의 cumPlanProgress(=computeTPlan) / normActual.
// 이 파일은 자체 판정·자체 계획식을 만들지 않는다(시간축 샘플링과 평균만 담당).

import type { TaskItem } from "./schedule-utils";
import { cumPlanProgress, cumActualProgress } from "./derived";

export type SCurveBucket = "day" | "week" | "month";

export interface SnapshotPoint {
  d: string;
  v: number;
}

export interface TmSCurveResult {
  buckets: string[];
  bucketLabels: string[];
  /** asOf 가 속한(또는 직후) 버킷 인덱스. 없으면 -1 */
  todayIndex: number;
  taskCount: number;
  /** 0..100 (%) */
  cumPlan: number[];
  cumActual: (number | null)[];
  /** 버킷 간 증분(pp) */
  dailyPlan: number[];
  dailyActual: (number | null)[];
  /** 해당 버킷의 Actual 이 저장 스냅샷 실측에 기반하는가 */
  measured: boolean[];
}

const MAX_BUCKETS = 800;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parse(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
function labelOf(isoDate: string, bucket: SCurveBucket): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  if (bucket === "month") return `${mon}-${String(d.getUTCFullYear()).slice(2)}`;
  return `${d.getUTCDate()}-${mon}`;
}

function buildBuckets(startIso: string, endIso: string, bucket: SCurveBucket): string[] {
  const start = parse(startIso)!;
  const end = parse(endIso)!;
  const out: string[] = [];
  if (bucket === "month") {
    let cur = endOfMonth(start);
    while (cur <= end && out.length < MAX_BUCKETS) {
      out.push(iso(cur));
      cur = endOfMonth(addDays(cur, 1));
    }
  } else {
    const step = bucket === "week" ? 7 : 1;
    let cur = start;
    while (cur <= end && out.length < MAX_BUCKETS) {
      out.push(iso(cur));
      cur = addDays(cur, step);
    }
  }
  const last = iso(end);
  if (out.length === 0) out.push(last);
  else if (out[out.length - 1] !== last && out.length < MAX_BUCKETS) out.push(last);
  return out;
}

interface ItemActualSeries {
  /** 오름차순 앵커 (ISO, 0..1). 실측 스냅샷 여부 포함 */
  anchors: Array<{ d: string; v: number; measured: boolean }>;
}

/** 과업 1건의 실적 앵커 구성.
 *  - 저장 스냅샷 포인트 = 실측(measured=true)
 *  - 시작 앵커 = actual_start ?? plan_start 에서 0
 *  - 끝 앵커 = actual_finish 면 그 날짜 1.0, 아니면 asOf 에서 현재 실적
 *  앵커 사이 구간은 2점 직선(선형 역산)으로 채운다. */
function buildItemAnchors(
  it: TaskItem,
  asOf: string,
  points: SnapshotPoint[] | null,
): ItemActualSeries {
  const anchors: Array<{ d: string; v: number; measured: boolean }> = [];
  const startIso =
    (it.actual_start ? String(it.actual_start).slice(0, 10) : null) ??
    (it.plan_start ? String(it.plan_start).slice(0, 10) : null);
  if (startIso) anchors.push({ d: startIso, v: 0, measured: false });

  for (const p of points ?? []) {
    if (!p || typeof p.d !== "string") continue;
    const d = p.d.slice(0, 10);
    if (d > asOf) continue;
    const v = Math.max(0, Math.min(1, Number(p.v ?? 0)));
    anchors.push({ d, v, measured: true });
  }

  const finIso = it.actual_finish ? String(it.actual_finish).slice(0, 10) : null;
  if (finIso && finIso <= asOf) {
    anchors.push({ d: finIso, v: 1, measured: true });
  } else {
    anchors.push({ d: asOf, v: cumActualProgress(it), measured: false });
  }

  anchors.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  // 같은 날짜 중복 시 실측 우선
  const dedup: typeof anchors = [];
  for (const a of anchors) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.d === a.d) {
      if (a.measured) dedup[dedup.length - 1] = a;
      continue;
    }
    dedup.push(a);
  }
  return { anchors: dedup };
}

function valueAt(series: ItemActualSeries, d: string): number {
  const a = series.anchors;
  if (a.length === 0) return 0;
  if (d <= a[0].d) return a[0].v;
  if (d >= a[a.length - 1].d) return a[a.length - 1].v;
  for (let i = 1; i < a.length; i++) {
    if (d <= a[i].d) {
      const p0 = a[i - 1];
      const p1 = a[i];
      const t0 = new Date(`${p0.d}T00:00:00Z`).getTime();
      const t1 = new Date(`${p1.d}T00:00:00Z`).getTime();
      const t = new Date(`${d}T00:00:00Z`).getTime();
      if (t1 <= t0) return p1.v;
      return p0.v + ((p1.v - p0.v) * (t - t0)) / (t1 - t0);
    }
  }
  return a[a.length - 1].v;
}

/** 버킷 구간 내에 실측 스냅샷 앵커가 존재하는가 */
function hasMeasuredIn(series: ItemActualSeries, from: string, to: string): boolean {
  return series.anchors.some((a) => a.measured && a.d > from && a.d <= to);
}

export function buildTmSCurve(opts: {
  items: TaskItem[];
  asOf: string;
  bucket: SCurveBucket;
  /** 과업별 저장 실적 스냅샷 조회기 */
  pointsOf?: (it: TaskItem) => SnapshotPoint[] | null;
}): TmSCurveResult {
  const { items, asOf, bucket, pointsOf } = opts;
  const empty: TmSCurveResult = {
    buckets: [],
    bucketLabels: [],
    todayIndex: -1,
    taskCount: 0,
    cumPlan: [],
    cumActual: [],
    dailyPlan: [],
    dailyActual: [],
    measured: [],
  };
  if (!items.length) return empty;

  let minIso: string | null = null;
  let maxIso: string | null = null;
  for (const it of items) {
    for (const v of [it.plan_start, it.actual_start]) {
      const s = v ? String(v).slice(0, 10) : null;
      if (s && (!minIso || s < minIso)) minIso = s;
    }
    for (const v of [it.plan_end, it.actual_finish]) {
      const s = v ? String(v).slice(0, 10) : null;
      if (s && (!maxIso || s > maxIso)) maxIso = s;
    }
  }
  if (!minIso) return empty;
  if (!maxIso || maxIso < asOf) maxIso = asOf;

  const buckets = buildBuckets(minIso, maxIso, bucket);
  const n = buckets.length;
  const bucketLabels = buckets.map((b) => labelOf(b, bucket));

  const seriesList = items.map((it) => buildItemAnchors(it, asOf, pointsOf?.(it) ?? null));

  const cumPlan: number[] = new Array(n).fill(0);
  const cumActual: (number | null)[] = new Array(n).fill(null);
  const measured: boolean[] = new Array(n).fill(false);

  let todayIndex = -1;
  for (let i = 0; i < n; i++) {
    if (buckets[i] >= asOf) {
      todayIndex = i;
      break;
    }
  }

  for (let i = 0; i < n; i++) {
    const d = buckets[i];
    let planSum = 0;
    for (const it of items) planSum += cumPlanProgress(it, d);
    cumPlan[i] = (planSum / items.length) * 100;

    if (d > asOf) continue;
    let actSum = 0;
    let measuredCnt = 0;
    const from = i > 0 ? buckets[i - 1] : "0000-00-00";
    for (const s of seriesList) {
      actSum += valueAt(s, d);
      if (hasMeasuredIn(s, from, d)) measuredCnt++;
    }
    cumActual[i] = (actSum / items.length) * 100;
    measured[i] = measuredCnt * 2 >= items.length; // 과반 실측 시 실선
  }

  const dailyPlan: number[] = new Array(n).fill(0);
  const dailyActual: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    dailyPlan[i] = cumPlan[i] - (i > 0 ? cumPlan[i - 1] : 0);
    const cur = cumActual[i];
    if (cur == null) continue;
    const prev = i > 0 ? cumActual[i - 1] : 0;
    dailyActual[i] = cur - (prev ?? 0);
  }

  return {
    buckets,
    bucketLabels,
    todayIndex,
    taskCount: items.length,
    cumPlan,
    cumActual,
    dailyPlan,
    dailyActual,
    measured,
  };
}
