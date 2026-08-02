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
import { formatDdMmmYyyy, todayInDoha, yesterdayInDoha } from "@/lib/time/doha";
import { asOfOffsetLabel } from "@/lib/task-management/as-of";

export interface DataDatePickerProps {
  value: string;
  latest: string;
  options: string[];
  onChange: (v: string) => void;
  onReset: () => void;
  className?: string;
  /** 읽기 전용 Data Date 칩 표시 (최신 컷오프). 미지정 시 latest 사용. 숨기려면 false. */
  showDataDateChip?: boolean;
  /** 팀별 최신 컷오프가 갈릴 때만 병기 (예: [{label:"MECH",date:"2026-07-30"}]). */
  dataDateByTeam?: { label: string; date: string }[];
  /** "asof"(기본): 기준=오늘, 리셋=오늘로. "datadate": 기준=latest, 리셋=최신으로. */
  mode?: "asof" | "datadate";
  /** TM 기준일: [어제][오늘] 퀵버튼 노출(기본값=어제). */
  quickAsOf?: boolean;
}

/** As of(판정 기준일) 캘린더 선택기.
 *  주의: 여기서 고르는 값은 판정 기준일(as_of)이며, 행별 관측 컷오프(data_date)와 다른 개념이다.
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
  showDataDateChip = false,
  dataDateByTeam,
  mode = "asof",
  quickAsOf = false,
}: DataDatePickerProps) {
  const [open, setOpen] = useState(false);
  const today = mode === "datadate" ? latest || todayInDoha() : todayInDoha();
  const yesterday = yesterdayInDoha();
  // 기준일 기본값: TM 은 어제, 그 외는 오늘. latest(data_date)로 폴백하지 않는다.
  const active = value || (quickAsOf ? yesterday : today);
  const offset = mode === "datadate" ? "" : asOfOffsetLabel(active, today);

  const teamChip =
    dataDateByTeam && dataDateByTeam.length > 1
      ? dataDateByTeam.map((t) => `${t.label} ${t.date.slice(5, 10)}`).join(" · ")
      : "";

  // 데이터 유무와 무관하게 모든 날짜 선택 허용.
  // options/latest 는 defaultMonth 힌트로만 사용.
  const { selectedDate, defaultMonth } = useMemo(() => {
    const toDate = (s: string): Date => {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, (m ?? 1) - 1, d ?? 1);
    };
    const selectedDate = active ? toDate(active.slice(0, 10)) : undefined;
    const fallback = latest ? toDate(latest.slice(0, 10)) : undefined;
    return {
      selectedDate,
      defaultMonth: selectedDate ?? fallback,
    };
  }, [latest, active]);

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
        {quickAsOf ? "기준일" : "As of"}
      </span>
      {quickAsOf && (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={active === yesterday ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => onChange(yesterday)}
          >
            어제
          </Button>
          <Button
            size="sm"
            variant={active === today ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => onChange(today)}
          >
            오늘
          </Button>
        </div>
      )}
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
            {active === today && (
              <span className="ml-auto text-[10px] text-muted-foreground">
                {mode === "datadate" ? "최신" : "오늘"}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={defaultMonth}
            onSelect={(d) => {
              if (!d) return;
              onChange(toKey(d));
              setOpen(false);
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      {offset && (
        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
          {offset}
        </span>
      )}
      {!quickAsOf && active !== today && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={onReset}
          title={mode === "datadate" ? "최신으로 리셋" : "오늘로 리셋"}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          {mode === "datadate" ? "최신" : "오늘"}
        </Button>
      )}
      {showDataDateChip && latest && (
        <span
          className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground"
          title="데이터 관측 컷오프 (읽기 전용)"
        >
          Data Date: {latest.slice(0, 10)} (최신)
          {teamChip && <span className="text-muted-foreground/80">· {teamChip}</span>}
        </span>
      )}
    </div>
  );
}