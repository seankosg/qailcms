import { useMemo, useState } from "react";
import { CalendarDays, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDdMmmYyyy } from "@/lib/time/doha";

export interface DataDatePickerProps {
  value: string;
  latest: string;
  options: string[];
  onChange: (v: string) => void;
  onReset: () => void;
  className?: string;
}

/** Data Date 캘린더 선택기.
 *  options 에 포함된 날짜만 선택 가능(그 외 날짜는 disabled 처리).
 *  value: 실제 표시 중인 값. 비어있으면 latest 사용.
 *  latest: rows 최신 data_date.
 *  options: 선택 가능한 data_date 목록 (YYYY-MM-DD).
 */
export function DataDatePicker({
  value,
  latest,
  options,
  onChange,
  onReset,
  className,
}: DataDatePickerProps) {
  const [open, setOpen] = useState(false);
  const active = value || latest || "";

  // 선택 가능한 날짜 집합(YYYY-MM-DD) + Date 범위 산출
  const { allowed, minDate, maxDate, selectedDate, defaultMonth } = useMemo(() => {
    const allowed = new Set<string>();
    for (const s of options ?? []) {
      if (typeof s === "string" && s.length >= 10) allowed.add(s.slice(0, 10));
    }
    if (latest) allowed.add(latest.slice(0, 10));
    const sorted = Array.from(allowed).sort();
    const toDate = (s: string): Date => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, (m ?? 1) - 1, d ?? 1);
    };
    const selectedDate = active ? toDate(active.slice(0, 10)) : undefined;
    return {
      allowed,
      minDate: sorted.length ? toDate(sorted[0]) : undefined,
      maxDate: sorted.length ? toDate(sorted[sorted.length - 1]) : undefined,
      selectedDate,
      defaultMonth: selectedDate ?? (sorted.length ? toDate(sorted[sorted.length - 1]) : undefined),
    };
  }, [options, latest, active]);

  const toKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  return (
    <div className={"flex flex-wrap items-center gap-2 " + (className ?? "")}>
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarDays className="h-3 w-3" />
        Data Date
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-7 w-[170px] justify-start px-2 text-xs font-normal",
              !active && "text-muted-foreground",
            )}
          >
            <CalendarDays className="mr-1 h-3 w-3" />
            <span className="truncate">
              {formatDdMmmYyyy(active) || "날짜 선택"}
            </span>
            {active && active === latest && (
              <span className="ml-auto text-[10px] text-muted-foreground">최신</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={defaultMonth}
            fromDate={minDate}
            toDate={maxDate}
            disabled={(date) => !allowed.has(toKey(date))}
            onSelect={(d) => {
              if (!d) return;
              const key = toKey(d);
              if (!allowed.has(key)) return;
              onChange(key);
              setOpen(false);
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      {value && value !== latest && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={onReset}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          최신
        </Button>
      )}
    </div>
  );
}