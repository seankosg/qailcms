import { createFileRoute } from '@tanstack/react-router';
import { zodValidator, fallback } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { DmrRawDataPage } from '@/components/resource/dmr/DmrRawDataPage';
import { DMR2_COLUMNS } from '@/lib/dmr/columns';

const searchSchema = z.object({
  q: fallback(z.string(), '').default(''),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.number().int(), 100).default(100),
  filters: fallback(z.string(), '').default(''),
  sort: fallback(z.string(), '').default(''),
});

export const Route = createFileRoute('/_authenticated/resource/dmr/raw-data')({
  head: () => ({
    meta: [
      { title: 'DMR Raw Data · QAIL CMS' },
      { name: 'description', content: 'Daily Entry 저장 원본 — TM 코드·담당자·하루치 증분·인원' },
      { property: 'og:title', content: 'DMR Raw Data · QAIL CMS' },
      { property: 'og:description', content: 'DMR Daily Entry 저장 원본 데이터' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  // Raw Data 2 를 Raw Data 로 병합. 열 묶음·조회 범위 모두 옛 Raw Data 2 기준.
  component: () => (
    <DmrRawDataPage
      columnDefs={DMR2_COLUMNS}
      title="DMR Raw Data"
      subtitle="Daily Entry 저장 원본 — TM 코드·담당자·하루치 증분·인원"
      prefKey="dmr-raw-data-2"
      routePath="/resource/dmr/raw-data"
      routeId="/_authenticated/resource/dmr/raw-data"
      showImport={false}
      scope="entry"
      exportFilePrefix="CMS_DMR_RawData"
    />
  ),
});