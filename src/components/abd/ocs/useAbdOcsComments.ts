import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getAbdOcsComments,
  setAbdOcsComplied,
  type AbdOcsPanelData,
} from "@/lib/abd/ocs.functions";

export const abdOcsQueryKey = (itemId: string) => ["abd-ocs-comments", itemId] as const;

export function useAbdOcsComments(itemId: string | null, enabled: boolean) {
  const fetchFn = useServerFn(getAbdOcsComments);
  return useQuery({
    queryKey: abdOcsQueryKey(itemId ?? "none"),
    queryFn: async () => (await fetchFn({ data: { itemId: itemId as string } })) as AbdOcsPanelData,
    enabled: !!itemId && enabled,
    staleTime: 30_000,
  });
}

export function useSetAbdOcsComplied(itemId: string | null) {
  const qc = useQueryClient();
  const mutateFn = useServerFn(setAbdOcsComplied);
  const key = abdOcsQueryKey(itemId ?? "none");

  return useMutation({
    mutationFn: async (vars: { commentId: string; expected: boolean; complied: boolean }) =>
      await mutateFn({ data: vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AbdOcsPanelData>(key);
      if (prev) {
        const comments = prev.comments.map((c) =>
          c.id === vars.commentId ? { ...c, complied: vars.complied } : c,
        );
        const complied = comments.filter((c) => c.complied).length;
        qc.setQueryData<AbdOcsPanelData>(key, {
          ...prev,
          comments,
          complied,
          pending: prev.total - complied,
        });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("OCS_COMPLIANCE_STALE")) {
        void qc.invalidateQueries({ queryKey: key });
        toast.error("Another user updated this comment. The latest data has been loaded.");
      } else if (msg.includes("OCS_FORBIDDEN_WRITE")) {
        toast.error("You do not have permission to update this drawing.");
      } else {
        toast.error(`Update failed: ${msg}`);
      }
    },
    onSuccess: (res) => {
      const prev = qc.getQueryData<AbdOcsPanelData>(key);
      if (prev && res) {
        qc.setQueryData<AbdOcsPanelData>(key, {
          ...prev,
          total: res.total,
          complied: res.complied_count,
          pending: res.pending,
          comments: prev.comments.map((c) =>
            c.id === res.comment_id
              ? {
                  ...c,
                  complied: res.complied,
                  compliance_source: "user",
                  complied_by_name: res.complied_by_name,
                  complied_at: res.complied_at,
                }
              : c,
          ),
        });
      }
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}