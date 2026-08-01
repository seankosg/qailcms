import { useMemo } from "react";
import { CalendarIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { todayInDoha } from "@/lib/time/doha";

/**
 * ABD 임포트용 Data Date 선택기.
 * - 우선순위: 파일명에서 추출한 날짜(fileDate) > 오늘(Doha).
 * - 미래 날짜 선택 불가.
 * - 값은 YYYY-MM-DD 문자열. `null`이면 기본값(fileDate ?? 오늘) 사용.
 */
export function AbdDataDatePicker({
  value,
  onChange,
  disabled,
  size = "sm",
  fileDate,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  size?: "sm" | "xs";
  /** 파일명에서 추출된 날짜 (YYYY-MM-DD). 있으면 기본값으로 사용. */
  fileDate?: string | null;
}) {
  const today = todayInDoha();
  const fallback = fileDate || today;
  const effective = value || fallback;
  const isDefault = !value || value === fallback;
  const fromFile = !!fileDate && effective === fileDate;

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
            title={
              fromFile
                ? "Data Date — 파일명에서 자동 추출 (오늘 이후 불가)"
                : "Data Date (Doha 기준, 오늘 이후 불가)"
            }
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            <span>Data Date: {effective}</span>
            <span className="text-[10px] opacity-70">
              {fromFile ? "(파일명)" : effective === today ? "(오늘)" : ""}
            </span>
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
              onChange(s === fallback ? null : s);
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
          title={fileDate ? "파일명 기준 날짜로 초기화" : "오늘(Doha)로 초기화"}
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}