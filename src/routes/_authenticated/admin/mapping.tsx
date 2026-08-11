import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TmFieldConfigTable } from "@/components/admin/TmFieldConfigTable";
import { TmHeaderMappingTable } from "@/components/admin/TmHeaderMappingTable";
import { DefectFieldConfigTable } from "@/components/admin/DefectFieldConfigTable";
import { DefectHeaderMappingTable } from "@/components/admin/DefectHeaderMappingTable";
import { DefectImportPresetTable } from "@/components/admin/DefectImportPresetTable";
import { AbdFieldConfigTable } from "@/components/admin/AbdFieldConfigTable";
import { AbdHeaderMappingTable } from "@/components/admin/AbdHeaderMappingTable";
import { AbdImportPresetTable } from "@/components/admin/AbdImportPresetTable";
import { SplFieldConfigTable } from "@/components/admin/SplFieldConfigTable";
import { SplHeaderMappingTable } from "@/components/admin/SplHeaderMappingTable";
import { SplImportPresetTable } from "@/components/admin/SplImportPresetTable";

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
      <Tabs defaultValue="as-built" className="space-y-4">
        <TabsList>
          <TabsTrigger value="as-built">As Built Drawing</TabsTrigger>
          <TabsTrigger value="task-management">Task Management</TabsTrigger>
          <TabsTrigger value="spare-parts">Spare Parts List</TabsTrigger>
          <TabsTrigger value="defect-management">Snag List Management</TabsTrigger>
        </TabsList>
        <TabsContent value="as-built" className="space-y-4">
          <Tabs defaultValue="field-config" className="space-y-4">
            <TabsList>
              <TabsTrigger value="field-config">Field Config</TabsTrigger>
              <TabsTrigger value="header-mapping">Header Mapping</TabsTrigger>
              <TabsTrigger value="preset-hdec">HDEC Preset</TabsTrigger>
              <TabsTrigger value="preset-aconex">Aconex Preset</TabsTrigger>
            </TabsList>
            <TabsContent value="field-config"><AbdFieldConfigTable /></TabsContent>
            <TabsContent value="header-mapping"><AbdHeaderMappingTable /></TabsContent>
            <TabsContent value="preset-hdec"><AbdImportPresetTable mode="hdec" /></TabsContent>
            <TabsContent value="preset-aconex"><AbdImportPresetTable mode="aconex" /></TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="task-management" className="space-y-4">
          <Tabs defaultValue="field-config" className="space-y-4">
            <TabsList>
              <TabsTrigger value="field-config">Field Config</TabsTrigger>
              <TabsTrigger value="header-mapping">Header Mapping</TabsTrigger>
            </TabsList>
            <TabsContent value="field-config"><TmFieldConfigTable /></TabsContent>
            <TabsContent value="header-mapping"><TmHeaderMappingTable /></TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="spare-parts" className="space-y-4">
          <Tabs defaultValue="field-config" className="space-y-4">
            <TabsList>
              <TabsTrigger value="field-config">Field Config</TabsTrigger>
              <TabsTrigger value="header-mapping">Header Mapping</TabsTrigger>
              <TabsTrigger value="preset-hdec">HDEC Preset</TabsTrigger>
              <TabsTrigger value="preset-aconex">Aconex Preset</TabsTrigger>
            </TabsList>
            <TabsContent value="field-config"><SplFieldConfigTable /></TabsContent>
            <TabsContent value="header-mapping"><SplHeaderMappingTable /></TabsContent>
            <TabsContent value="preset-hdec"><SplImportPresetTable mode="hdec" /></TabsContent>
            <TabsContent value="preset-aconex"><SplImportPresetTable mode="aconex" /></TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="defect-management" className="space-y-4">
          <Tabs defaultValue="field-config" className="space-y-4">
            <TabsList>
              <TabsTrigger value="field-config">Field Config</TabsTrigger>
              <TabsTrigger value="header-mapping">Header Mapping</TabsTrigger>
              <TabsTrigger value="preset">Preset</TabsTrigger>
            </TabsList>
            <TabsContent value="field-config"><DefectFieldConfigTable /></TabsContent>
            <TabsContent value="header-mapping"><DefectHeaderMappingTable /></TabsContent>
            <TabsContent value="preset"><DefectImportPresetTable /></TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
