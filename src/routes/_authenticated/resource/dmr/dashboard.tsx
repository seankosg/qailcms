import { createFileRoute } from '@tanstack/react-router';
import { DmrDashboardPage } from '@/components/resource/dmr/DmrDashboardPage';

export const Route = createFileRoute('/_authenticated/resource/dmr/dashboard')({
  head: () => ({ meta: [{ title: 'DMR Dashboard · QAIL CMS' }] }),
  component: () => <DmrDashboardPage />,
});