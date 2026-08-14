/**
 * 지시–이행 루프 데이터 접근 — 화면은 `thread_rows_as_of` 하나만 부른다.
 * 원시 표(module_thread_*) 직조회 금지.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ThreadKind = "report" | "question" | "instruction" | "decision" | "response";

export interface ThreadMessage {
  id: string;
  thread_id: string;
  stage_code: string;
  kind: ThreadKind;
  body: string;
  author_user_id: string;
  author_role: "PIC" | "ENG" | "ADMIN";
  to_user_id: string | null;
  reply_to_id: string | null;
  compliance: "yes" | "no" | "wip" | null;
  reason_text: string | null;
  created_at: string;
  derived_status: "pending" | "yes" | "no" | "wip" | null;
  derived_age_days: number | null;
}

export interface ThreadPayload {
  as_of: string;
  messages: ThreadMessage[];
  stage_counts: Record<string, { total: number; open_instructions: number }>;
  total: number;
  open_instructions: number;
  latest_decision: ThreadMessage | null;
  watched: boolean;
}

export interface ThreadUserOption { id: string; name: string; team: string }

export function useThreadRows(module: string, itemId: string | null, asOf?: string | null) {
  return useQuery({
    queryKey: ["thread-rows", module, itemId, asOf ?? null],
    enabled: !!itemId,
    queryFn: async (): Promise<ThreadPayload> => {
      const { data, error } = await (supabase as any).rpc("thread_rows_as_of", {
        _module: module, _item_id: itemId, _as_of: asOf ?? null,
      });
      if (error) throw new Error(error.message);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("스레드 응답 형식 오류");
      }
      return data as ThreadPayload;
    },
  });
}

export function useThreadAssignees(module: string, itemId: string | null, stageCode: string | null) {
  return useQuery({
    queryKey: ["thread-assignees", module, itemId, stageCode],
    enabled: !!itemId && !!stageCode,
    queryFn: async (): Promise<{ pic: string | null; eng: string | null }> => {
      const call = async (role: "pic" | "eng") => {
        const { data, error } = await (supabase as any).rpc("thread_assignee_of", {
          _module: module, _item_id: itemId, _stage_code: stageCode, _role: role,
        });
        if (error) throw new Error(error.message);
        return (data as string | null) ?? null;
      };
      const [pic, eng] = await Promise.all([call("pic"), call("eng")]);
      return { pic, eng };
    },
  });
}

export function useThreadUserOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["thread-user-options"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ThreadUserOption[]> => {
      const { data, error } = await (supabase as any).rpc("thread_user_options");
      if (error) throw new Error(error.message);
      return (data ?? []) as ThreadUserOption[];
    },
  });
}

export function useThreadMutations(module: string, itemId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["thread-rows", module, itemId] });

  const post = useMutation({
    mutationFn: async (p: {
      stageCode: string; kind: ThreadKind; body: string;
      toUserId?: string | null; replyToId?: string | null;
      compliance?: "yes" | "no" | "wip" | null; reasonText?: string | null;
    }) => {
      const { data, error } = await (supabase as any).rpc("thread_post_message", {
        _module: module, _item_id: itemId, _stage_code: p.stageCode,
        _kind: p.kind, _body: p.body,
        _to_user_id: p.toUserId ?? null, _reply_to_id: p.replyToId ?? null,
        _compliance: p.compliance ?? null, _reason_text: p.reasonText ?? null,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidate,
  });

  const setWatch = useMutation({
    mutationFn: async (p: { stageCode: string; on: boolean }) => {
      const { error } = await (supabase as any).rpc("thread_set_watch", {
        _module: module, _item_id: itemId, _stage_code: p.stageCode, _on: p.on,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  return { post, setWatch };
}
