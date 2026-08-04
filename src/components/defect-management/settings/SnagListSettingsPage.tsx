import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DefectCategoryTeamMapPage } from "./DefectCategoryTeamMapPage";
import { SubconRuleTab } from "./SubconRuleTab";

export function SnagListSettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Snag List Settings</h1>
        <p className="text-sm text-muted-foreground">
          Snag List 임포트 시 적용되는 자동 매핑 rule 을 관리합니다.
        </p>
      </div>
      <Tabs defaultValue="category" className="w-full">
        <TabsList>
          <TabsTrigger value="category">Category → Team</TabsTrigger>
          <TabsTrigger value="subcon">Subcon</TabsTrigger>
        </TabsList>
        <TabsContent value="category" className="pt-4">
          <DefectCategoryTeamMapPage />
        </TabsContent>
        <TabsContent value="subcon" className="pt-4">
          <SubconRuleTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}