import { useParams, useRouter, useSearch } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { AbdDetailBody } from "@/components/abd/raw-data/AbdDetailSheet";

export function AbdDetailPage() {
  const { id } = useParams({ from: "/_authenticated/closure/abd/detail/$id" });
  const search = useSearch({ from: "/_authenticated/closure/abd/detail/$id" }) as { focus?: "rounds" | "aconex" | "comments" };
  const router = useRouter();
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.history.back()}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">ABD Detail</h1>
      </div>
      <AbdDetailBody id={id} focusSection={search?.focus ?? null} />
    </div>
  );
}