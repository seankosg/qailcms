import { createFileRoute, Link } from '@tanstack/react-router';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Upload, Database, LayoutDashboard } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/resource/dashboard')({
  head: () => ({ meta: [{ title: 'Resource · QAIL CMS' }] }),
  component: () => (
    <AppLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Resource</h1>
          <p className="text-xs text-muted-foreground">인력 자원 관리</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <ModCard to="/resource/dmr/dashboard" icon={LayoutDashboard} title="DMR Dashboard" desc="일자별·공종별 인원 실적 요약" />
          <ModCard to="/resource/dmr/raw-data" icon={Database} title="DMR Raw Data" desc="롱포맷 원본 데이터" />
          <ModCard to="/resource/dmr/import" icon={Upload} title="DMR Import" desc="이미지 3장 AI 자동 파싱" />
        </div>
      </div>
    </AppLayout>
  ),
});

function ModCard({ to, icon: Icon, title, desc }: { to: string; icon: typeof Users; title: string; desc: string }) {
  return (
    <Link to={to}>
      <Card className="cursor-pointer transition-colors hover:border-primary hover:bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-primary" />{title}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">{desc}</CardContent>
      </Card>
    </Link>
  );
}