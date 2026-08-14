import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { fmtExtra, fmtPct, fmtProd } from '@/lib/dmr/productivity';
import type { DmrDashboardModel, QualityFilter } from '@/lib/dmr/dashboard-model';
import { KpiCard, MiniStat } from './ui';

/** 성과 KPI 4장 — 값은 정본 summarize() 가 낸 것만 쓴다. */
export function DmrOutcomeKpis({ model }: { model: DmrDashboardModel }) {
  const s = model.summary;
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <KpiCard
        label="생산성 (실적% ÷ 인원)"
        value={fmtProd(s.productivity) || '—'}
        sub={`계획 생산성 ${fmtProd(s.planProductivity) || '—'}`}
      />
      <KpiCard
        label="기간 실적%"
        value={fmtPct(s.actualSum) || '—'}
        sub={`기간 계획% ${fmtPct(s.planSum) || '—'}`}
        subColor={s.actualSum < 0 ? 'red' : 'muted'}
      />
      <KpiCard
        label="계획 달성률"
        value={s.achievement == null ? '—' : `${(s.achievement * 100).toFixed(1)}%`}
        sub={s.achievement == null ? '계획 구간 밖' : s.achievement >= 1 ? '증원 불필요' : '계획 미달'}
        subColor={s.achievement == null ? 'muted' : s.achievement >= 1 ? 'emerald' : 'red'}
      />
      <KpiCard
        label="추가 필요 인원 (인·일)"
        value={s.extraManpower > 0 ? fmtExtra(s.extraManpower, '') : '0'}
        sub={s.extraManpower > 0 ? '계획 생산성 회복 가정' : '증원 불필요'}
        subColor={s.extraManpower > 0 ? 'red' : 'emerald'}
      />
    </div>
  );
}

/** 품질 상태 줄 — 숫자를 믿을 수 있는지 먼저 알린다. 합계 = 모집단 검산 포함. */
export function DmrQualityStrip({
  model,
  onQuality,
}: {
  model: DmrDashboardModel;
  onQuality: (q: QualityFilter) => void;
}) {
  const s = model.summary;
  const sum = s.productiveCodes + s.noProgressCodes + s.correctedCodes + s.exceptionalCodes;
  const balanced = sum === s.codes;
  const ratio = s.recordRatioMedian;
  const chip = (
    label: string,
    n: number,
    q: QualityFilter,
    bad = false,
  ) => (
    <button
      type="button"
      onClick={() => onQuality(q)}
      className={cn(
        'rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-accent',
        bad && n > 0 ? 'border-destructive/40 text-destructive' : 'text-muted-foreground',
      )}
    >
      {label} <span className="font-semibold tabular-nums">{n.toLocaleString()}</span>
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">데이터 품질</span>
      {chip('전체 코드', s.codes, 'all')}
      {chip('실적 있음', s.productiveCodes, 'productive')}
      {chip('무실적', s.noProgressCodes, 'noProgress')}
      {chip('진도 정정', s.correctedCodes, 'corrected', true)}
      {chip('인원 없이 실적', s.exceptionalCodes, 'exceptional', true)}
      {chip('Data Date 격차', s.dataDateGapCodes, 'dateGap', true)}
      <span className={cn('text-[11px]', ratio != null && ratio < 0.9 ? 'text-destructive' : 'text-muted-foreground')}>
        기록일 비율(중앙값) {ratio == null ? '—' : ratio.toFixed(2)}
      </span>
      <Badge variant={balanced ? 'outline' : 'destructive'} className="ml-auto text-[10px]">
        {balanced ? `합계 검산 OK (${sum.toLocaleString()} = 모집단)` : `합계 불일치 ${sum} ≠ ${s.codes}`}
      </Badge>
      {model.unlinkedManpowerRows > 0 && (
        <Badge variant="destructive" className="text-[10px]">
          TM Code 없는 인원 행 {model.unlinkedManpowerRows.toLocaleString()}건 · {model.unlinkedManpower.toLocaleString()}명
        </Badge>
      )}
    </div>
  );
}

/** 인원 복합 카드 — 실제/계획/차이/달성률 + 공종별. */
export function DmrManpowerCard({ model }: { model: DmrDashboardModel }) {
  const s = model.summary;
  const byTeam = new Map<string, { plan: number; actual: number }>();
  for (const r of model.dmrRowsInScope) {
    const k = r.discipline || '(미지정)';
    const a = byTeam.get(k) ?? { plan: 0, actual: 0 };
    a.plan += Number(r.plan_manpower ?? 0) || 0;
    a.actual += Number(r.actual_manpower ?? 0) || 0;
    byTeam.set(k, a);
  }
  const teams = Array.from(byTeam.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const diff = s.manpowerVariance;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">인원 (Manpower · 인·일)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="실제" value={s.manpower} />
            <MiniStat label="계획" value={s.planManpower} />
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Δ (실제−계획)</div>
              <div
                className={cn(
                  'text-lg font-bold',
                  diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-destructive' : '',
                )}
              >
                {diff > 0 ? '+' : ''}
                {diff.toLocaleString()}
              </div>
            </div>
            <MiniStat
              label="인원 달성률"
              value={s.manpowerAchievement == null ? '—' : `${(s.manpowerAchievement * 100).toFixed(1)}%`}
            />
          </div>
          <div className="space-y-1">
            {teams.map(([t, v]) => {
              const d = v.actual - v.plan;
              return (
                <div key={t} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                  <span className="font-medium">{t}</span>
                  <span className="tabular-nums text-muted-foreground">
                    실제 {v.actual.toLocaleString()} · 계획 {v.plan.toLocaleString()}
                  </span>
                  <span className={cn('tabular-nums', d > 0 ? 'text-emerald-600' : d < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                    {d > 0 ? '+' : ''}
                    {d.toLocaleString()}
                  </span>
                </div>
              );
            })}
            {teams.length === 0 && (
              <div className="p-3 text-center text-xs text-muted-foreground">인원 기록이 없습니다</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
