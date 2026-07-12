import { Link } from "@tanstack/react-router";
import { ArrowRight, ClipboardList, Package, ShieldCheck, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComingSoonWidget } from "./ComingSoonWidget";

interface DomainCard {
  id: string;
  title: string;
  description: string;
  to?: string;
  icon: typeof ClipboardList;
  status: "ready" | "coming-soon";
}

const DOMAINS: DomainCard[] = [
  {
    id: "task",
    title: "Task Management",
    description: "공정·진도 계획 대비 실적 매트릭스와 리스크 감시.",
    to: "/closure/dashboard/task",
    icon: ClipboardList,
    status: "ready",
  },
  {
    id: "spare-part",
    title: "Spare Part",
    description: "예비품 문서 관리 대시보드는 준비 중입니다.",
    to: "/closure/dashboard/spare-part",
    icon: Package,
    status: "coming-soon",
  },
  {
    id: "warranty",
    title: "Warranty",
    description: "품질 보증 관리 대시보드는 준비 중입니다.",
    to: "/closure/dashboard/warranty",
    icon: ShieldCheck,
    status: "coming-soon",
  },
  {
    id: "as-built",
    title: "As-Built Drawing",
    description: "준공 도서 관리 대시보드는 준비 중입니다.",
    to: "/closure/dashboard/as-built",
    icon: FileText,
    status: "coming-soon",
  },
];

export function DashboardHubPage() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Closure Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          도메인별 대시보드를 선택하거나 아래 요약 위젯을 확인하세요.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DOMAINS.map((d) => (
          <Card key={d.id} className={d.status === "coming-soon" ? "border-dashed" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <d.icon className="h-4 w-4 text-primary" />
                  {d.title}
                </span>
                {d.status === "coming-soon" ? (
                  <Badge variant="secondary">준비 중</Badge>
                ) : (
                  <Badge>활성</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">{d.description}</p>
              {d.status === "ready" && d.to && (
                <Link
                  to={d.to}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  대시보드 열기 <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ComingSoonWidget
          domain="Task 요약 (Compact)"
          description="Overview 축약 위젯은 각 도메인 페이지 완성 이후 등록됩니다. 지금은 상단 카드에서 Task Dashboard 로 이동하세요."
        />
        <ComingSoonWidget
          domain="통합 필터 (다음)"
          description="여러 도메인에 걸친 공통 필터(기간·팀 등)를 여기서 조정하도록 확장 예정입니다."
        />
      </div>
    </div>
  );
}