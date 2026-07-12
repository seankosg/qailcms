import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

interface Props {
  domain: string;
  description?: string;
}

export function ComingSoonWidget({ domain, description }: Props) {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{domain}</span>
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3 w-3" />
            준비 중
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          {description ?? "이 도메인은 향후 이터레이션에서 추가됩니다."}
        </p>
      </CardContent>
    </Card>
  );
}