import { createFileRoute } from '@tanstack/react-router';
import { zodValidator, fallback } from '@tanstack/zod-adapter';
import { z } from 'zod';
import { DmrRawDataPage } from '@/components/resource/dmr/DmrRawDataPage';

const searchSchema = z.object({
  q: fallback(z.string(), '').default(''),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.number().int(), 100).default(100),
  filters: fallback(z.string(), '').default(''),
  sort: fallback(z.string(), '').default(''),
});

export const Route = createFileRoute('/_authenticated/resource/dmr/raw-data')({
  head: () => ({ meta: [{ title: 'DMR Raw Data · QAIL CMS' }] }),
  validateSearch: zodValidator(searchSchema),
  component: () => <DmrRawDataPage />,
});