import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Row = { plot: string; kind: string; target_date: string | null; updated_at: string };

const KIND_ORDER = ["HO", "COC", "DLP"] as const;

export const Route = createFileRoute("/_authenticated/admin/milestones")({
  head: () => ({ meta: [{ title: "Admin — Milestone 일정" }] }),
  component: Page,
});

function Page() {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["tm_milestone_config"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tm_milestone_config")
        .select("plot, kind, target_date, updated_at")
        .order("plot", { ascending: true })
        .order("kind", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: dist = [] } = useQuery<Array<{ plot: string | null; kind: string; cnt: number }>>({
    queryKey: ["tm_milestone_distribution"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select("plot, milestone")
        .not("milestone", "is", null);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as Array<{ plot: string | null; milestone: string }>) {
        const k = `${r.plot ?? "(null)"}::${r.milestone}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return Array.from(m.entries()).map(([k, cnt]) => {
        const [p, kind] = k.split("::");
        return { plot: p === "(null)" ? null : p, kind, cnt };
      });
    },
  });

  const grouped = useMemo(() => {
    const g = new Map<string, Row[]>();
    for (const r of rows) {
      const arr = g.get(r.plot) ?? [];
      arr.push(r);
      g.set(r.plot, arr);
    }
    return Array.from(g.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const d: Record<string, string> = {};
    for (const r of rows) d[`${r.plot}::${r.kind}`] = r.target_date ?? "";
    setDraft(d);
  }, [rows]);

  async function saveCell(plot: string, kind: string) {
    const key = `${plot}::${kind}`;
    setSaving(key);
    try {
      const val = draft[key]?.trim() || null;
      const { error } = await (supabase as any)
        .from("tm_milestone_config")
        .upsert({ plot, kind, target_date: val }, { onConflict: "plot,kind" });
      if (error) throw error;
      toast.success(`${plot} · ${kind} 저장`);
      qc.invalidateQueries({ queryKey: ["tm_milestone_config"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(null);
    }
  }

  const distMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dist) m.set(`${d.plot ?? "(null)"}::${d.kind}`, d.cnt);
    return m;
  }, [dist]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin — Milestone 일정</h1>
        <p className="text-sm text-muted-foreground">
          Plot × Milestone(HO / COC / DLP) 목표 일자를 관리합니다. Raw Data의 Overdue / Expected
          Finish 판정 기준으로 사용됩니다.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 로딩 중…
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {grouped.map(([plot, plotRows]) => {
            const byKind = new Map(plotRows.map((r) => [r.kind, r]));
            return (
              <Card key={plot}>
                <CardHeader>
                  <CardTitle className="text-base">Plot {plot}</CardTitle>
                  <CardDescription>Raw 데이터 항목 수를 옆에 함께 표시</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {KIND_ORDER.map((kind) => {
                    const row = byKind.get(kind);
                    const key = `${plot}::${kind}`;
                    const cnt = distMap.get(key) ?? 0;
                    return (
                      <div key={kind} className="flex items-end gap-2">
                        <div className="w-16">
                          <Badge variant="secondary">{kind}</Badge>
                        </div>
                        <div className="flex-1">
                          <Input
                            type="date"
                            value={draft[key] ?? ""}
                            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                            disabled={!row}
                          />
                        </div>
                        <div className="w-16 text-right text-xs text-muted-foreground">
                          {cnt.toLocaleString()}건
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!row || saving === key}
                          onClick={() => saveCell(plot, kind)}
                        >
                          {saving === key && (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          )}
                          저장
                        </Button>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ALSMK 체크</CardTitle>
          <CardDescription>
            Config에 없는 (plot × milestone) 조합이 Raw Data에 존재하는지 검증합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlsmkCheck rows={rows} dist={dist} />
        </CardContent>
      </Card>
    </div>
  );
}

function AlsmkCheck({
  rows,
  dist,
}: {
  rows: Row[];
  dist: Array<{ plot: string | null; kind: string; cnt: number }>;
}) {
  const configured = new Set(rows.map((r) => `${r.plot}::${r.kind}`));
  const missing = dist.filter((d) => !configured.has(`${d.plot ?? "(null)"}::${d.kind}`));
  if (missing.length === 0)
    return (
      <div className="text-sm text-emerald-600">
        ✓ 모든 (plot × milestone) 조합이 Config에 정의되어 있습니다.
      </div>
    );
  return (
    <ul className="space-y-1 text-sm">
      {missing.map((m) => (
        <li key={`${m.plot}::${m.kind}`} className="text-amber-700">
          Plot <b>{m.plot ?? "(null)"}</b> · {m.kind} — Raw {m.cnt.toLocaleString()}건, Config 없음
        </li>
      ))}
    </ul>
  );
}