// TM KPI Analysis — Plan vs Actual S-Curve 시리즈 빌더.
// 수치 정본: derived.ts 의 cumPlanProgress(=computeTPlan) / normActual.
// 이 파일은 자체 판정·자체 계획식을 만들지 않는다(시간축 샘플링과 평균만 담당).
//
// 시간축 규칙 (2026-08-08 확정)
//  - 기준 시간대는 도하(Asia/Qatar). 날짜 문자열(YYYY-MM-DD)은 도하 달력일로 해석한다.
//  - 주는 "토요일 시작" 달력 주. 데이터 시작일과 무관하게 경계가 고정된다.
//  - 일/주/월 모두 "구간의 마지막 날"에서 누계를 재고, 그 날짜를 라벨로 쓴다.
//  - 종료일을 마지막 칸으로 강제 추가하지 않는다(짧은 칸이 생기지 않도록).

import type { TaskItem } from "./schedule-utils";
import { cumPlanProgress, cumActualProgress } from "./derived";
import { formatDdMmm, formatDdMmmYy } from "@/lib/time/doha";

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
  /** 실적 시작 앵커를 잡을 수 없어 실적 곡선에서 제외된 과업 수 */
  excludedCount: number;
  /** 0..100 (%) */
  cumPlan: number[];
  cumActual: (number | null)[];
  /** 버킷 간 증분(pp) */
  dailyPlan: number[];
  dailyActual: (number | null)[];
  /** 창 시작 직전 시점의 누계(pp) — 첫 막대가 튀지 않도록 기준선으로 뺀다. */
  baselinePlan: number;
  baselineActual: number | null;
}

const MAX_BUCKETS = 800;

/** ISO(도하 달력일) 문자열을 달력 계산용 Date 로. UTC 컴포넌트 = 도하 달력값. */
function parse(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}
function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
/** 해당 날짜가 속한 토요일 시작 주의 마지막 날(금요일). */
function endOfSatWeek(d: Date): Date {
  const dow = d.getUTCDay(); // 0=Sun .. 6=Sat
  const sinceSat = (dow + 1) % 7;
  const sat = addDays(d, -sinceSat);
  return addDays(sat, 6);
}
function labelOf(isoDate: string, bucket: SCurveBucket): string {
  return bucket === "month" ? formatDdMmmYy(isoDate) : formatDdMmm(isoDate);
}

