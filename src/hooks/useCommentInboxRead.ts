import { useCallback, useEffect, useState } from "react";

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
    },
    [userId],
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
    },
    [userId],
  );

  return { isRead, markRead, markManyRead };
}