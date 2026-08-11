import { cn } from "@/lib/utils";

/** SPL 공용 KPI 카드 — Dashboard 와 드릴다운에서 동일 UI 사용 */
export function SplKpiCard({
  label,
  value,
  note,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  note?: string;
  active?: boolean;
  onClick?: () => void;
  tone?: "warn" | "bad";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-2 text-left transition hover:border-primary/60",
        active && "border-primary ring-1 ring-primary/30",
      )}
    >
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "bad" && "text-red-600",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value.toLocaleString()}
      </div>
      {note && <div className="text-[10px] text-muted-foreground">{note}</div>}
    </button>
  );
}