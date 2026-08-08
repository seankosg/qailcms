import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const SCOPE = "inbox";

type ReadMap = Record<string, string>; // commentId -> readAtISO

function storageKey(userId: string | null | undefined) {
  return `qail.mws.comments-read::${userId ?? "anon"}`;
}

function load(userId: string | null | undefined): ReadMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as ReadMap) : {};
  } catch {
    return {};
  }
}

function save(userId: string | null | undefined, map: ReadMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * MWS 댓글 인박스용 사용자별 읽음 상태.
 * key = qail.mws.comments-read::<userId>, value = { [commentId]: updatedAtISO }.
 */
export function useCommentInboxRead(userId: string | null | undefined) {
  const [map, setMap] = useState<ReadMap>(() => load(userId));

  useEffect(() => {
    setMap(load(userId));
  }, [userId]);

  // 서버 읽음 상태 병합(로컬 우선 렌더 → 응답 시 키별 최신 시각 채택)
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("comment_read_state")
        .select("key,last_read_at")
        .eq("scope", SCOPE);
      if (cancelled || error || !data) {
        if (error) console.warn("comment_read_state load failed", error.message);
        return;
      }
      setMap((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const r of data) {
          const k = r.key as string;
          const at = r.last_read_at as string;
          if (!next[k] || next[k] < at) {
            next[k] = at;
            changed = true;
          }
        }
        if (!changed) return prev;
        save(userId, next);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const pushServer = useCallback(
    (rows: Array<{ key: string; last_read_at: string }>) => {
      if (!userId || rows.length === 0) return;
      void supabase
        .from("comment_read_state")
        .upsert(
          rows.map((r) => ({ scope: SCOPE, key: r.key, last_read_at: r.last_read_at })),
          { onConflict: "user_id,scope,key" },
        )
        .then(({ error }) => {
          if (error) console.warn("comment_read_state upsert failed", error.message);
        });
    },
    [userId],
  );

  const isRead = useCallback(
    (commentId: string, updatedAt: string | null | undefined) => {
      if (!commentId || !updatedAt) return true;
      const seen = map[commentId];
      return !!seen && seen >= updatedAt;
    },
    [map],
  );

  const markRead = useCallback(
    (commentId: string, updatedAt: string | null | undefined) => {
      if (!commentId || !updatedAt) return;
      setMap((prev) => {
        if (prev[commentId] && prev[commentId] >= updatedAt) return prev;
        const next = { ...prev, [commentId]: updatedAt };
        save(userId, next);
        return next;
      });
      pushServer([{ key: commentId, last_read_at: updatedAt }]);
    },
    [userId, pushServer],
  );

  const markManyRead = useCallback(
    (items: Array<{ id: string; updated_at: string | null }>) => {
      if (items.length === 0) return;
      setMap((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const it of items) {
          if (!it.id || !it.updated_at) continue;
          if (!next[it.id] || next[it.id] < it.updated_at) {
            next[it.id] = it.updated_at;
            changed = true;
          }
        }
        if (!changed) return prev;
        save(userId, next);
        return next;
      });
      pushServer(
        items
          .filter((it) => it.id && it.updated_at)
          .map((it) => ({ key: it.id, last_read_at: it.updated_at as string })),
      );
    },
    [userId, pushServer],
  );

  return { isRead, markRead, markManyRead };
}