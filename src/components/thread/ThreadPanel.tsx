/**
 * 지시–이행 루프 패널 — OCS 와 같은 Sheet. 모듈 범용(module 컬럼 기준).
 * 상태·경과일은 서버 파생값(derived_status / derived_age_days)을 그대로 쓴다. 재계산 금지.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff, Loader2, PanelLeft, PanelRight, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDdMmmYyyy } from "@/lib/time/doha";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  THREAD_KIND_LABEL, THREAD_STATUS_BADGE, THREAD_STATUS_LABEL, threadAgeClass,
} from "@/lib/thread/vocab";
import {
  useThreadAssignees, useThreadMutations, useThreadRows,
  type ThreadKind, type ThreadMessage,
} from "@/lib/thread/useThread";
import { ThreadRecipientPicker } from "./ThreadRecipientPicker";

export interface ThreadStageOption { code: string; label: string }

const AUTHOR_KINDS: ThreadKind[] = ["report", "question", "instruction", "decision"];

export function ThreadPanel({
  module, itemId, itemLabel, stages, open, onOpenChange,
  side = "right", dual = false, onToggleCounterpart, initialStage = null, asOf = null,
}: {
  module: string;
  itemId: string;
  itemLabel: string;
  stages: ThreadStageOption[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  side?: "left" | "right";
  dual?: boolean;
  onToggleCounterpart?: () => void;
  initialStage?: string | null;
  asOf?: string | null;
}) {
  const me = useCurrentUser().data;
  const { data, isLoading } = useThreadRows(module, open ? itemId : null, asOf);
  const [filterStage, setFilterStage] = useState<string>(initialStage ?? "ALL");
  const [composeStage, setComposeStage] = useState<string>(initialStage ?? stages[0]?.code ?? "");
  const [kind, setKind] = useState<ThreadKind>("report");
  const [body, setBody] = useState("");
  const [toUser, setToUser] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const { data: assignees } = useThreadAssignees(module, open ? itemId : null, composeStage || null);
  const { post, setWatch } = useThreadMutations(module, itemId);

  const isPic = !!me && (me.id === assignees?.pic || me.isStrictAdmin);
  const defaultTo = assignees?.eng ?? null;
  const effectiveTo = toUser ?? defaultTo;

  const messages = useMemo(() => {
    const all = data?.messages ?? [];
    return filterStage === "ALL" ? all : all.filter((m) => m.stage_code === filterStage);
  }, [data, filterStage]);

  const responsesOf = useMemo(() => {
    const map = new Map<string, ThreadMessage[]>();
    for (const m of data?.messages ?? []) {
      if (m.kind === "response" && m.reply_to_id) {
        map.set(m.reply_to_id, [...(map.get(m.reply_to_id) ?? []), m]);
      }
    }
    return map;
  }, [data]);

  const send = async () => {
    if (!body.trim()) { toast.error("내용을 입력하십시오."); return; }
    if (kind === "instruction" && !effectiveTo) { toast.error("받는 사람을 고르십시오."); return; }
    try {
      await post.mutateAsync({
        stageCode: composeStage, kind, body: body.trim(),
        toUserId: kind === "instruction" ? effectiveTo : null,
      });
      setBody(""); setToUser(null);
      toast.success(`${THREAD_KIND_LABEL[kind]}을(를) 남겼습니다.`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const respond = async (instr: ThreadMessage, compliance: "yes" | "no" | "wip") => {
    const r = (reason[instr.id] ?? "").trim();
    if (compliance !== "yes" && !r) { toast.error("사유를 입력하십시오."); return; }
    try {
      await post.mutateAsync({
        stageCode: instr.stage_code, kind: "response",
        body: r || THREAD_STATUS_LABEL[compliance],
        replyToId: instr.id, compliance, reasonText: r || null,
      });
      setReason((p) => ({ ...p, [instr.id]: "" }));
    } catch (e) { toast.error((e as Error).message); }
  };

  const stageLabel = (code: string) => stages.find((s) => s.code === code)?.label ?? code;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={!dual}>
      <SheetContent
        side={side}
        hideOverlay={dual}
        onInteractOutside={dual ? (e) => e.preventDefault() : undefined}
        className="flex w-full flex-col gap-2 sm:max-w-2xl"
      >
        <SheetHeader className="space-y-1">
          <div className="flex items-start justify-between gap-2 pr-8">
            <SheetTitle className="text-sm">
              Thread — <span className="font-mono">{itemLabel}</span>
            </SheetTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 text-[11px]"
              disabled={!composeStage || setWatch.isPending}
              onClick={() => setWatch.mutate({ stageCode: composeStage, on: !(data?.watched ?? false) })}
            >
              {data?.watched ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              주시
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterStage} onValueChange={setFilterStage}>
              <SelectTrigger className="h-7 w-56 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                {stages.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-[10px]">
              {data?.total ?? 0}건 · 응답 대기 {data?.open_instructions ?? 0}
            </Badge>
            {onToggleCounterpart && (
              <Button variant="secondary" size="sm" className="ml-auto h-7 gap-1 text-[11px]" onClick={onToggleCounterpart}>
                {side === "right" ? <PanelLeft className="h-3.5 w-3.5" /> : <PanelRight className="h-3.5 w-3.5" />}
                함께 보기
              </Button>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 pr-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : messages.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">기록이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {messages.filter((m) => m.kind !== "response").map((m) => {
                const status = m.derived_status;
                const resp = responsesOf.get(m.id) ?? [];
                const canRespond = !!me && (me.id === m.to_user_id || me.isStrictAdmin);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "rounded-md border p-2 text-xs",
                      m.kind === "instruction" && "border-l-4 border-l-[color:var(--info)]",
                      m.kind === "decision" &&
                        "border-l-4 border-l-[color:var(--primary)] bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]",
                      m.kind === "question" && "opacity-80",
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{THREAD_KIND_LABEL[m.kind]}</Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {stageLabel(m.stage_code)} · {m.author_role} · {formatDdMmmYyyy(m.created_at) || m.created_at.slice(0, 10)}
                      </span>
                      {m.kind === "instruction" && status && (
                        <>
                          <Badge variant="outline" className={cn("text-[10px]", THREAD_STATUS_BADGE[status])}>
                            {THREAD_STATUS_LABEL[status]}
                          </Badge>
                          <span className={cn("text-[10px]", threadAgeClass(m.derived_age_days))}>
                            경과 {m.derived_age_days ?? 0}일
                          </span>
                        </>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap">{m.body}</p>

                    {m.kind === "instruction" && (
                      <div className="mt-2 space-y-1.5">
                        {resp.length > 0 && (
                          <div className="space-y-1 rounded bg-muted/60 p-1.5">
                            {resp.map((r) => (
                              <div key={r.id} className="text-[11px]">
                                <Badge variant="outline" className={cn("mr-1 text-[10px]", THREAD_STATUS_BADGE[r.compliance ?? "pending"])}>
                                  {THREAD_STATUS_LABEL[r.compliance ?? "pending"]}
                                </Badge>
                                <span className="text-muted-foreground">
                                  {formatDdMmmYyyy(r.created_at) || r.created_at.slice(0, 10)}
                                </span>
                                {r.reason_text && <div className="mt-0.5 whitespace-pre-wrap">{r.reason_text}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                        {canRespond && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Input
                              value={reason[m.id] ?? ""}
                              onChange={(e) => setReason((p) => ({ ...p, [m.id]: e.target.value }))}
                              placeholder="사유 (미이행 · 진행중은 필수)"
                              className="h-7 flex-1 text-[11px]"
                            />
                            {(["yes", "no", "wip"] as const).map((c) => (
                              <Button
                                key={c}
                                size="sm"
                                variant="outline"
                                className={cn("h-7 text-[11px]", THREAD_STATUS_BADGE[c])}
                                disabled={post.isPending}
                                onClick={() => respond(m, c)}
                              >
                                {THREAD_STATUS_LABEL[c]}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* 발신 — 화면 게이트는 편의일 뿐, 서버가 진짜 관문이다 */}
        <div className="space-y-1.5 border-t pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {AUTHOR_KINDS.map((k) => {
              const locked = (k === "instruction" || k === "decision") && !isPic;
              return (
                <Button
                  key={k}
                  size="sm"
                  variant={kind === k ? "default" : "outline"}
                  disabled={locked}
                  className="h-7 text-[11px]"
                  onClick={() => setKind(k)}
                  title={locked ? "지시는 이 단계의 PIC 만 작성할 수 있습니다" : undefined}
                >
                  {THREAD_KIND_LABEL[k]}
                </Button>
              );
            })}
            <Select value={composeStage} onValueChange={setComposeStage}>
              <SelectTrigger className="ml-auto h-7 w-48 text-[11px]"><SelectValue placeholder="단계" /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind === "instruction" && (
            <ThreadRecipientPicker
              value={effectiveTo}
              onChange={setToUser}
              defaultFromAssignee={defaultTo}
              disabled={post.isPending}
            />
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="내용"
            className="min-h-16 text-xs"
          />
          <div className="flex justify-end">
            <Button size="sm" className="h-7 gap-1 text-[11px]" disabled={post.isPending || !composeStage} onClick={send}>
              <Send className="h-3.5 w-3.5" /> 보내기
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
