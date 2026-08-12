import { createFileRoute } from '@tanstack/react-router';
import { zodValidator, fallback } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { DmrRawData2Page } from '@/components/resource/dmr/DmrRawData2Page';

const searchSchema = z.object({
  q: fallback(z.string(), '').default(''),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.number().int(), 100).default(100),
  filters: fallback(z.string(), '').default(''),
  sort: fallback(z.string(), '').default(''),
});

export const Route = createFileRoute('/_authenticated/resource/dmr/raw-data-2')({
  head: () => ({
    meta: [
      { title: 'DMR Raw Data 2 · QAIL CMS' },
      { name: 'description', content: 'Daily Entry 저장 원본 — TM 코드·담당자·하루치 증분·인원종류별 행' },
      { property: 'og:title', content: 'DMR Raw Data 2 · QAIL CMS' },
      { property: 'og:description', content: 'DMR Daily Entry 저장 원본 데이터' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: () => <DmrRawData2Page />,
});
