import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTmAsOfRows } from '@/hooks/useTmRowsAsOf';
import { todayInDoha, yesterdayInDoha } from '@/lib/time/doha';

interface DmrRow {
  task_no: string | null;
  actual_manpower: number | null;
  headcount_kind: string | null;
  discipline: string | null;
  system_name: string | null;
  plot: string | null;
}

interface OutRow {
  task_no: string;
  task_name: string;
  work_type: string;
  team: string;
  plot: string;
  systems: string;
  inc: number | null;
  manpower: number;
  productivity: number | null;
  note: string;
  kind: '가' | '나' | '다';
}

function useDmrDay(date: string) {
  return useQuery({
    queryKey: ['dmr-productivity-day', date],
    enabled: !!date,
    staleTime: 60_000,
    queryFn: async (): Promise<DmrRow[]> => {
      const out: DmrRow[] = [];
      const PAGE = 1000;
      for (let from = 0; from < 20_000; from += PAGE) {
        const { data, error } = await supabase
          .from('dmr_entries')
          .select('task_no, actual_manpower, headcount_kind, discipline, system_name, plot')
          .eq('report_date', date)
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as DmrRow[];
        out.push(...rows);
        if (rows.length < PAGE) break;
      }
      return out;
    },
  });
}

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

  const tmQ = useTmAsOfRows(date);
  const dmrQ = useDmrDay(date);

  const built = useMemo(() => {
    const tmRows = (tmQ.data ?? []) as Array<Record<string, any>>;
    const dmrRows = dmrQ.data ?? [];

    // 분모: 코드별 전체 인원 — 업체·System·headcount_kind 무관 전량 합산.
    const mp = new Map<string, number>();
    const systems = new Map<string, Set<string>>();
    const dTeams = new Map<string, Set<string>>();
    const dPlots = new Map<string, Set<string>>();
    for (const r of dmrRows) {
      const code = (r.task_no ?? '').trim();
      if (!code) continue;
      mp.set(code, (mp.get(code) ?? 0) + Number(r.actual_manpower ?? 0));
      if (r.system_name) {
        if (!systems.has(code)) systems.set(code, new Set());
        systems.get(code)!.add(r.system_name);
      }
      if (r.discipline) {
        if (!dTeams.has(code)) dTeams.set(code, new Set());
        dTeams.get(code)!.add(r.discipline);
      }
      if (r.plot) {
        if (!dPlots.has(code)) dPlots.set(code, new Set());
        dPlots.get(code)!.add(r.plot);
      }
    }

    // 분자: TM 정본 tc_actual_pct — 코드 단위. 화면 재계산 없음.
    const rows: OutRow[] = [];
    const seen = new Set<string>();
    for (const t of tmRows) {
      const code = String(t.task_no ?? '').trim();
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const inc = isToday
        ? null
        : t.tc_actual_pct == null
          ? null
          : Number(t.tc_actual_pct);
      const manpower = mp.get(code) ?? 0;
      const hasInc = inc != null && inc !== 0;
      if (manpower <= 0 && !hasInc) continue;

      const notes: string[] = [];
      if (isToday) notes.push('실적 미입력');
      const dd = t.data_date ? String(t.data_date).slice(0, 10) : null;
      if (dd && dd !== date) {
        const gap = Math.round(
          (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dd}T00:00:00Z`)) / 86_400_000,
        );
        notes.push(`Data Date 격차 ${gap}일 (${dd})`);
      }
      let kind: OutRow['kind'] = '가';
      if (manpower <= 0) {
        kind = '다';
        notes.push('인원 기록 없이 진도 상승');
      } else if (!hasInc && inc != null) kind = '나';

      rows.push({
        task_no: code,
        task_name: String(t.task_name ?? ''),
        work_type: String(t.row_type ?? ''),
        team: String(t.discipline ?? t.team ?? ''),
        plot: String(t.plot ?? ''),
        systems: Array.from(systems.get(code) ?? []).sort().join(', '),
        inc,
        manpower,
        // 생산성은 언제나 그 코드의 전체 인원으로 계산한다(필터 무관).
        productivity: kind === '다' || inc == null || manpower <= 0 ? null : inc / manpower,
        note: notes.join(' · '),
        kind,
      });
    }
    return { rows, dmrRows };
  }, [tmQ.data, dmrQ.data, date, isToday]);

  const opts = useMemo(() => {
    const plots = new Set<string>();
    const teams = new Set<string>();
    const sys = new Set<string>();
    const wt = new Set<string>();
    for (const r of built.rows) {
      if (r.plot) plots.add(r.plot);
      if (r.team) teams.add(r.team);
      if (r.work_type) wt.add(r.work_type);
      for (const s of r.systems.split(', ')) if (s) sys.add(s);
    }
    for (const d of built.dmrRows) {
      if (d.discipline) teams.add(d.discipline);
      if (d.system_name) sys.add(d.system_name);
      if (d.plot) plots.add(d.plot);
    }
    const s = (x: Set<string>) => Array.from(x).sort((a, b) => a.localeCompare(b, 'ko'));
    return { plots: s(plots), teams: s(teams), sys: s(sys), wt: s(wt) };
  }, [built]);

  // 필터는 "어떤 코드를 보여 줄지"만 정한다 — 분모(인원)는 절대 좁히지 않는다.
  const dmrIdx = useMemo(() => {
    const teams = new Map<string, Set<string>>();
    const sys = new Map<string, Set<string>>();
    const plots = new Map<string, Set<string>>();
    for (const r of built.dmrRows) {
      const c = (r.task_no ?? '').trim();
      if (!c) continue;
      if (r.discipline) (teams.get(c) ?? teams.set(c, new Set()).get(c)!).add(r.discipline);
      if (r.system_name) (sys.get(c) ?? sys.set(c, new Set()).get(c)!).add(r.system_name);
      if (r.plot) (plots.get(c) ?? plots.set(c, new Set()).get(c)!).add(r.plot);
    }
    return { teams, sys, plots };
  }, [built.dmrRows]);

  const filtered = useMemo(
    () =>
      built.rows.filter((r) => {
        if (fPlot !== ALL && r.plot !== fPlot && !dmrIdx.plots.get(r.task_no)?.has(fPlot))
          return false;
        if (fTeam !== ALL && r.team !== fTeam && !dmrIdx.teams.get(r.task_no)?.has(fTeam))
          return false;
        if (fSystem !== ALL && !dmrIdx.sys.get(r.task_no)?.has(fSystem)) return false;
        if (fWorkType !== ALL && r.work_type !== fWorkType) return false;
        return true;
      }),
    [built.rows, dmrIdx, fPlot, fTeam, fSystem, fWorkType],
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

  // 합계는 증분 합 ÷ 인원 합 — 행별 생산성의 평균이 아니다.
  const totals = useMemo(() => {
    let inc = 0;
    let mpSum = 0;
    for (const r of sorted) {
      if (r.inc != null) inc += r.inc;
      mpSum += r.manpower;
    }
    return { inc, mpSum, productivity: mpSum > 0 ? inc / mpSum : null };
  }, [sorted]);

  const missingCount = built.rows.filter((r) => r.kind === '다').length;
  const loading = tmQ.isLoading || dmrQ.isLoading;

  return (
    <AppLayout>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Productivity</h1>
            <p className="text-xs text-muted-foreground">
              생산성(D) = TC.Actual%(D) ÷ 그 코드에 D 일 붙은 인원 (전체 인원 기준)
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
            오늘은 TM 실적이 아직 들어오지 않는다 — 증분 칸은 빈칸(실적 미입력)으로 둔다. 기본
            기준일은 어제다.
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
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-muted/60">
                    <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                      <th>TM Code</th>
                      <th>Task</th>
                      <th>Work Type</th>
                      <th>공종</th>
                      <th>Plot</th>
                      <th>System</th>
                      <th className="!text-right">TC.Actual%</th>
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
                        <td className="max-w-[220px] truncate" title={r.systems}>
                          {r.systems}
                        </td>
                        <td className="text-right tabular-nums">{fmtPct(r.inc)}</td>
                        <td className="text-right tabular-nums">{r.manpower.toLocaleString()}</td>
                        <td className="text-right tabular-nums">
                          {r.productivity == null ? (
                            <Badge variant="outline" className="text-[10px]">
                              {r.kind === '다' ? '산출 불가' : '실적 미입력'}
                            </Badge>
                          ) : (
                            `${(r.productivity * 100).toFixed(3)}%/인`
                          )}
                        </td>
                        <td className="text-muted-foreground">{r.note}</td>
                      </tr>
                    ))}
                    {sorted.length === 0 && (
                      <tr>
                        <td colSpan={10} className="p-6 text-center text-muted-foreground">
                          표시할 코드가 없다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-muted/40 font-medium [&>td]:px-2 [&>td]:py-2">
                      <td colSpan={6}>합계 (증분 합 ÷ 인원 합)</td>
                      <td className="text-right tabular-nums">{fmtPct(totals.inc)}</td>
                      <td className="text-right tabular-nums">{totals.mpSum.toLocaleString()}</td>
                      <td className="text-right tabular-nums">
                        {totals.productivity == null
                          ? ''
                          : `${(totals.productivity * 100).toFixed(3)}%/인`}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