/** 버킷 종료일이 속한 구간의 시작일. */
function periodStart(bucketEndIso: string, bucket: SCurveBucket): Date {
  const d = parse(bucketEndIso)!;
  if (bucket === "day") return d;
  if (bucket === "week") return addDays(d, -6);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** 구간의 마지막 날짜 배열(오름차순). 종료일 강제 추가 없음. */
function buildBuckets(startIso: string, endIso: string, bucket: SCurveBucket): string[] {
  const start = parse(startIso)!;
  const end = parse(endIso)!;
  const out: string[] = [];
  let cur =
    bucket === "month" ? endOfMonth(start) : bucket === "week" ? endOfSatWeek(start) : start;
  while (cur <= end && out.length < MAX_BUCKETS) {
    out.push(iso(cur));
    cur =
      bucket === "month" ? endOfMonth(addDays(cur, 1)) : addDays(cur, bucket === "week" ? 7 : 1);
  }
  // 종료일이 속한 구간까지 포함한다(마지막 구간이 잘리지 않도록).
  if (out.length === 0 || (out[out.length - 1] < iso(end) && out.length < MAX_BUCKETS)) {
    out.push(iso(cur));
  }
  return out;
}

interface ItemActualSeries {
  /** 오름차순 앵커 (ISO, 0..1) */
  anchors: Array<{ d: string; v: number }>;
}

/** 과업 1건의 실적 앵커 구성.
 *  시작 앵커 우선순위: actual_start → plan_start → (plan_end − plan_days)
 *  셋 다 없으면 null 을 돌려 실적 곡선 계산에서 제외한다.
 *  끝 앵커 = actual_finish 면 그 날짜 1.0, 아니면 asOf 에서 현재 실적.
 *  앵커 사이 구간은 2점 직선(선형 역산)으로 채운다. */
function buildItemAnchors(
  it: TaskItem,
  asOf: string,
  points: SnapshotPoint[] | null,
): ItemActualSeries | null {
  const startIso = resolveStartAnchor(it);
  if (!startIso) return null;

  const anchors: Array<{ d: string; v: number; measured: boolean }> = [
    { d: startIso, v: 0, measured: false },
  ];

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
  return { anchors: dedup.map(({ d, v }) => ({ d, v })) };
}

/** 실적 시작 앵커: actual_start → plan_start → plan_end − plan_days */
function resolveStartAnchor(it: TaskItem): string | null {
  if (it.actual_start) return String(it.actual_start).slice(0, 10);
  if (it.plan_start) return String(it.plan_start).slice(0, 10);
  const end = parse(it.plan_end);
  const days = Number(it.plan_days ?? 0);
  if (end && Number.isFinite(days) && days > 0) return iso(addDays(end, -days));
  return null;
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

export function buildTmSCurve(opts: {
  items: TaskItem[];
  asOf: string;
  bucket: SCurveBucket;
  /** 차트 시작일(ISO). 모집단 최소일과 비교해 더 늦은 쪽을 창 시작으로 쓴다. */
  startFrom?: string | null;
  /** 과업별 저장 실적 스냅샷 조회기 */
  pointsOf?: (it: TaskItem) => SnapshotPoint[] | null;
}): TmSCurveResult {
  const { items, asOf, bucket, startFrom, pointsOf } = opts;
  const empty: TmSCurveResult = {
    buckets: [],
    bucketLabels: [],
    todayIndex: -1,
    taskCount: 0,
    excludedCount: 0,
    cumPlan: [],
    cumActual: [],
    dailyPlan: [],
    dailyActual: [],
    baselinePlan: 0,
    baselineActual: null,
  };
  if (!items.length) return empty;

  let minIso: string | null = null;
  let maxIso: string | null = null;
  for (const it of items) {
    for (const v of [it.plan_start, it.actual_start, resolveStartAnchor(it)]) {
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

  // 창 시작 = max(모집단 최소일, 지정 시작일). 구간 경계 스냅은 buildBuckets 가 수행한다.
  const startIso = startFrom && startFrom > minIso ? startFrom.slice(0, 10) : minIso;
  const windowStart = startIso > maxIso ? maxIso : startIso;
  const buckets = buildBuckets(windowStart, maxIso, bucket);
  const n = buckets.length;
  const bucketLabels = buckets.map((b) => labelOf(b, bucket));

  const seriesList: ItemActualSeries[] = [];
  let excludedCount = 0;
  for (const it of items) {
    const s = buildItemAnchors(it, asOf, pointsOf?.(it) ?? null);
    if (s) seriesList.push(s);
    else excludedCount++;
  }

  const cumPlan: number[] = new Array(n).fill(0);
  const cumActual: (number | null)[] = new Array(n).fill(null);

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
    if (!seriesList.length) continue;
    let actSum = 0;
    for (const s of seriesList) actSum += valueAt(s, d);
    cumActual[i] = (actSum / seriesList.length) * 100;
  }

  const dailyPlan: number[] = new Array(n).fill(0);
  const dailyActual: (number | null)[] = new Array(n).fill(null);

  // 창 시작 직전 시점의 누계(기준선) — 창 이전 누계가 첫 막대에 몰리지 않게 한다.
  const baseIso = n > 0 ? iso(addDays(periodStart(buckets[0], bucket), -1)) : windowStart;
  let basePlanSum = 0;
  for (const it of items) basePlanSum += cumPlanProgress(it, baseIso);
  const baselinePlan = (basePlanSum / items.length) * 100;
  let baselineActual: number | null = null;
  if (baseIso <= asOf && seriesList.length) {
    let s = 0;
    for (const sr of seriesList) s += valueAt(sr, baseIso);
    baselineActual = (s / seriesList.length) * 100;
  }

  for (let i = 0; i < n; i++) {
    dailyPlan[i] = cumPlan[i] - (i > 0 ? cumPlan[i - 1] : baselinePlan);
    const cur = cumActual[i];
    if (cur == null) continue;
    const prev = i > 0 ? cumActual[i - 1] : baselineActual;
    dailyActual[i] = cur - (prev ?? baselineActual ?? 0);
  }

  return {
    buckets,
    bucketLabels,
    todayIndex,
    taskCount: items.length,
    excludedCount,
    cumPlan,
    cumActual,
    dailyPlan,
    dailyActual,
    baselinePlan,
    baselineActual,
  };
}
