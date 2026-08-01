import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ImportLogsPage } from "@/components/import/ImportLogsPage";
import { getRouteApi } from "@tanstack/react-router";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { TmImportRecordTab } from "@/components/import-log/task-management/TmImportRecordTab";

const routeApi = getRouteApi("/_authenticated/import-log/logs");

export function ImportLogsHubPage() {
  const { tab, sub } = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const current = tab ?? "task";
  const currentSub = sub ?? "file";
  const { data: me } = useCurrentUser();
  const canRecord = !!(me?.isAdmin || me?.isSuperUser);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import Logs</h1>
        <p className="text-sm text-muted-foreground">
          각 모듈의 임포트 이력을 탭으로 전환하여 확인합니다.
        </p>
      </div>
      <Tabs
        value={current}
        onValueChange={(v) =>
          navigate({ to: "/import-log/logs", search: { tab: v, sub: currentSub } })
        }
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="task">Task Management</TabsTrigger>
          <TabsTrigger value="snag">Snag List</TabsTrigger>
          <TabsTrigger value="abd">ABD</TabsTrigger>
          <TabsTrigger value="warranty">Warranty</TabsTrigger>
        </TabsList>
        <TabsContent value="task" className="mt-4">
          <Tabs
            value={currentSub}
            onValueChange={(v) =>
              navigate({
                to: "/import-log/logs",
                search: { tab: "task", sub: v as "file" | "record" },
              })
            }
            className="w-full"
          >
            <TabsList>
              <TabsTrigger value="file">Import File</TabsTrigger>
              {canRecord && <TabsTrigger value="record">Import Record</TabsTrigger>}
            </TabsList>
            <TabsContent value="file" className="mt-4">
              <ImportLogsPage kind="task_management" />
            </TabsContent>
            {canRecord && (
              <TabsContent value="record" className="mt-4">
                <TmImportRecordTab />
              </TabsContent>
            )}
          </Tabs>
        </TabsContent>
        <TabsContent value="snag" className="mt-4">
          <ImportLogsPage kind="defect_management" />
        </TabsContent>
        <TabsContent value="abd" className="mt-4">
          <ImportLogsPage kind="abd" />
        </TabsContent>
        <TabsContent value="warranty" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Warranty & License — Logs</CardTitle>
              <CardDescription>준비 중입니다.</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Coming soon</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}