import { AlertTriangle, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * 오류 표시 5요소 — What happened / What was affected / What to do next / Run·Snapshot ID /
 * Technical details. PostgreSQL 전문은 접기 영역 안에서만 노출한다.
 */
export function OcsErrorCard({
  title,
  affected,
  nextStep,
  runId,
  runLabel = "run",
  snapshotId,
  details,
  action,
}: {
  title: string;
  affected: string;
  nextStep: string;
  runId?: string | null;
  runLabel?: string;
  snapshotId?: string | null;
  details?: string | null;
  action?: React.ReactNode;
}) {
  const ids = [
    runId ? `${runLabel} ${runId}` : null,
    snapshotId ? `snapshot ${snapshotId}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-2 rounded-md border border-destructive/50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" /> {title}
      </div>
      <div className="text-xs text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">What was affected:</span> {affected}
        </div>
        <div>
          <span className="font-medium text-foreground">What to do next:</span> {nextStep}
        </div>
      </div>
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
          {ids.join(" · ")}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => {
              void navigator.clipboard.writeText(ids.join(" "));
              toast.success("ID copied");
            }}
          >
            <Copy className="mr-1 h-3 w-3" /> Copy
          </Button>
        </div>
      )}
      {details && (
        <details className="rounded-md border bg-muted/40 p-2">
          <summary className="cursor-pointer text-[11px] font-medium">Technical details</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-destructive">
            {details}
          </pre>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-6 px-2 text-[11px]"
            onClick={() => {
              void navigator.clipboard.writeText(details);
              toast.success("Technical details copied");
            }}
          >
            <Copy className="mr-1 h-3 w-3" /> Copy details
          </Button>
        </details>
      )}
      {action}
    </div>
  );
}