import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePdbModuleFilters, PDB_FILTERS_QUERY_KEY } from "@/hooks/usePdbModuleFilters";
import {
  PDB_DEFAULTS,
  type PdbAbdFilters,
  type PdbSmFilters,
  type PdbTmFilters,
} from "@/lib/dashboards/pdb-filters";
import { DISCIPLINES } from "@/lib/task-management/columns";
import { useTmWorkTypeOptions } from "@/hooks/useTmWorkTypeOptions";
import { useDefectFacet } from "@/hooks/useDefectItems";
import { ALL_TEAMS, ROOM_GROUP_ORDER } from "@/lib/defect-management/dashboard-shape";
import { ALL_STAGES, STAGE_LABELS } from "@/lib/defect-management/progress-utils";
import { ABD_TEAMS } from "@/lib/abd/columns";

export const Route = createFileRoute("/_authenticated/admin/setting")({
  head: () => ({
    meta: [
      { title: "Admin — Project Dashboard 필터 세팅" },
      {
        name: "description",
        content: "Project Dashboard 의 TM · SM · ABD 모듈별 필터와 차트 시작일을 설정합니다.",
      },
      { property: "og:title", content: "Admin — Project Dashboard 필터 세팅" },
      {
        property: "og:description",
        content: "Project Dashboard 의 TM · SM · ABD 모듈별 필터와 차트 시작일을 설정합니다.",
      },
    ],
  }),
  component: Page,
});

