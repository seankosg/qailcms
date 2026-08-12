import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from '@tanstack/react-router';

/**
 * 생산성 분석 — Daily Entry Record 와 완전히 분리된 컴포넌트.
 * UI 상세는 별도 지침을 받아 채운다. 지금은 자리와 진입 경로만 둔다.
 */
export function DmrEntryProductivityCard({ reportDate }: { reportDate: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">생산성 분석</CardTitle>
        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
          <Link to="/resource/dmr/productivity">생산성 화면 열기</Link>
        </Button>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        기준일 {reportDate} — 이 영역의 UI 는 별도 지침에 따라 구성합니다.
      </CardContent>
    </Card>
  );
}
