import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import type { StepStatus } from "./OcsWizardStepper";

const BADGE: Record<StepStatus, { label: string; className: string }> = {
  pending: { label: "대기", className: "text-muted-foreground" },
  current: { label: "진행 중", className: "border-primary text-primary" },
  done: { label: "완료", className: "border-emerald-600 text-emerald-700" },
  warning: { label: "경고", className: "border-amber-500 text-amber-600" },
  blocked: { label: "차단", className: "border-destructive text-destructive" },
};

export function OcsWizardStepCard({
  index,
  title,
  description,
  status,
  open,
  onToggle,
  locked,
  lockReasons,
  summary,
  children,
}: {
  index: number;
  title: string;
  description?: string;
  status: StepStatus;
  open: boolean;
  onToggle: () => void;
  locked?: boolean;
  lockReasons?: string[];
  summary?: ReactNode;
  children: ReactNode;
}) {
  const badge = BADGE[status];
  return (
    <Card className={status === "current" ? "border-primary/50" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="text-muted-foreground">{index}.</span>
              <span className="truncate">{title}</span>
              {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            </CardTitle>
            {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
            {!open && summary && <div className="mt-2 text-xs">{summary}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className={`text-[11px] ${badge.className}`}>
              {badge.label}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={open ? "단계 접기" : "단계 펼치기"}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {locked && (lockReasons?.length ?? 0) > 0 && (
            <ul className="space-y-1 rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
              {lockReasons!.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          )}
          {children}
        </CardContent>
      )}
    </Card>
  );
}