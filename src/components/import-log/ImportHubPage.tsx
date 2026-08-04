import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskManagementImportPage } from "@/components/task-management/import/TaskManagementImportPage";
import { DefectManagementImportPage } from "@/components/defect-management/import/DefectManagementImportPage";
import { AbdImportPage } from "@/components/abd/import/AbdImportPage";
import { DmrImportPage } from "@/components/resource/dmr/DmrImportPage";
import { SplImportPage } from "@/components/spl/import/SplImportPage";
import { WrtImportPage } from "@/components/wrt/import/WrtImportPage";
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
      </div>
      <Tabs
        value={current}
        onValueChange={(v) => navigate({ to: "/import-log/import", search: { tab: v } })}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="task">Task Management</TabsTrigger>
          <TabsTrigger value="snag">Snag List</TabsTrigger>
          <TabsTrigger value="abd">ABD</TabsTrigger>
          <TabsTrigger value="dmr">DMR</TabsTrigger>
          <TabsTrigger value="spl">Spare Parts</TabsTrigger>
          <TabsTrigger value="warranty">Warranty</TabsTrigger>
        </TabsList>
        <TabsContent value="task" className="mt-4">
          <TaskManagementImportPage />
        </TabsContent>
        <TabsContent value="snag" className="mt-4">
          <DefectManagementImportPage />
        </TabsContent>
        <TabsContent value="abd" className="mt-4">
          <AbdImportPage />
        </TabsContent>
        <TabsContent value="dmr" className="mt-4">
          <DmrImportPage />
        </TabsContent>
        <TabsContent value="spl" className="mt-4">
          <SplImportPage />
        </TabsContent>
        <TabsContent value="warranty" className="mt-4">
          <WrtImportPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}