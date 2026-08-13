import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Toggle } from "@/components/ui/toggle";

type Row = { plot: string; kind: string; target_date: string | null; updated_at: string };
type Kind = { kind_code: string; label: string; sort_order: number; is_active: boolean };

const FALLBACK_KINDS: Kind[] = [
  { kind_code: "HO", label: "HO", sort_order: 10, is_active: true },
  { kind_code: "COC", label: "COC", sort_order: 20, is_active: true },
  { kind_code: "DLP", label: "DLP", sort_order: 30, is_active: true },
];

export const Route = createFileRoute("/_authenticated/admin/milestones")({
  head: () => ({ meta: [{ title: "Admin — Milestone 일정" }] }),
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const [deletingCell, setDeletingCell] = useState<string | null>(null);
  const [hidePlotG, setHidePlotG] = useState(() => {
    try {
      return localStorage.getItem("admin_milestones_hide_plot_g") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("admin_milestones_hide_plot_g", String(hidePlotG));
    } catch {
      // ignore
    }
  }, [hidePlotG]);

  // 특정 Plot의 특정 Milestone 행만 삭제 (다른 Plot의 동일 Kind는 유지)
  async function deletePlotKind(plot: string, kind: string) {
    const key = `${plot}::${kind}`;
    if (!confirm(`Plot ${plot} 의 Milestone '${kind}' 를 삭제하시겠습니까?\n(다른 Plot의 동일 Milestone 설정은 유지됩니다)`)) return;
    setDeletingCell(key);
    try {
      const { error } = await (supabase as any)
        .from("tm_milestone_config")
        .delete()
        .eq("plot", plot)
        .eq("kind", kind);
      if (error) throw error;
      // 어떤 Plot에도 남아있지 않으면 Kind 자체도 소프트 삭제
      const { data: remain } = await (supabase as any)
        .from("tm_milestone_config")
        .select("plot")
        .eq("kind", kind)
        .limit(1);
      if (!remain || remain.length === 0) {
        // Raw Data에서 사용 중인지 확인 (FK로 하드 삭제는 이미 차단됨).
        // 사용 중이면 종류 자체는 유지하고 안내만 노출.
        const { count: usedCount } = await (supabase as any)
          .from("task_management_raw")
          .select("id", { count: "exact", head: true })
          .eq("milestone", kind);
        if ((usedCount ?? 0) > 0) {
          toast.info(
            `'${kind}' 는 Raw Data ${usedCount}건에서 사용 중이라 종류 자체는 삭제되지 않았습니다.`,
          );
        } else {
          const { error: eKind } = await (supabase as any)
            .from("tm_milestone_kinds")
            .update({ deleted_at: new Date().toISOString(), is_active: false })
            .eq("kind_code", kind);
          if (eKind) {
            // FK RESTRICT 등으로 실패한 경우 안내
            toast.info(
              `'${kind}' 는 사용 중인 마일스톤이라 종류 자체는 삭제되지 않았습니다.`,
            );
          } else {
            qc.invalidateQueries({ queryKey: ["tm_milestone_kinds"] });
          }
        }
      }
      toast.success(`Plot ${plot} · ${kind} 삭제됨`);
      qc.invalidateQueries({ queryKey: ["tm_milestone_config"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setDeletingCell(null);
    }
  }

  const { data: kinds = FALLBACK_KINDS } = useQuery<Kind[]>({
    queryKey: ["tm_milestone_kinds"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tm_milestone_kinds")
        .select("kind_code, label, sort_order, is_active")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Kind[];
    },
  });

  const kindOrder = useMemo(() => kinds.map((k) => k.kind_code), [kinds]);

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
      if (hidePlotG && r.plot === "G") continue;
      const arr = g.get(r.plot) ?? [];
      arr.push(r);
      g.set(r.plot, arr);
    }
    // 기존 Plot 목록이 하나도 없어도 'G' 카드는 노출 (신규 프로젝트 초기 상태 지원)
    if (g.size === 0 && !hidePlotG) g.set("G", []);
    return Array.from(g.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows, hidePlotG]);

  const plotList = useMemo(() => grouped.map(([p]) => p), [grouped]);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Admin — Milestone 일정</h1>
          <p className="text-sm text-muted-foreground">
            Plot × Milestone(HO / COC / DLP) 목표 일자를 관리합니다. Raw Data의 Overdue / Expected
            Finish 판정 기준으로 사용됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["tm_milestone_kinds"] });
              qc.invalidateQueries({ queryKey: ["tm_milestone_config"] });
              qc.invalidateQueries({ queryKey: ["tm_milestone_distribution"] });
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            새로고침
          </Button>
          <Toggle
            aria-label="Plot G 숨김"
            pressed={hidePlotG}
            onPressedChange={setHidePlotG}
            className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            Plot G 숨김
          </Toggle>
        </div>
      </div>

      <KindManager kinds={kinds} plots={plotList} />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-40 animate-pulse rounded bg-muted/70" />
              </CardHeader>
              <CardContent className="space-y-3">
                {kindOrder.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <div className="h-6 w-12 animate-pulse rounded bg-muted" />
                    <div className="h-9 flex-1 animate-pulse rounded bg-muted/70" />
                    <div className="h-8 w-14 animate-pulse rounded bg-muted/70" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Milestone 설정을 불러오는 중…
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {grouped.map(([plot, plotRows]) => {
            const byKind = new Map(plotRows.map((r) => [r.kind, r]));
            // 이 Plot에 지정된 Milestone만 노출. 날짜 오름차순, 미설정 뒤로,
            // 동률 시 전역 kindOrder(sort_order) 기준으로 안정 정렬.
            const plotKinds = kindOrder.filter((k) => byKind.has(k));
            const sortedKinds = [...plotKinds].sort((a, b) => {
              const da = byKind.get(a)?.target_date ?? null;
              const db = byKind.get(b)?.target_date ?? null;
              if (da && db) return da.localeCompare(db);
              if (da) return -1;
              if (db) return 1;
              return kindOrder.indexOf(a) - kindOrder.indexOf(b);
            });
            return (
              <Card key={plot}>
                <CardHeader>
                  <CardTitle className="text-base">Plot {plot}</CardTitle>
                  <CardDescription>Raw 데이터 항목 수를 옆에 함께 표시</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {sortedKinds.length === 0 && (
                    <div className="text-xs text-muted-foreground">
                      이 Plot에 지정된 Milestone이 없습니다. 상단 “Milestone 종류 관리”에서 Plot을 선택해 추가하세요.
                    </div>
                  )}
                  {sortedKinds.map((kind) => {
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
                          />
                        </div>
                        <div className="w-16 text-right text-xs text-muted-foreground">
                          {cnt.toLocaleString()}건
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saving === key}
                          onClick={() => saveCell(plot, kind)}
                        >
                          {saving === key && (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          )}
                          저장
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          disabled={deletingCell === key}
                          onClick={() => deletePlotKind(plot, kind)}
                          title={`Plot ${plot} · ${kind} 삭제`}
                        >
                          {deletingCell === key ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3 text-destructive" />
                          )}
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
          <CardTitle className="text-base">Plot 미지정 점검</CardTitle>
          <CardDescription>
            Config에 없는 (plot × milestone) 조합이 Raw Data에 존재하는지 검증합니다. plot이 비어있는 항목은 여기서 경보로 노출됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlsmkCheck rows={rows} dist={dist} />
        </CardContent>
      </Card>
    </div>
  );
}

function KindManager({ kinds, plots }: { kinds: Kind[]; plots: string[] }) {
  const qc = useQueryClient();
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedPlots, setSelectedPlots] = useState<string[]>([]);

  function togglePlot(p: string) {
    setSelectedPlots((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }
  function toggleAll() {
    setSelectedPlots((prev) => (prev.length === plots.length ? [] : [...plots]));
  }

  async function addKind() {
    const code = newCode.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) return toast.error("Kind 코드를 입력하세요");
    if (!/^[A-Z0-9_-]{1,16}$/.test(code)) return toast.error("영문/숫자/-/_ 1~16자만 허용");
    if (selectedPlots.length === 0) return toast.error("적용할 Plot을 최소 1개 선택하세요");
    setBusy("add");
    try {
      const nextOrder = (kinds[kinds.length - 1]?.sort_order ?? 0) + 10;
      // Kind는 upsert (이미 존재하면 재사용), 삭제된 Kind는 복원
      const { error } = await (supabase as any)
        .from("tm_milestone_kinds")
        .upsert(
          {
            kind_code: code,
            label: newLabel.trim() || code,
            sort_order: nextOrder,
            is_active: true,
            deleted_at: null,
          },
          { onConflict: "kind_code" },
        );
      if (error) throw error;
      // 선택된 Plot마다 config 행 upsert (target_date는 null로 시작)
      const { error: e2 } = await (supabase as any)
        .from("tm_milestone_config")
        .upsert(
          selectedPlots.map((p) => ({ plot: p, kind: code, target_date: null })),
          { onConflict: "plot,kind", ignoreDuplicates: true },
        );
      if (e2) throw e2;
      toast.success(`${code} 추가됨`);
      setNewCode("");
      setNewLabel("");
      setSelectedPlots([]);
      qc.invalidateQueries({ queryKey: ["tm_milestone_kinds"] });
      qc.invalidateQueries({ queryKey: ["tm_milestone_config"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Milestone 종류 관리</CardTitle>
        <CardDescription>
          새 Milestone 종류(HO, COC, DLP 등)를 <b>선택한 Plot에만</b> 추가합니다. 삭제는 각 Plot 카드의 Milestone 행 오른쪽 휴지통 버튼을 사용하세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <div
              key={k.kind_code}
              className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-sm"
            >
              <Badge variant="secondary" className="font-mono">
                {k.kind_code}
              </Badge>
              {k.label !== k.kind_code && (
                <span className="text-xs text-muted-foreground">{k.label}</span>
              )}
            </div>
          ))}
          {kinds.length === 0 && (
            <span className="text-sm text-muted-foreground">등록된 Kind가 없습니다.</span>
          )}
        </div>
        <div className="space-y-2 border-t pt-3">
          <div>
            <label className="text-xs text-muted-foreground">적용 Plot 선택</label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {plots.length === 0 && (
                <span className="text-xs text-muted-foreground">사용 가능한 Plot이 없습니다.</span>
              )}
              {plots.length > 0 && (
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={selectedPlots.length === plots.length}
                    onCheckedChange={toggleAll}
                  />
                  <span className="font-medium">전체</span>
                </label>
              )}
              {plots.map((p) => (
                <label key={p} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={selectedPlots.includes(p)}
                    onCheckedChange={() => togglePlot(p)}
                  />
                  <span>Plot {p}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <label className="text-xs text-muted-foreground">Kind 코드</label>
            <Input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="PAC"
              maxLength={16}
              className="font-mono uppercase"
            />
          </div>
          <div className="w-48">
            <label className="text-xs text-muted-foreground">표시명 (선택)</label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Provisional Acceptance"
            />
          </div>
            <Button
              onClick={addKind}
              disabled={busy === "add" || !newCode.trim() || selectedPlots.length === 0}
            >
            {busy === "add" ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3 w-3" />
            )}
            추가
          </Button>
          </div>
        </div>
      </CardContent>
    </Card>
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