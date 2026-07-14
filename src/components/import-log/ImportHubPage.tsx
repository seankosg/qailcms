import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TaskManagementImportPage } from "@/components/task-management/import/TaskManagementImportPage";
import { DefectManagementImportPage } from "@/components/defect-management/import/DefectManagementImportPage";
import { SparePartImportPage } from "@/components/spare-part/import/SparePartImportPage";
import { AbdImportPage } from "@/components/abd/import/AbdImportPage";
import { getRouteApi } from "@tanstack/react-router";

const routeApi = getRouteApi("/_authenticated/import-log/import");

export function ImportHubPage() {
  const { tab } = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const current = tab ?? "task";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground">
          각 모듈의 Excel 임포트 기능을 탭으로 전환하여 사용합니다.
        </p>
      </div>
      <Tabs
        value={current}
        onValueChange={(v) => navigate({ to: "/import-log/import", search: { tab: v } })}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="task">Task Management</TabsTrigger>
          <TabsTrigger value="snag">Snag List</TabsTrigger>
          <TabsTrigger value="spare-part">Spare Part</TabsTrigger>
          <TabsTrigger value="abd">ABD</TabsTrigger>
          <TabsTrigger value="warranty">Warranty</TabsTrigger>
        </TabsList>
        <TabsContent value="task" className="mt-4">
          <TaskManagementImportPage />
        </TabsContent>
        <TabsContent value="snag" className="mt-4">
          <DefectManagementImportPage />
        </TabsContent>
        <TabsContent value="spare-part" className="mt-4">
          <SparePartImportPage />
        </TabsContent>
        <TabsContent value="abd" className="mt-4">
          <AbdImportPage />
        </TabsContent>
        <TabsContent value="warranty" className="mt-4">
          <ComingSoonCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ComingSoonCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Warranty & License — Import</CardTitle>
        <CardDescription>준비 중입니다. 추후 지원 예정.</CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">Coming soon</CardContent>
    </Card>
  );
}