const BUCKETS = [
  { value: "day", label: "일" },
  { value: "week", label: "주" },
  { value: "month", label: "월" },
] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0">
      <span className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Multi({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <ToggleGroup
      type="multiple"
      value={value}
      onValueChange={(v) => onChange(v as string[])}
      className="flex-wrap justify-start gap-1"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o}
          value={o}
          className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          {o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Single<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className="flex-wrap justify-start gap-1"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function StartDate({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-8 w-[150px] text-xs"
      />
      <span className="text-[11px] text-muted-foreground">
        비우면 기본값(오늘 −14일) · 끝날짜는 PDB 기준일 · 차트에만 적용(KPI 카드는 미적용)
      </span>
    </div>
  );
}

function Page() {
  const qc = useQueryClient();
  const { data, isLoading } = usePdbModuleFilters();
  const [tm, setTm] = useState<PdbTmFilters>(PDB_DEFAULTS.tm);
  const [sm, setSm] = useState<PdbSmFilters>(PDB_DEFAULTS.sm);
  const [abd, setAbd] = useState<PdbAbdFilters>(PDB_DEFAULTS.abd);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setTm(data.tm);
    setSm(data.sm);
    setAbd(data.abd);
  }, [data]);

  const { data: workTypeOptions = [] } = useTmWorkTypeOptions();
  const buildingFacetQ = useDefectFacet("building");
  const buildingOptions = useMemo(
    () => ((buildingFacetQ.data ?? []) as Array<{ value: string }>).map((f) => f.value).filter(Boolean),
    [buildingFacetQ.data],
  );

  async function save() {
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      const rows = [
        { module: "tm", filters: tm, updated_at: new Date().toISOString(), updated_by: uid },
        { module: "sm", filters: sm, updated_at: new Date().toISOString(), updated_by: uid },
        { module: "abd", filters: abd, updated_at: new Date().toISOString(), updated_by: uid },
      ];
      const { error } = await (supabase as any)
        .from("pdb_module_filters")
        .upsert(rows, { onConflict: "module" });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: PDB_FILTERS_QUERY_KEY });
      toast.success("Project Dashboard 필터 세팅을 저장했습니다.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setTm(PDB_DEFAULTS.tm);
    setSm(PDB_DEFAULTS.sm);
    setAbd(PDB_DEFAULTS.abd);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Setting — Project Dashboard 필터</h1>
          <p className="text-sm text-muted-foreground">
            여기서 저장한 값이 Project Dashboard 의 KPI 카드와 S-Curve 에 그대로 적용됩니다. HDEC PIC ·
            HDEC ENG 는 항상 전체이므로 설정 대상이 아닙니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetAll} disabled={saving}>
            <RotateCcw className="mr-1 h-4 w-4" /> 기본값
          </Button>
          <Button size="sm" onClick={save} disabled={saving || isLoading}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            저장
          </Button>
        </div>
      </div>

      <Tabs defaultValue="tm">
        <TabsList>
          <TabsTrigger value="tm">Task Management</TabsTrigger>
          <TabsTrigger value="sm">Snag Management</TabsTrigger>
          <TabsTrigger value="abd">As Built Drawing</TabsTrigger>
        </TabsList>

        <TabsContent value="tm">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">TM 필터</CardTitle>
              <CardDescription>Plot(C · D)은 대시보드가 좌우로 항상 함께 보여주므로 설정 대상이 아닙니다.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Row label="Task Scope">
                <Single
                  options={[
                    { value: "sub", label: "Sub" },
                    { value: "main", label: "Main" },
                    { value: "all", label: "All" },
                  ] as const}
                  value={tm.taskScope}
                  onChange={(v) => setTm({ ...tm, taskScope: v })}
                />
              </Row>
              <Row label="Team">
                <Multi
                  options={DISCIPLINES}
                  value={tm.disciplines}
                  onChange={(v) => setTm({ ...tm, disciplines: v })}
                />
              </Row>
              <Row label="Work Type">
                <Single
                  options={[{ value: "all", label: "전체" }, ...workTypeOptions.map((o) => ({ value: o, label: o }))]}
                  value={tm.workType}
                  onChange={(v) => setTm({ ...tm, workType: v })}
                />
              </Row>
              <Row label="Delay">
                <Single
                  options={[
                    { value: "all", label: "전체" },
                    { value: "delayed", label: "지연만" },
                    { value: "risk", label: "악화만" },
                  ] as const}
                  value={tm.delayFilter}
                  onChange={(v) => setTm({ ...tm, delayFilter: v })}
                />
              </Row>
              <Row label="Bucket">
                <Single options={BUCKETS} value={tm.bucket} onChange={(v) => setTm({ ...tm, bucket: v })} />
              </Row>
              <Row label="차트 시작일">
                <StartDate value={tm.startDate} onChange={(v) => setTm({ ...tm, startDate: v })} />
              </Row>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sm">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">SM 필터</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Row label="Team">
                <Multi options={ALL_TEAMS} value={sm.teams} onChange={(v) => setSm({ ...sm, teams: v })} />
              </Row>
              <Row label="Room Group">
                <Multi
                  options={ROOM_GROUP_ORDER}
                  value={sm.roomGroups}
                  onChange={(v) => setSm({ ...sm, roomGroups: v })}
                />
              </Row>
              <Row label="Building">
                <Multi
                  options={buildingOptions}
                  value={sm.buildings}
                  onChange={(v) => setSm({ ...sm, buildings: v })}
                />
              </Row>
              <Row label="Stage">
                <Single
                  options={ALL_STAGES.map((s) => ({ value: s as string, label: STAGE_LABELS[s] }))}
                  value={sm.stage}
                  onChange={(v) => setSm({ ...sm, stage: v })}
                />
              </Row>
              <Row label="Plan Mode">
                <Single
                  options={[
                    { value: "baseline", label: "Baseline" },
                    { value: "remaining", label: "Remaining" },
                  ] as const}
                  value={sm.planMode}
                  onChange={(v) => setSm({ ...sm, planMode: v })}
                />
              </Row>
              <Row label="단위">
                <Single
                  options={[
                    { value: "cnt", label: "건수" },
                    { value: "pct", label: "%" },
                  ] as const}
                  value={sm.unit}
                  onChange={(v) => setSm({ ...sm, unit: v })}
                />
              </Row>
              <Row label="Bucket">
                <Single options={BUCKETS} value={sm.bucket} onChange={(v) => setSm({ ...sm, bucket: v })} />
              </Row>
              <Row label="차트 시작일">
                <StartDate value={sm.startDate} onChange={(v) => setSm({ ...sm, startDate: v })} />
              </Row>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abd">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">ABD 필터</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Row label="Team">
                <Multi
                  options={ABD_TEAMS.map((t) => t.value)}
                  value={abd.teams}
                  onChange={(v) => setAbd({ ...abd, teams: v })}
                />
              </Row>
              <Row label="Plan Mode">
                <Single
                  options={[
                    { value: "baseline", label: "Baseline" },
                    { value: "remaining", label: "Remaining" },
                  ] as const}
                  value={abd.planMode}
                  onChange={(v) => setAbd({ ...abd, planMode: v })}
                />
              </Row>
              <Row label="Bucket">
                <Single options={BUCKETS} value={abd.bucket} onChange={(v) => setAbd({ ...abd, bucket: v })} />
              </Row>
              <Row label="차트 시작일">
                <StartDate value={abd.startDate} onChange={(v) => setAbd({ ...abd, startDate: v })} />
              </Row>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
