import { createFileRoute, redirect } from '@tanstack/react-router';

/** Raw Data 2 는 Raw Data 로 병합되었다. 옛 주소는 새 주소로 넘긴다. */
export const Route = createFileRoute('/_authenticated/resource/dmr/raw-data-2')({
  beforeLoad: () => {
    throw redirect({ to: '/resource/dmr/raw-data' });
  },
});
