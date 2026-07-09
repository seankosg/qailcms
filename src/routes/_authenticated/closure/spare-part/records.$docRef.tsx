import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/spare-part/records/$docRef")({
  head: ({ params }) => ({ meta: [{ title: `Spare Part — ${params.docRef}` }] }),
  component: SparePartDetailStub,
});

function SparePartDetailStub() {
  const { docRef } = Route.useParams();
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="text-xs text-muted-foreground">
        <Link to="/closure/spare-part/raw-data" className="hover:underline">
          ← Raw Data
        </Link>
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Spare Part 상세 — 준비 중</h1>
      <div className="rounded-md border bg-card p-4">
        <div className="text-xs text-muted-foreground">Doc Ref</div>
        <div className="mt-1 font-mono text-sm">{docRef}</div>
      </div>
      <p className="text-sm text-muted-foreground">이 페이지는 이후 단계에서 46개 필드 편집 UI로 구현됩니다.</p>
    </div>
  );
}