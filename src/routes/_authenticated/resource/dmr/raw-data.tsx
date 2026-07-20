import { createFileRoute } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { DmrRawDataPage } from '@/components/resource/dmr/DmrRawDataPage';

export const Route = createFileRoute('/_authenticated/resource/dmr/raw-data')({
  head: () => ({ meta: [{ title: 'DMR Raw Data · QAIL CMS' }] }),
  component: () => (
    <AppLayout>
      <DmrRawDataPage />
    </AppLayout>
  ),
});