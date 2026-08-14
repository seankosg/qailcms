import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, CircleDashed, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setSplRequiredDoc, setSplRequiredDocReady } from "@/lib/spl/required-doc.functions";
import { normalizeSplFlagValue, SPL_FLAG_REQUIRED } from "@/lib/spl/flag-value";
import { formatDdMmm } from "@/lib/time/doha";
import type { SplCatalogEntry, SplRow } from "@/lib/spl/rows.functions";

export function SplRequiredDocChecklist({
  row,
  catalog,
  canEdit,
  onChanged,
}: {
  row: SplRow;
  catalog: SplCatalogEntry[];
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const setFlag = useServerFn(setSplRequiredDoc);
  const setReady = useServerFn(setSplRequiredDocReady);
  const [busy, setBusy] = useState<string | null>(null);

  const entries = useMemo(() => {
    return catalog
      .filter((s) => s.band === "REQUIRED_DOC")
      .map((s) => {
        const c = row.stages[s.stage_code];
        // 사전은 flag-value.ts 하나뿐이다.
        const required = normalizeSplFlagValue(c?.fv) === SPL_FLAG_REQUIRED;
        // Ready = actual_start (spl_eval_as_of · spl_assert_row_rules 와 같은 칸)
        const ready = required && !!c?.as;
        return { stage: s, required, ready, receivedAt: c?.as ?? null, value: c?.fv ?? null };
      });
  }, [catalog, row]);

  const requiredCount = entries.filter((e) => e.required).length;
  const readyCount = entries.filter((e) => e.ready).length;
  const allDone = requiredCount > 0 && readyCount === requiredCount;
  const addable = entries.filter((e) => !e.required);

  async function toggle(stageCode: string, required: boolean) {
    setBusy(stageCode);
    try {
      await setFlag({ data: { item_id: row.id, stage_code: stageCode, required } });
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleReady(stageCode: string, ready: boolean) {
    setBusy(stageCode);
    try {
      await setReady({ data: { item_id: row.id, stage_code: stageCode, ready } });
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5">
      <div className="mb-1 flex items-center gap-2">
        <div className="text-[11px] font-medium">Required Documents</div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {readyCount}/{requiredCount}
        </span>
        <Badge variant={allDone ? "default" : "outline"} className="text-[10px]">
          {allDone ? "Completed" : "In progress"}
        </Badge>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!canEdit || addable.length === 0}>
                <Plus className="mr-1 h-3 w-3" /> New Document
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {addable.map((e) => (
                <DropdownMenuItem
                  key={e.stage.stage_code}
                  className="text-xs"
                  onSelect={() => void toggle(e.stage.stage_code, true)}
                >
                  {e.stage.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <table className="w-full border-separate border-spacing-0 text-[11px]">
        <thead>
          <tr className="bg-muted">
            <th className="border-b px-2 py-1 text-left">Document</th>
            <th className="border-b px-2 py-1 w-28">Requirement</th>
            <th className="border-b px-2 py-1 w-28">Received</th>
            <th className="border-b px-2 py-1 w-24">받은 날</th>
            <th className="border-b px-2 py-1 w-40"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.stage.stage_code} className={cn(!e.required && "text-muted-foreground")}>
              <td className="border-b px-2 py-1">
                {e.stage.label}
                <span className="ml-1 font-mono text-[9px] text-muted-foreground">{e.stage.short_code}</span>
              </td>
              <td className="border-b px-2 py-1 text-center">
                {e.required ? (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <Check className="h-3 w-3" /> Required
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Minus className="h-3 w-3" /> Not required
                  </Badge>
                )}
              </td>
              <td className="border-b px-2 py-1 text-center">
                {!e.required ? (
                  <span>—</span>
                ) : e.ready ? (
                  <Badge className="gap-1 text-[10px]">
                    <Check className="h-3 w-3" /> Received
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <CircleDashed className="h-3 w-3" /> Not received
                  </Badge>
                )}
              </td>
              <td className="border-b px-2 py-1 text-center tabular-nums">
                {e.receivedAt ? formatDdMmm(e.receivedAt) : "—"}
              </td>
              <td className="border-b px-2 py-1 text-center">
                {busy === e.stage.stage_code ? (
                  <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                ) : (
                  canEdit && (
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => void toggle(e.stage.stage_code, !e.required)}
                      >
                        {e.required ? "Set not required" : "Set required"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        disabled={!e.required}
                        onClick={() => void toggleReady(e.stage.stage_code, !e.ready)}
                      >
                        {e.ready ? "Undo received" : "Mark received"}
                      </Button>
                    </div>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}