import { createFileRoute } from '@tanstack/react-router';
import { DmrProductivityPage } from '@/components/resource/dmr/DmrProductivityPage';

export const Route = createFileRoute('/_authenticated/resource/dmr/productivity')({
  head: () => ({
    meta: [
      { title: 'DMR Productivity · QAIL CMS' },
      {
        name: 'description',
        content: '코드별 일일 진도 증분과 투입 인원으로 산출한 생산성 평가 화면',
      },
      { property: 'og:title', content: 'DMR Productivity · QAIL CMS' },
      {
        property: 'og:description',
        content: '코드별 일일 진도 증분과 투입 인원으로 산출한 생산성 평가 화면',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: () => <DmrProductivityPage />,
});
