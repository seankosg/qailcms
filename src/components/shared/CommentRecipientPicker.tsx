import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Search, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PicOption {
  name: string;
  team: string;
}

const collator = new Intl.Collator("ko");

export function useHdecPicOptions() {
  return useQuery({
    queryKey: ["hdec-pic-recipient-options"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PicOption[]> => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("name,team,user_type,is_active")
        .eq("user_type", "hdec_pic")
        .eq("is_active", true);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((p) => !!p.name)
        .map((p) => ({ name: String(p.name), team: String(p.team ?? "미지정") }))
        .sort((a, b) => collator.compare(a.team, b.team) || collator.compare(a.name, b.name));
    },
  });
}

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** 해제 불가(항상 포함) 수신자 — 해당 항목의 HDEC PIC */
  locked?: string[];
  /** 사용자가 '확인'을 눌러 수신자를 확정했는지 */
  confirmed?: boolean;
  onConfirm?: () => void;
}

export function CommentRecipientPicker({ value, onChange, disabled, locked = [], confirmed, onConfirm }: Props) {
  const { data: options = [], isLoading } = useHdecPicOptions();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<string[]>(Array.from(new Set([...locked, ...value])));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (open) {
      setDraft(Array.from(new Set([...locked, ...value])));
      setQ("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map<string, string[]>();
    for (const o of options) {
      if (needle && !o.name.toLowerCase().includes(needle)) continue;
      const arr = m.get(o.team) ?? [];
      arr.push(o.name);
      m.set(o.team, arr);
    }
    return Array.from(m.entries())
      .sort((a, b) => collator.compare(a[0], b[0]))
      .map(([team, names]) => [team, names.sort(collator.compare)] as const);
  }, [options, q]);

  const toggle = (name: string) => {
    if (locked.includes(name)) return;
    setDraft((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const toggleTeam = (names: string[], allOn: boolean) =>
    setDraft((prev) =>
      allOn
        ? prev.filter((n) => !names.includes(n) || locked.includes(n))
        : Array.from(new Set([...prev, ...names])),
    );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={confirmed ? "outline" : "default"}
              size="sm"
              className="h-7 text-[11px]"
              disabled={disabled}
            >
              <Users className="mr-1 h-3 w-3" />
              수신자 {confirmed ? `${value.length}명 확정` : "선택 필요"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[300px] p-0">
            <div className="border-b p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="이름 검색"
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>
            <ScrollArea className="h-64">
              <div className="p-1.5 space-y-1">
                {isLoading && <p className="p-2 text-xs text-muted-foreground">불러오는 중…</p>}
                {!isLoading && groups.length === 0 && (
                  <p className="p-2 text-xs text-muted-foreground">일치하는 담당자가 없습니다</p>
                )}
                {groups.map(([team, names]) => {
                  const allOn = names.every((n) => draft.includes(n));
                  const isOpen = !collapsed[team];
                  return (
                    <Collapsible
                      key={team}
                      open={isOpen}
                      onOpenChange={(o) => setCollapsed((p) => ({ ...p, [team]: !o }))}
                    >
                      <div className="flex items-center gap-1.5 rounded bg-muted/50 px-1.5 py-1">
                        <Checkbox
                          checked={allOn}
                          onCheckedChange={() => toggleTeam(names, allOn)}
                          aria-label={`${team} 전체 선택`}
                        />
                        <CollapsibleTrigger className="flex flex-1 items-center gap-1 text-left text-[11px] font-medium">
                          <ChevronDown className={cn("h-3 w-3 transition-transform", !isOpen && "-rotate-90")} />
                          {team}
                          <span className="ml-auto text-[10px] text-muted-foreground">{names.length}</span>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent>
                        <div className="mt-0.5 space-y-0.5 pl-2">
                          {names.map((n) => (
                            <label
                              key={n}
                              className={cn(
                                "flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/60",
                                locked.includes(n) ? "cursor-not-allowed opacity-90" : "cursor-pointer",
                              )}
                            >
                              <Checkbox
                                checked={draft.includes(n)}
                                disabled={locked.includes(n)}
                                onCheckedChange={() => toggle(n)}
                              />
                              <span>{n}</span>
                              {locked.includes(n) && (
                                <span className="ml-auto text-[10px] text-muted-foreground">HDEC PIC</span>
                              )}
                            </label>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </ScrollArea>
            <div className="flex items-center gap-2 border-t p-2">
              <span className="text-[11px] text-muted-foreground">{draft.length}명 선택</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-[11px]"
                onClick={() => setDraft([...locked])}
              >
                초기화
              </Button>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => {
                  onChange(Array.from(new Set([...locked, ...draft])));
                  onConfirm?.();
                  setOpen(false);
                }}
              >
                확인
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {value.map((n) => (
          <Badge key={n} variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
            {n}
            {!locked.includes(n) && (
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== n))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`${n} 제거`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {!confirmed && (
        <p className="text-[11px] text-muted-foreground">수신자를 선택하고 확인을 눌러야 댓글을 보낼 수 있습니다.</p>
      )}
    </div>
  );
}
