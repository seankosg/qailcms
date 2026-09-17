/**
 * TOC Progress Status(S-Curve) 시리즈 빌더.
 * 계산 규칙은 SPL(`src/lib/spl/scurve.ts`) 정본을 그대로 사용한다 — 단계 셀 구조(ps/pf/as/af/na)가 동일하므로
 * 알고리즘을 복제하지 않고 한 곳에서만 유지한다. 입력은 정본 `toc_rows_as_of` 결과뿐이다.
 */
import { buildSplSCurve, splSeriesColor, type SplBucket, type SplPlanMode, type SplSeriesGroup } from "@/lib/spl/scurve";
import type { SplRow } from "@/lib/spl/rows.functions";
import type { TocRow } from "@/lib/toc/rows.functions";

export type TocBucket = SplBucket;
export type TocPlanMode = SplPlanMode;
export type TocSeriesGroup = SplSeriesGroup;

export const tocSeriesColor = splSeriesColor;

export function buildTocSCurve(opts: {
  rows: TocRow[];
  groups: TocSeriesGroup[];
  bucket: TocBucket;
  planMode: TocPlanMode;
  asOf: string;
  rangeDays: number;
}) {
  return buildSplSCurve({ ...opts, rows: opts.rows as unknown as SplRow[] });
}

/** SPL Plan vs Actual 카드에 넘기기 위한 캐스팅 (구조 동일: stages[code].ps/pf/as/af/na) */
export const asSplRows = (rows: TocRow[]) => rows as unknown as SplRow[];
