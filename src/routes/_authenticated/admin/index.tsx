import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminOverview,
});

function AdminOverview() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">시스템 관리자 전용 설정.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link to="/admin/mapping" className="block">
          <Card className="transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <Wrench className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Mapping</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Raw Data 컬럼 헤더 라벨과 Excel Import 헤더 별칭을 관리합니다.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
