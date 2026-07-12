import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_COLORS, TEAM_FALLBACK_COLOR } from "@/lib/defect-management/columns";

export function DefectStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground/50">—</span>;
  const cls = STATUS_COLORS[String(status)] ?? TEAM_FALLBACK_COLOR;
  return <Badge className={cn("text-[10px] font-medium", cls)}>{String(status)}</Badge>;
}