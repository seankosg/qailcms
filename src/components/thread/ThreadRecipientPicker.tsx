/**
 * 지시의 「받는 사람」 선택 상자 — 활성 계정 목록에서 고른다. 자유 입력 금지.
 * 동명이인 구분을 위해 이름과 팀을 함께 보여 준다.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useThreadUserOptions, type ThreadUserOption } from "@/lib/thread/useThread";

export function ThreadRecipientPicker({
  value,
  onChange,
  defaultFromAssignee,
  disabled,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  /** thread_assignee_of 가 준 기본 담당자 (없으면 null) */
  defaultFromAssignee: string | null;
  disabled?: boolean;
}) {
  const { data: options = [], isLoading } = useThreadUserOptions(true);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected: ThreadUserOption | undefined = useMemo(
    () => options.find((o) => o.id === value),
    [options, value],
  );
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n
      ? options.filter((o) => `${o.name} ${o.team}`.toLowerCase().includes(n))
      : options;
  }, [options, q]);

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={value ? "outline" : "default"}
            size="sm"
            disabled={disabled}
            className="h-7 w-full justify-start gap-1 text-[11px]"
          >
            <UserCheck className="h-3 w-3" />
            {selected
              ? `${selected.name} · ${selected.team}`
              : "받는 사람 고르기"}
            {value && value === defaultFromAssignee && (
              <span className="ml-auto text-[10px] text-muted-foreground">담당자</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[280px] p-0">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름 · 팀 검색"
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>
          <ScrollArea className="h-64">
            <div className="p-1">
              {isLoading && <p className="p-2 text-xs text-muted-foreground">불러오는 중…</p>}
              {!isLoading && list.length === 0 && (
                <p className="p-2 text-xs text-muted-foreground">일치하는 계정이 없습니다</p>
              )}
              {list.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted/60",
                    o.id === value && "bg-muted",
                  )}
                >
                  <span>{o.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{o.team}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
      {!defaultFromAssignee && (
        <p className="text-[11px] text-muted-foreground">
          담당자가 계정에 연결되어 있지 않습니다. 받는 사람을 고르십시오.
        </p>
      )}
    </div>
  );
}
