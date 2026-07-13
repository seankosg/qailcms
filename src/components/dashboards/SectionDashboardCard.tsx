import { Link } from "@tanstack/react-router";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  title: string;
  description: string;
  icon: LucideIcon;
  to?: string;
  status?: "ready" | "coming-soon";
  cta?: string;
}

export function SectionDashboardCard({ title, description, icon: Icon, to, status = "ready", cta = "열기" }: Props) {
  const comingSoon = status === "coming-soon";
  return (
    <Card className={comingSoon ? "border-dashed" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            {title}
          </span>
          {comingSoon ? <Badge variant="secondary">준비 중</Badge> : <Badge>활성</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{description}</p>
        {!comingSoon && to && (
          <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {cta} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}