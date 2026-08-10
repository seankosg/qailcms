import { useParams, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { SplDetailBody } from "./SplDetailBody";

export function SplDetailPage() {
  const { id } = useParams({ from: "/_authenticated/closure/spare-part/detail/$id" });
  const router = useRouter();
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.history.back()}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> 목록
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">SPL Detail</h1>
      </div>
      <SplDetailBody id={id} />
    </div>
  );
}