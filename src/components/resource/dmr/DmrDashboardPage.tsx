/**
 * DMR Dashboard — 일일 생산성 화면.
 *
 * 원천은 dmr_entries(인원)와 TM 정본 RPC(진도) 둘뿐이다.
 * 모든 계산은 src/lib/dmr/productivity.ts(정본) + src/lib/dmr/dashboard-model.ts(조립)에서 끝난다.
 * 이 파일은 값을 만들지 않는다 — 받아서 그리기만 한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { yesterdayInDoha } from '@/lib/time/doha';
import type { PeriodKind, ProductivityRow } from '@/lib/dmr/productivity';
import { PERIOD_LABEL } from '@/lib/dmr/productivity';
import {
  EMPTY_FILTERS,
  type DmrDashFilters,
  type QualityFilter,
  type TrendGroupBy,
} from '@/lib/dmr/dashboard-model';
import {
  useDmrDashboardModel,
  useDmrDirectNames,
  useDmrLatestDate,
} from '@/hooks/useDmrDashboardModel';
import { DmrDashboardFilters } from './dashboard/DmrDashboardFilters';
import { DmrManpowerCard, DmrOutcomeKpis, DmrQualityStrip } from './dashboard/DmrKpiSection';
import { DmrTrendCard } from './dashboard/DmrTrendCard';
import { DmrDetailTables } from './dashboard/DmrDetailTables';
import { DmrManpowerDetails } from './dashboard/DmrManpowerDetails';
import { DmrTmCodeDetail } from './dashboard/DmrTmCodeDetail';

export interface DmrDashboardSearch {
  kind?: PeriodKind;
  base?: string;
  from?: string;
  to?: string;
  plots?: string;
  teams?: string;
  subs?: string;
  systems?: string;
  wtypes?: string;
  kinds?: string;
  codes?: string;
  ctype?: 'all' | 'direct' | 'sub';
  quality?: QualityFilter;
  q?: string;
  group?: TrendGroupBy;
}

const split = (v?: string) => (v ? v.split(',').filter(Boolean) : []);
const join = (v: string[]) => (v.length ? v.join(',') : undefined);

export function DmrDashboardPage() {
  const search = useSearch({ strict: false }) as DmrDashboardSearch;
  const navigate = useNavigate();
  const latestQ = useDmrLatestDate();
  const directNames = useDmrDirectNames();
  const [detail, setDetail] = useState<ProductivityRow | null>(null);

  const baseDate = search.base || latestQ.data || yesterdayInDoha();
  const kind: PeriodKind = search.kind ?? 'day';
  const groupBy: TrendGroupBy = search.group ?? 'team';

  const filters: DmrDashFilters = useMemo(
    () => ({
      plots: split(search.plots),
      teams: split(search.teams),
      contractors: split(search.subs),
      systems: split(search.systems),
      workTypes: split(search.wtypes),
      headcountKinds: split(search.kinds),
      codes: split(search.codes),
      contractorType: search.ctype ?? 'all',
      quality: search.quality ?? 'all',
      search: search.q ?? '',
    }),
    [search],
  );

  const patch = (next: Partial<DmrDashboardSearch>) =>
    navigate({ to: '.', search: (prev: any) => ({ ...prev, ...next }), replace: true });

  const setFilters = (f: DmrDashFilters) =>
    patch({
      plots: join(f.plots),
      teams: join(f.teams),
      subs: join(f.contractors),
      systems: join(f.systems),
      wtypes: join(f.workTypes),
      kinds: join(f.headcountKinds),
      codes: join(f.codes),
      ctype: f.contractorType === 'all' ? undefined : f.contractorType,
      quality: f.quality === 'all' ? undefined : f.quality,
      q: f.search.trim() || undefined,
    });

  const result = useDmrDashboardModel({
    kind,
    baseDate,
    from: search.from ?? '',
    to: search.to ?? '',
    filters,
    groupBy,
    dailyEnabled,
  });
  const { model } = result;

  // 차트가 화면에 가까워지거나 상세창을 열 때만 날짜별 배치 RPC 를 부른다.
  const trendRef = useRef<HTMLDivElement | null>(null);
  const [dailyEnabled, setDailyEnabled] = useState(false);
  useEffect(() => {
    if (dailyEnabled) return;
    const el = trendRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setDailyEnabled(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setDailyEnabled(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [dailyEnabled, model]);
  useEffect(() => {
    if (detail) setDailyEnabled(true);
  }, [detail]);

  const isFuture = baseDate >= new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-40 -mx-4 space-y-3 border-b bg-background px-4 pb-3 pt-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">DMR Dashboard</h1>
            <p className="text-xs text-muted-foreground">
              생산성 = 기간 실적%(진도) ÷ 투입 인원(인·일) — 인원은 dmr_entries, 진도는 TM 정본
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {model && (
              <Badge variant="outline" className="text-[10px]">
                {model.period.start} ~ {model.period.end} · {PERIOD_LABEL[kind]}
              </Badge>
            )}
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setFilters(EMPTY_FILTERS)}>
              <RefreshCw className="mr-1 h-3 w-3" />
              필터 초기화
            </Button>
            <Link
              to="/resource/dmr/raw-data-2"
              className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
            >
              Raw Data 열기 →
            </Link>
          </div>
        </div>

        <DmrDashboardFilters
          kind={kind}
          onKind={(k) => patch({ kind: k })}
          baseDate={baseDate}
          onBaseDate={(v) => patch({ base: v || undefined })}
          from={search.from ?? ''}
          to={search.to ?? ''}
          onFrom={(v) => patch({ from: v || undefined })}
          onTo={(v) => patch({ to: v || undefined })}
          periodLabel={model ? `${model.period.start} ~ ${model.period.end}` : '—'}
          filters={filters}
          onFilters={setFilters}
          options={model?.options ?? { plots: [], teams: [], contractors: [], systems: [], workTypes: [], headcountKinds: [], codes: [] }}
        />
      </div>

      {result.error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          {result.error}
        </div>
      )}

      {isFuture && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          오늘 기준일에는 TM 실적이 아직 들어오지 않을 수 있습니다 — 실적 칸이 비어 보일 수 있습니다.
        </div>
      )}

      {result.loading || !model ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          <DmrOutcomeKpis model={model} />
          <DmrQualityStrip model={model} onQuality={(q) => patch({ quality: q === 'all' ? undefined : q })} />
          <DmrManpowerCard model={model} />
          <div ref={trendRef}>
            <DmrTrendCard
              points={result.dailyPoints}
              dates={result.dailyDates}
              groupBy={groupBy}
              onGroupBy={(g) => patch({ group: g })}
              loading={result.dailyLoading}
              disabledReason={result.dailyDisabledReason}
            />
          </div>
          <DmrDetailTables model={model} onSelectCode={setDetail} />
          <DmrManpowerDetails dmrRows={model.dmrRowsInScope} directNames={directNames} />
        </>
      )}

      <DmrTmCodeDetail
        row={detail}
        open={!!detail}
        onOpenChange={(v) => !v && setDetail(null)}
        dates={result.dailyDates}
        byDate={result.dailyCanon}
        dmrRows={result.dmrRowsAll}
        disabledReason={result.dailyDisabledReason}
      />
    </div>
  );
}
