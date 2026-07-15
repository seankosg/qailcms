import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AbdItemRow {
  id: string;
  team: string;
  plot: string | null;
  sl_no: number | null;
  abd_number: string;
  abd_ocs_no: string | null;
  document_title: string | null;
  pic: string | null;
  latest_rev: string | null;
  latest_status: string | null;
  approval_date: string | null;
  is_active: boolean;
  raw_payload: Record<string, any> | null;
  [k: string]: any;
}

interface ChangeLogRow {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  changed_at: string;
  changed_by: string | null;
}

const ROUND_FIELDS: { round: 1 | 2 | 3; stage: "Drafting" | "Submission" | "DAR"; plan: string; actual: string }[] = [
  { round: 1, stage: "Drafting",   plan: "r1_drafting_plan",   actual: "r1_drafting_actual" },
  { round: 1, stage: "Submission", plan: "r1_submission_plan", actual: "r1_submission_actual" },
  { round: 1, stage: "DAR",        plan: "r1_dar_plan",        actual: "r1_dar_actual" },
  { round: 2, stage: "Drafting",   plan: "r2_drafting_plan",   actual: "r2_drafting_actual" },
  { round: 2, stage: "Submission", plan: "r2_submission_plan", actual: "r2_submission_actual" },
  { round: 2, stage: "DAR",        plan: "r2_dar_plan",        actual: "r2_dar_actual" },
  { round: 3, stage: "Drafting",   plan: "r3_drafting_plan",   actual: "r3_drafting_actual" },
  { round: 3, stage: "Submission", plan: "r3_submission_plan", actual: "r3_submission_actual" },
  { round: 3, stage: "DAR",        plan: "r3_dar_plan",        actual: "r3_dar_actual" },
];

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

function isLate(plan: string | null, actual: string | null): boolean {
  if (!plan || !actual) return false;
  return new Date(actual).getTime() > new Date(plan).getTime();
}

export function AbdDetailSheet({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }) {
  const [item, setItem] = useState<AbdItemRow | null>(null);
  const [changes, setChanges] = useState<ChangeLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) { setItem(null); setChanges([]); return; }
    let cancel = false;
    const run = async () => {
      setLoading(true);
      try {
        const { data: it } = await (supabase as any).from("abd_items_raw").select("*").eq("id", id).maybeSingle();
        if (cancel) return;
        setItem(it as any);
        const { data: cl } = await (supabase as any)
          .from("abd_change_log")
          .select("id, field, old_value, new_value, source, changed_at, changed_by")
          .eq("abd_item_id", id)
          .order("changed_at", { ascending: false })
          .limit(20);
        if (cancel) return;
        setChanges((cl ?? []) as any);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    void run();
    return () => { cancel = true; };
  }, [id]);

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">
            {item ? (
              <div className="flex items-center gap-2">
                <span className="font-mono">{item.abd_number}</span>
                {!item.is_active && <Badge variant="secondary">Inactive</Badge>}
              </div>
            ) : "Loading..."}
          </SheetTitle>
        </SheetHeader>

        {loading && !item ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading...
          </div>
        ) : !item ? (
          <div className="py-16 text-center text-muted-foreground text-sm">데이터가 없습니다.</div>
        ) : (
          <div className="mt-4 space-y-6 text-xs">
            {/* Summary */}
            <section className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div><span className="text-muted-foreground">Team</span><div className="font-medium uppercase">{item.team}</div></div>
              <div><span className="text-muted-foreground">Plot</span><div className="font-medium">{item.plot ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Sl.No</span><div className="font-medium">{item.sl_no ?? "—"}</div></div>
              <div><span className="text-muted-foreground">OCS No</span><div className="font-medium">{item.abd_ocs_no ?? "—"}</div></div>
              <div className="col-span-2"><span className="text-muted-foreground">Document Title</span><div className="font-medium">{item.document_title ?? "—"}</div></div>
              <div><span className="text-muted-foreground">PIC</span><div className="font-medium">{item.pic ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Latest Rev</span><div className="font-medium">{item.latest_rev ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Latest Status</span><div className="font-medium">{item.latest_status ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Approval Date</span><div className="font-medium">{fmtDate(item.approval_date)}</div></div>
            </section>

            <Separator />

            {/* Rounds Timeline */}
            <section>
              <h3 className="font-semibold text-sm mb-2">Rounds Timeline</h3>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-2 py-1.5 w-16">Round</th>
                      <th className="text-left px-2 py-1.5 w-24">Stage</th>
                      <th className="text-left px-2 py-1.5">Plan</th>
                      <th className="text-left px-2 py-1.5">Actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROUND_FIELDS.map((rf) => {
                      const plan = (item as any)[rf.plan] as string | null;
                      const actual = (item as any)[rf.actual] as string | null;
                      const late = isLate(plan, actual);
                      return (
                        <tr key={`${rf.round}-${rf.stage}`} className="border-t">
                          <td className="px-2 py-1">R{rf.round}</td>
                          <td className="px-2 py-1">{rf.stage}</td>
                          <td className="px-2 py-1 text-muted-foreground">{fmtDate(plan)}</td>
                          <td className={cn("px-2 py-1", actual ? "font-medium" : "text-muted-foreground", late && "text-destructive")}>{fmtDate(actual)}{late && " ⚠"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Change Log */}
            <section>
              <h3 className="font-semibold text-sm mb-2">Change Log</h3>
              {changes.length === 0 ? (
                <p className="text-muted-foreground">변경 이력이 없습니다.</p>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-2 py-1.5">When</th>
                        <th className="text-left px-2 py-1.5">Field</th>
                        <th className="text-left px-2 py-1.5">Old</th>
                        <th className="text-left px-2 py-1.5">New</th>
                        <th className="text-left px-2 py-1.5">Src</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((c) => (
                        <tr key={c.id} className="border-t">
                          <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">{new Date(c.changed_at).toLocaleString("ko-KR", { hour12: false })}</td>
                          <td className="px-2 py-1 font-mono">{c.field}</td>
                          <td className="px-2 py-1">{c.old_value ?? "—"}</td>
                          <td className="px-2 py-1 font-medium">{c.new_value ?? "—"}</td>
                          <td className="px-2 py-1"><Badge variant="outline" className="text-[10px]">{c.source}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Raw Payload */}
            <section>
              <details className="rounded-md border p-2">
                <summary className="cursor-pointer font-semibold text-sm">Raw Payload</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/30 p-2 text-[11px]">
                  {JSON.stringify(item.raw_payload ?? {}, null, 2)}
                </pre>
              </details>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}