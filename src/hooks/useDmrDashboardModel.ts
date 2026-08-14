import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  DAILY_SERIES_MAX_DAYS,
  buildDailyPoints,
  periodDates,
  resolvePeriod,
  useDailyCanon,
  useProductivity,
  useTmHistoryStart,
  type DmrDailyProductivityPoint,
  type PeriodKind,
} from '@/lib/dmr/productivity';
import {
  buildDashboardModel,
  type DmrDashFilters,
  type DmrDashboardModel,
  type TrendGroupBy,
} from '@/lib/dmr/dashboard-model';

export function useDmrDirectNames() {
  const q = useQuery({
    queryKey: ['dmr_contractor_master_lite'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dmr_contractor_master')
        .select('name, is_direct');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const set = useMemo(
    () => new Set((q.data ?? []).filter((c: any) => c.is_direct).map((c: any) => c.name as string)),
    [q.data],
  );
  return set;
}

export function useDmrLatestDate() {
  return useQuery({
    queryKey: ['dmr_latest_date'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dmr_entries')
        .select('report_date')
        .order('report_date', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0]?.report_date as string | undefined) ?? null;
    },
  });
}

export interface DmrDashboardState {
  kind: PeriodKind;
  baseDate: string;
  from: string;
  to: string;
  filters: DmrDashFilters;
  groupBy: TrendGroupBy;
}

export interface DmrDashboardResult {
  model: DmrDashboardModel | null;
  dailyPoints: DmrDailyProductivityPoint[];
  dailyDates: string[];
  dailyDisabledReason: string | null;
  loading: boolean;
  dailyLoading: boolean;
  error: string | null;
}

/** 화면 한 곳에서만 정본을 부른다 — 카드·차트·상세창은 이 결과를 나눠 쓴다. */
export function useDmrDashboardModel(state: DmrDashboardState): DmrDashboardResult {
  const historyQ = useTmHistoryStart();
  const directNames = useDmrDirectNames();

  const ready = /^\d{4}-\d{2}-\d{2}$/.test(state.baseDate);
  const period = useMemo(
    () =>
      resolvePeriod(state.kind, state.baseDate || '2000-01-01', {
        from: state.from,
        to: state.to,
        historyStart: historyQ.data ?? null,
      }),
    [state.kind, state.baseDate, state.from, state.to, historyQ.data],
  );

  const prodQ = useProductivity(period, ready);
  const dates = useMemo(() => periodDates(period), [period]);
  const tooLong = dates.length > DAILY_SERIES_MAX_DAYS;
  const dailyQ = useDailyCanon(period, ready && !tooLong);

  const model = useMemo(() => {
    if (!prodQ.data) return null;
    return buildDashboardModel({
      period,
      rows: prodQ.data.rows,
      dmrRows: prodQ.data.dmrRows,
      filters: state.filters,
      directNames,
      groupBy: state.groupBy,
    });
  }, [prodQ.data, period, state.filters, state.groupBy, directNames]);

  const dailyPoints = useMemo(() => {
    if (!model || !dailyQ.data) return [];
    return buildDailyPoints({
      dates,
      byDate: dailyQ.data,
      dmrRows: prodQ.data?.dmrRows ?? [],
      codeGroups: model.codeGroups,
    });
  }, [model, dailyQ.data, dates, prodQ.data]);

  return {
    model,
    dailyPoints,
    dailyDates: dates,
    dailyDisabledReason: tooLong
      ? `기간이 ${dates.length}일 — 날짜별 추이는 ${DAILY_SERIES_MAX_DAYS}일까지만 그립니다`
      : null,
    loading: prodQ.isLoading || prodQ.isFetching,
    dailyLoading: dailyQ.isLoading || dailyQ.isFetching,
    error: (prodQ.error as Error | null)?.message ?? (dailyQ.error as Error | null)?.message ?? null,
  };
}
