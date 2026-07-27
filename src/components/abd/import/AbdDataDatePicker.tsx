import { useMemo } from "react";
import { CalendarIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { todayInDoha } from "@/lib/time/doha";

/**
 * ABD 임포트용 Data Date 선택기.
 * - 기본값(비지정): 오늘(Doha).
 * - 미래 날짜 선택 불가.
 * - 값은 YYYY-MM-DD 문자열. `null`이면 기본값(오늘) 사용.
 */
export function AbdDataDatePicker({
  value,
  onChange,
  disabled,
  size = "sm",
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  size?: "sm" | "xs";
}) {
  const today = todayInDoha();
  const effective = value || today;
  const isDefault = !value || value === today;

  // "YYYY-MM-DD" → Date (로컬 자정, TZ 계산 없이 순수 숫자 파싱)
  const selectedDate = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(effective);
    if (!m) return undefined;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }, [effective]);

  const todayDate = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)!;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }, [today]);

  const h = size === "xs" ? "h-6" : "h-7";
  const text = size === "xs" ? "text-[11px]" : "text-xs";

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(h, "gap-1 px-2", text, isDefault && "text-muted-foreground")}
            disabled={disabled}
            title="Data Date (Doha 기준, 오늘 이후 불가)"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            <span>Data Date: {effective}</span>
            {isDefault && <span className="text-[10px] opacity-70">(오늘)</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(d) => {
              if (!d) return;
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const dd = String(d.getDate()).padStart(2, "0");
              const s = `${yyyy}-${mm}-${dd}`;
              onChange(s === today ? null : s);
            }}
            disabled={{ after: todayDate }}
            defaultMonth={selectedDate ?? todayDate}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      {!isDefault && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(h, "w-6")}
          disabled={disabled}
          onClick={() => onChange(null)}
          title="오늘(Doha)로 초기화"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}