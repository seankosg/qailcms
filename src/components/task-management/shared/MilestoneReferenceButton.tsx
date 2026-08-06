import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Kind {
  kind_code: string;
  label: string | null;
  sort_order: number | null;
  is_active: boolean | null;
}
interface Cfg {
  plot: string;
  kind: string;
  target_date: string | null;
}

/** Admin 마일스톤 설정(tm_milestone_config)을 Plot 별 표로 보여주는 읽기 전용 참조 창. */
export function MilestoneReferenceButton() {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tm_milestone_reference"],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const [kindsRes, cfgRes] = await Promise.all([
        (supabase as any)
          .from("tm_milestone_kinds")
          .select("kind_code, label, sort_order, is_active")
          .is("deleted_at", null)
          .order("sort_order", { ascending: true }),
        (supabase as any)
          .from("tm_milestone_config")
          .select("plot, kind, target_date"),
      ]);
      if (kindsRes.error) throw kindsRes.error;
      if (cfgRes.error) throw cfgRes.error;
      return {
        kinds: (kindsRes.data ?? []) as Kind[],
        cfg: (cfgRes.data ?? []) as Cfg[],
      };
    },
  });

  const { plots, kinds, byPlot } = useMemo(() => {
    const kinds = (data?.kinds ?? []).filter((k) => k.is_active !== false);
    const byPlot = new Map<string, Map<string, string | null>>();
    for (const r of data?.cfg ?? []) {
      if (!r?.plot || !r?.kind) continue;
      const m = byPlot.get(r.plot) ?? new Map<string, string | null>();
      m.set(r.kind, r.target_date ?? null);
      byPlot.set(r.plot, m);
    }
    const plots = Array.from(byPlot.keys()).sort((a, b) => a.localeCompare(b));
    return { plots, kinds, byPlot };
  }, [data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
          <CalendarRange className="h-3.5 w-3.5" />
          Milestone Reference
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Milestone Reference</DialogTitle>
          <DialogDescription>
            Admin &gt; 마일스톤 설정에 등록된 Plot 별 마일스톤 기준일 (읽기 전용)
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : plots.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            등록된 마일스톤 설정이 없습니다.
          </p>
        ) : (
          <div className="space-y-4">
            {plots.map((plot) => {
              const m = byPlot.get(plot)!;
              const rows = kinds
                .filter((k) => m.has(k.kind_code))
                .sort((a, b) => {
                  const dateA = m.get(a.kind_code) ?? "";
                  const dateB = m.get(b.kind_code) ?? "";
                  if (dateA !== dateB) return dateA.localeCompare(dateB);
                  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
                });
              return (
                <div key={plot} className="rounded-md border">
                  <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
                    <span className="text-sm font-semibold">Plot {plot}</span>
                    <Badge variant="secondary" className="tabular-nums">
                      {rows.length}
                    </Badge>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="px-3 py-1.5 text-left font-medium">Milestone</th>
                        <th className="px-3 py-1.5 text-left font-medium">라벨</th>
                        <th className="px-3 py-1.5 text-left font-medium">기준일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((k) => (
                        <tr key={k.kind_code} className="border-b last:border-0">
                          <td className="px-3 py-1.5 font-medium">{k.kind_code}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {k.label ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {m.get(k.kind_code) ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
