import { CalendarDays, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface DataDatePickerProps {
  value: string;
  latest: string;
  options: string[];
  onChange: (v: string) => void;
  onReset: () => void;
  className?: string;
}

/** Dashboard와 동일한 UI의 Data Date 선택기.
 *  value: 실제 표시 중인 값 (선택값 없으면 latest).
 *  latest: rows에서 계산한 최신 data_date (기본값 표시용).
 *  options: 선택 가능한 data_date 목록 (최신순).
 */
export function DataDatePicker({
  value,
  latest,
  options,
  onChange,
  onReset,
  className,
}: DataDatePickerProps) {
  const list = options.length ? options : latest ? [latest] : [];
  return (
    <div className={"flex flex-wrap items-center gap-2 " + (className ?? "")}>
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarDays className="h-3 w-3" />
        Data Date
      </span>
      <Select value={value || latest} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="h-7 w-[160px] text-xs">
          <SelectValue placeholder={latest} />
        </SelectTrigger>
        <SelectContent>
          {list.map((d) => (
            <SelectItem key={d} value={d} className="text-xs">
              {d}
              {d === latest && (
                <span className="ml-1 text-[10px] text-muted-foreground">(최신)</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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