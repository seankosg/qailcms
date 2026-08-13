import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';
import { todayInDoha, yesterdayInDoha } from '@/lib/time/doha';
import {
  fmtProd,
  resolvePeriod,
  summarize,
  useProductivity,
  type DmrManpowerRow,
  type ProductivityRow,
} from '@/lib/dmr/productivity';

const ALL = '__all__';

function Sel({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border bg-background px-2 text-xs"
      >
        <option value={ALL}>전체</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

const fmtPct = (v: number | null) =>
  v == null ? '' : `${(v * 100).toFixed(2)}%`;

export function DmrProductivityPage() {
  const today = todayInDoha();
  const [date, setDate] = useState<string>(yesterdayInDoha());
  const isToday = date === today;

  const [fPlot, setFPlot] = useState(ALL);
  const [fTeam, setFTeam] = useState(ALL);
  const [fSystem, setFSystem] = useState(ALL);
  const [fWorkType, setFWorkType] = useState(ALL);

  // 계산은 src/lib/dmr/productivity.ts 한 벌만 쓴다 — 화면에서 다시 계산하지 않는다.
  const period = useMemo(() => resolvePeriod('day', date), [date]);
  const prodQ = useProductivity(period);
  const rowsAll: ProductivityRow[] = prodQ.data?.rows ?? [];
  const dmrRows: DmrManpowerRow[] = prodQ.data?.dmrRows ?? [];

  const opts = useMemo(() => {
    const plots = new Set<string>();
    const teams = new Set<string>();
    const sys = new Set<string>();
    const wt = new Set<string>();
    for (const r of rowsAll) {
      if (r.plot) plots.add(r.plot);
      if (r.team) teams.add(r.team);
      if (r.work_type) wt.add(r.work_type);
      for (const x of r.systems) sys.add(x);
    }
    for (const d of dmrRows) {
      if (d.discipline) teams.add(d.discipline);
      if (d.system_name) sys.add(d.system_name);
      if (d.plot) plots.add(d.plot);
    }
    const s = (x: Set<string>) => Array.from(x).sort((a, b) => a.localeCompare(b, 'ko'));
    return { plots: s(plots), teams: s(teams), sys: s(sys), wt: s(wt) };
  }, [rowsAll, dmrRows]);

  // 필터는 "어떤 코드를 보여 줄지"만 정한다 — 분모(인원)는 절대 좁히지 않는다.
  const dmrIdx = useMemo(() => {
    const teams = new Map<string, Set<string>>();
    const sys = new Map<string, Set<string>>();
    const plots = new Map<string, Set<string>>();
    const add = (m: Map<string, Set<string>>, c: string, v: string) => {
      if (!m.has(c)) m.set(c, new Set());
      m.get(c)!.add(v);
    };
    for (const r of dmrRows) {
      const c = (r.task_no ?? '').trim();
      if (!c) continue;
      if (r.discipline) add(teams, c, r.discipline);
      if (r.system_name) add(sys, c, r.system_name);
      if (r.plot) add(plots, c, r.plot);
    }
    return { teams, sys, plots };
  }, [dmrRows]);

  const filtered = useMemo(
    () =>
      rowsAll.filter((r) => {
        if (fPlot !== ALL && r.plot !== fPlot && !dmrIdx.plots.get(r.task_no)?.has(fPlot))
          return false;
        if (fTeam !== ALL && r.team !== fTeam && !dmrIdx.teams.get(r.task_no)?.has(fTeam))
          return false;
        if (fSystem !== ALL && !dmrIdx.sys.get(r.task_no)?.has(fSystem)) return false;
        if (fWorkType !== ALL && r.work_type !== fWorkType) return false;
        return true;
      }),
    [rowsAll, dmrIdx, fPlot, fTeam, fSystem, fWorkType],
  );

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const av = a.productivity;
        const bv = b.productivity;
        if (av == null && bv == null) return a.task_no.localeCompare(b.task_no);
        if (av == null) return 1; // 빈칸은 맨 아래
        if (bv == null) return -1;
        return bv - av;
      }),
    [filtered],
  );

  // 합계는 합 ÷ 합 — 행별 생산성의 평균이 아니다.
  const totals = useMemo(() => summarize(sorted, period), [sorted, period]);

  const missingCount = rowsAll.filter((r) => r.kind === '다').length;
  const loading = prodQ.isLoading || prodQ.isFetching;
  const fmtPctCell = (v: number | null) => (v == null ? '' : `${(v * 100).toFixed(2)}%`);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Productivity</h1>
            <p className="text-xs text-muted-foreground">
              생산성(D) = 당일실적%(D) ÷ 그 코드에 D 일 붙은 인원 (전체 인원 기준)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="font-medium uppercase tracking-wide">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs tabular-nums"
              />
            </label>
            <Sel label="Plot" value={fPlot} onChange={setFPlot} options={opts.plots} />
            <Sel label="공종" value={fTeam} onChange={setFTeam} options={opts.teams} />
            <Sel label="System" value={fSystem} onChange={setFSystem} options={opts.sys} />
            <Sel
              label="Work Type"
              value={fWorkType}
              onChange={setFWorkType}
              options={opts.wt}
            />
          </div>
        </div>

        {isToday && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            오늘은 TM 실적이 아직 들어오지 않는다 — 당일실적 칸이 비어 보일 수 있다. 기본 기준일은
            어제다.
          </div>
        )}

        {missingCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            인원 기록 없이 진도 상승 {missingCount}건 — 그날 숫자를 신뢰할 수 없다.
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {date} · {sorted.length.toLocaleString()} codes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <Skeleton className="m-4 h-64" />
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[840px] text-xs">
                  <thead className="sticky top-0 z-10 bg-muted/60">
                    <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                      <th>TM Code</th>
                      <th>Task</th>
                      <th>Work Type</th>
                      <th>공종</th>
                      <th>Plot</th>
                      <th>System</th>
                      <th className="!text-right">당일계획%</th>
                      <th className="!text-right">당일실적%</th>
                      <th className="!text-right">인원</th>
                      <th className="!text-right">생산성</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr
                        key={r.task_no}
                        className={`border-t [&>td]:px-2 [&>td]:py-1.5 ${
                          r.kind === '다' ? 'bg-destructive/5' : ''
                        }`}
                      >
                        <td className="font-mono">{r.task_no}</td>
                        <td className="max-w-[280px] truncate" title={r.task_name}>
                          {r.task_name}
                        </td>
                        <td>{r.work_type}</td>
                        <td>{r.team}</td>
                        <td>{r.plot}</td>
                        <td className="max-w-[220px] truncate" title={r.systems.join(', ')}>
                          {r.systems.join(', ')}
                        </td>
                        <td className="text-right tabular-nums">{fmtPctCell(r.plan_pct)}</td>
                        <td className="text-right tabular-nums">{fmtPctCell(r.actual_pct)}</td>
                        <td className="text-right tabular-nums">{r.manpower.toLocaleString()}</td>
                        <td className="text-right tabular-nums">
                          {r.productivity == null ? (
                            <Badge variant="outline" className="text-[10px]">
                              {r.kind === '다' ? '산출 불가' : '실적 미입력'}
                            </Badge>
                          ) : (
                            fmtProd(r.productivity)
                          )}
                        </td>
                        <td className="text-muted-foreground">{r.note}</td>
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={11} className="p-6 text-center text-muted-foreground">
                          표시할 코드가 없다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-muted/40 font-medium [&>td]:px-2 [&>td]:py-2">
                      <td colSpan={6}>합계 (당일실적 합 ÷ 인원 합)</td>
                      <td className="text-right tabular-nums">{fmtPctCell(totals.planSum)}</td>
                      <td className="text-right tabular-nums">{fmtPctCell(totals.actualSum)}</td>
                      <td className="text-right tabular-nums">{totals.manpower.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{fmtProd(totals.productivity)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
