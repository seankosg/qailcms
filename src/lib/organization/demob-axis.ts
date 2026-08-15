/**
 * Demob Plan 가로 캘린더 축 계산.
 * MilestoneTimelineCard 의 월 눈금 방식과 동일한 규칙(월 시작 tick, `MMM yy` 라벨).
 */
export const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → epoch day 번호. 잘못된 값은 NaN. */
export function dayNum(iso: string | null | undefined): number {
  if (!iso) return NaN;
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? NaN : Math.floor(t / DAY_MS);
}

export interface DemobAxis {
  minDay: number;
  maxDay: number;
  ticks: { day: number; label: string }[];
  pct: (day: number) => number;
}

export function buildDemobAxis(days: number[], todayNum: number): DemobAxis {
  const all = days.filter((d) => Number.isFinite(d));
  all.push(todayNum);
  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const pad = Math.max(Math.round((rawMax - rawMin) * 0.05), 15);
  const minDay = rawMin - pad;
  const maxDay = rawMax + pad;

  const ticks: { day: number; label: string }[] = [];
  const start = new Date((minDay + pad) * DAY_MS);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (let i = 0; i < 240; i++) {
    const day = Math.floor(Date.UTC(y, m, 1) / DAY_MS);
    if (day > maxDay) break;
    if (day >= minDay) {
      ticks.push({
        day,
        label: new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
          timeZone: "UTC",
        }),
      });
    }
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }

  const span = Math.max(maxDay - minDay, 1);
  const pct = (day: number) => ((day - minDay) / span) * 100;
  return { minDay, maxDay, ticks, pct };
}
