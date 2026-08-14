import { createFileRoute } from '@tanstack/react-router';
import { DmrDashboardPage, type DmrDashboardSearch } from '@/components/resource/dmr/DmrDashboardPage';

export const Route = createFileRoute('/_authenticated/resource/dmr/dashboard')({
  validateSearch: (search: Record<string, unknown>): DmrDashboardSearch => ({
    kind: search.kind as DmrDashboardSearch['kind'],
    base: search.base as string | undefined,
    from: search.from as string | undefined,
    to: search.to as string | undefined,
    plots: search.plots as string | undefined,
    teams: search.teams as string | undefined,
    subs: search.subs as string | undefined,
    systems: search.systems as string | undefined,
    wtypes: search.wtypes as string | undefined,
    kinds: search.kinds as string | undefined,
    codes: search.codes as string | undefined,
    ctype: search.ctype as DmrDashboardSearch['ctype'],
    quality: search.quality as DmrDashboardSearch['quality'],
    q: search.q as string | undefined,
    group: search.group as DmrDashboardSearch['group'],
  }),
  head: () => ({
    meta: [
      { title: 'DMR Dashboard · QAIL CMS' },
      { name: 'description', content: '출면 인원과 TM 진도 정본으로 산출한 일일 생산성 대시보드' },
      { property: 'og:title', content: 'DMR Dashboard · QAIL CMS' },
      { property: 'og:description', content: '출면 인원과 TM 진도 정본으로 산출한 일일 생산성 대시보드' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: () => <DmrDashboardPage />,
});
