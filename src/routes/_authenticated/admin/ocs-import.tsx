import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ShieldCheck } from "lucide-react";
import { getOcsImportStats } from "@/lib/abd/ocs-import.functions";
import { ocsVerify } from "@/lib/abd/ocs-stage-b.functions";
import { ocsV3Verify } from "@/lib/abd/ocs-v3-import.functions";
import { OcsRecountPanel } from "@/components/abd/ocs/OcsRecountPanel";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export const Route = createFileRoute("/_authenticated/admin/ocs-import")({
  head: () => ({
    meta: [
      { title: "OCS Maintenance — QAIL CMS" },
      {
        name: "description",
        content: "ABD OCS 정본 현황 조회, 캐시 재계산, 무결성 검증 전용 관리자 유지보수 화면.",
      },
      { property: "og:title", content: "OCS Maintenance — QAIL CMS" },
      {
        property: "og:description",
        content: "ABD OCS 정본 현황·캐시 재계산·무결성 검증 관리자 화면.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OcsMaintenancePage,
});

function OcsMaintenancePage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const isStrictAdmin = me?.isStrictAdmin === true;

  if (meLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 권한 확인 중…
      </div>
    );
  }
  if (!isStrictAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">접근 권한 없음</CardTitle>
            <CardDescription>
              OCS Maintenance 는 admin 권한 사용자만 사용할 수 있습니다.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }
  return <OcsMaintenanceBody />;
}

function OcsMaintenanceBody() {
  const fetchStats = useServerFn(getOcsImportStats);
  const runVerify = useServerFn(ocsVerify);
  const runV3Verify = useServerFn(ocsV3Verify);
  const [busy, setBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  const stats = useQuery({ queryKey: ["abd-ocs-import-stats"], queryFn: () => fetchStats({}) });

  const onVerify = async () => {
    setBusy(true);
    try {
      const [legacy, v3] = await Promise.all([runVerify({}), runV3Verify({})]);
      setVerifyResult(JSON.stringify({ abd_ocs_verify: legacy, abd_ocs_v3_verify: v3 }, null, 2));
      toast.success("무결성 검증 완료");
    } catch (e) {
      toast.error(`검증 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">OCS Maintenance</h1>
        <p className="text-sm text-muted-foreground">
          OCS 정본 현황 조회 · 캐시 재계산 · 무결성 검증 전용 화면입니다. 데이터 적재는 하지
          않습니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">OCS DB 현황</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-6 text-sm">
          <span>OCS 코멘트 {stats.data?.comment_count ?? 0}건</span>
          <span>도면 연결 {stats.data?.linked_count ?? 0}건</span>
          <span>첨부 메타 {stats.data?.attachment_count ?? 0}건</span>
        </CardContent>
      </Card>

      <OcsRecountPanel />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> 무결성 검증
          </CardTitle>
          <CardDescription>
            기존 <code>abd_ocs_verify</code> · <code>abd_ocs_v3_verify</code> 를 읽기 전용으로
            실행합니다. 정본 데이터는 변경되지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={onVerify} disabled={busy} variant="outline" size="sm">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}검증 실행
          </Button>
          {verifyResult && (
            <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              {verifyResult}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">정규 Import 경로 안내</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          OCS 코멘트·첨부 적재는 <b>Import → ABD OCS</b> 탭의 정규 증분 Import 로 일원화되었습니다.
          이 화면에는 적재 기능이 없습니다.
        </CardContent>
      </Card>
    </div>
  );
}
