import { createFileRoute } from '@tanstack/react-router';
import { DmrImportPage } from '@/components/resource/dmr/DmrImportPage';

export const Route = createFileRoute('/_authenticated/resource/dmr/import')({
  head: () => ({ meta: [{ title: 'DMR Import · QAIL CMS' }] }),
  component: () => <DmrImportPage />,
});