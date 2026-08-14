/**
 * SPL Progress Status(S-Curve) 시리즈 빌더.
 * 정본 경유 원칙: 입력은 `spl_rows_as_of` 가 내려준 rows/catalog 뿐이며,
 * 원시 테이블 직조회나 상태 재판정은 하지 않는다. 여기서는 이미 확정된
 * 계획일/실적일을 버킷에 담아 세기만 한다.
 */
import type { SplCatalogEntry, SplRow } from "@/lib/spl/rows.functions";

export type SplBucket = "day" | "week" | "month";
/** baseline = 계획일 원본 그대로 / remaining = 미이행 과거 계획을 기준일로 당겨 표시 */
export type SplPlanMode = "baseline" | "remaining";

export type SplSeriesGroup = {
  key: string;
  label: string;
  color: string;
  stages: string[];
};

export type SplSeries = {
  key: string;
  dailyPlan: number[];
  dailyActual: (number | null)[];
  cumPlan: number[];
  cumActual: (number | null)[];
  denom: number;
};

export type SplSCurve = {
  buckets: string[];
  bucketLabels: string[];
  todayIndex: number;
  series: SplSeries[];
};

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function addDaysIso(d: string, n: number): string {
  return iso(ms(d) + n * DAY);
}

/** 버킷 시작일 — day: 그날, week: 그 주 월요일, month: 그 달 1일 */
export function bucketStart(d: string, b: SplBucket): string {
  if (b === "day") return d;
  if (b === "month") return `${d.slice(0, 7)}-01`;
  const t = ms(d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon=0
  return iso(t - dow * DAY);
}

function nextBucket(d: string, b: SplBucket): string {
  if (b === "day") return addDaysIso(d, 1);
  if (b === "week") return addDaysIso(d, 7);
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export function bucketLabel(d: string, b: SplBucket): string {
  const mon = MONTHS[Number(d.slice(5, 7)) - 1];
  if (b === "month") return `${mon}-${d.slice(2, 4)}`;
  return `${Number(d.slice(8, 10))}-${mon}`;
}

/** 단계별 계획/실적 대표일 — finish 우선, 없으면 start */
function planDate(row: SplRow, code: string): string | null {
  const c = row.stages[code];
  if (!c || c.na) return null;
  return (c.pf || c.ps || null)?.slice(0, 10) ?? null;
}
function actualDate(row: SplRow, code: string): string | null {
  const c = row.stages[code];
  if (!c || c.na) return null;
  return (c.af || c.as || null)?.slice(0, 10) ?? null;
}

/** 그룹(단계 또는 밴드)별 분모 = N/A 가 아닌 (행 × 단계) 조합 수 */
export function groupDenominator(rows: SplRow[], stages: string[]): number {
  let n = 0;
  for (const r of rows) for (const s of stages) if (r.stages[s] && !r.stages[s].na) n += 1;
  return n;
}

export function buildSplSCurve(opts: {
  rows: SplRow[];
  groups: SplSeriesGroup[];
  bucket: SplBucket;
  planMode: SplPlanMode;
  /** 기준일(As-of). 이 버킷 이후 실적은 null 로 끊는다. */
  asOf: string;
  /** 기준일 전후로 보여줄 일수 */
  rangeDays: number;
}): SplSCurve {
  const { rows, groups, bucket, planMode, asOf, rangeDays } = opts;

  const winStart = bucketStart(addDaysIso(asOf, -rangeDays), bucket);
  const winEnd = bucketStart(addDaysIso(asOf, rangeDays), bucket);

  // 관측된 날짜 범위 ∩ 표시 창
  let minD: string | null = null;
  let maxD: string | null = null;
  const touch = (d: string | null) => {
    if (!d) return;
    if (!minD || d < minD) minD = d;
    if (!maxD || d > maxD) maxD = d;
  };
  for (const r of rows)
    for (const g of groups)
      for (const s of g.stages) {
        touch(planDate(r, s));
        touch(actualDate(r, s));
      }

  const startD = bucketStart(minD && minD > winStart ? minD : winStart, bucket);
  const endRaw = maxD && maxD < winEnd ? maxD : winEnd;
  const endD = bucketStart(endRaw < startD ? startD : endRaw, bucket);

  const buckets: string[] = [];
  for (let b = startD; b <= endD && buckets.length < 400; b = nextBucket(b, bucket)) buckets.push(b);
  if (buckets.length === 0) buckets.push(startD);

  const n = buckets.length;
  const asOfBucket = bucketStart(asOf, bucket);
  let todayIndex = -1;
  for (let i = 0; i < n; i++) if (buckets[i] >= asOfBucket) { todayIndex = i; break; }

  const indexOf = (d: string): number => {
    const b = bucketStart(d, bucket);
    if (b < buckets[0]) return -1; // 창 이전 → 기준 누계(offset)
    if (b > buckets[n - 1]) return -2; // 창 이후 → 버린다
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (buckets[mid] < b) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const series: SplSeries[] = groups.map((g) => {
    const dailyPlan = new Array<number>(n).fill(0);
    const dailyActualNum = new Array<number>(n).fill(0);
    let planOffset = 0;
    let actualOffset = 0;

    for (const r of rows) {
      for (const s of g.stages) {
        const a = actualDate(r, s);
        let p = planDate(r, s);
        if (planMode === "remaining" && p && p < asOf && !a) p = asOf;
        if (p) {
          const i = indexOf(p);
          if (i === -1) planOffset += 1;
          else if (i >= 0) dailyPlan[i] += 1;
        }
        if (a) {
          const i = indexOf(a);
          if (i === -1) actualOffset += 1;
          else if (i >= 0) dailyActualNum[i] += 1;
        }
      }
    }

    const cumPlan = new Array<number>(n).fill(0);
    const cumActual = new Array<number | null>(n).fill(null);
    const dailyActual = new Array<number | null>(n).fill(null);
    let cp = planOffset;
    let ca = actualOffset;
    for (let i = 0; i < n; i++) {
      cp += dailyPlan[i];
      cumPlan[i] = cp;
      if (todayIndex < 0 || i <= todayIndex) {
        ca += dailyActualNum[i];
        cumActual[i] = ca;
        dailyActual[i] = dailyActualNum[i];
      }
    }

    return { key: g.key, dailyPlan, dailyActual, cumPlan, cumActual, denom: groupDenominator(rows, g.stages) };
  });

  return { buckets, bucketLabels: buckets.map((b) => bucketLabel(b, bucket)), todayIndex, series };
}

/** 22단계용 색 — 계열 수와 무관하게 균등 색상환 */
export function splSeriesColor(i: number, total: number): string {
  const hue = Math.round((360 * i) / Math.max(1, total));
  return `hsl(${hue} 62% 45%)`;
}