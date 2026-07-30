// As-of(판정 기준일) 표기 유틸.
// - As-of 는 "판정 시점"이며, row.data_date(실적 관측 컷오프)와 별개 개념이다.
// - 미래 As-of(전망) 허용. staleness 계산은 항상 오늘 기준(전망일 기준 부풀림 방지).
import { todayInDoha } from "@/lib/time/doha";

/** 행별 데이터 시점 표기 임계값(일). 초과 시에만 중립 표기. */
export const STALENESS_THRESHOLD_DAYS = 2;

const MS_DAY = 86_400_000;

function toUtc(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** a - b (일수). 하나라도 파싱 불가면 null. */
export function dayDiff(a: string | null | undefined, b: string | null | undefined): number | null {
  const da = toUtc(a);
  const db = toUtc(b);
  if (!da || !db) return null;
  return Math.round((da.getTime() - db.getTime()) / MS_DAY);
}

/** "(+7일)" / "(−9일)" — As-of 가 오늘과 다를 때만. 같으면 "". */
export function asOfOffsetLabel(asOf: string, today = todayInDoha()): string {
  const n = dayDiff(asOf, today);
  if (n === null || n === 0) return "";
  return n > 0 ? `(+${n}일)` : `(−${Math.abs(n)}일)`;
}

/** 헤더 전망 표기: "As of 2026-08-06 (+7일)" */
export function asOfHeaderLabel(asOf: string, today = todayInDoha()): string {
  const off = asOfOffsetLabel(asOf, today);
  return `As of ${asOf.slice(0, 10)}${off ? ` ${off}` : ""}`;
}

/** 행별 데이터 시점 중립 표기. 임계값 이하이면 null(표기 없음).
 *  기준일은 항상 오늘 — 미래 As-of 에서도 부풀리지 않는다. */
export function stalenessLabel(
  rowDataDate: string | null | undefined,
  thresholdDays: number = STALENESS_THRESHOLD_DAYS,
  today = todayInDoha(),
): string | null {
  const n = dayDiff(today, rowDataDate);
  if (n === null || n <= thresholdDays) return null;
  return `Data: ${String(rowDataDate).slice(5, 10)} (${n}일 전)`;
}
