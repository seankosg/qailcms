import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldConfigTable } from "@/components/admin/FieldConfigTable";
import { HeaderMappingTable } from "@/components/admin/HeaderMappingTable";

export const Route = createFileRoute("/_authenticated/admin/mapping")({
  component: MappingPage,
});

function MappingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Mapping</h1>
        <p className="text-sm text-muted-foreground">
          Field Config — Raw Data 컬럼 헤더 라벨/정렬/노출. Header Mapping — Excel Import 시 원본 헤더 → 시스템 필드 별칭.
        </p>
      </div>
      <Tabs defaultValue="field-config" className="space-y-4">
        <TabsList>
          <TabsTrigger value="field-config">Field Config</TabsTrigger>
          <TabsTrigger value="header-mapping">Header Mapping</TabsTrigger>
        </TabsList>
        <TabsContent value="field-config"><FieldConfigTable /></TabsContent>
        <TabsContent value="header-mapping"><HeaderMappingTable /></TabsContent>
      </Tabs>
    </div>
  );
}
