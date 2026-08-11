import { createFileRoute } from '@tanstack/react-router';
import { DmrEntryPage } from '@/components/resource/dmr/DmrEntryPage';

export const Route = createFileRoute('/_authenticated/resource/dmr/entry')({
  head: () => ({
    meta: [
      { title: 'DMR Daily Entry · QAIL CMS' },
      { name: 'description', content: '출면기록부 일일 인원 입력 — TM 과업 연결과 Data Date 격차 표시' },
      { property: 'og:title', content: 'DMR Daily Entry · QAIL CMS' },
      { property: 'og:description', content: '출면기록부 일일 인원 입력 화면' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: () => <DmrEntryPage />,
});
