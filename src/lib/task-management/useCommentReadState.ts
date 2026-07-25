import { useCallback, useEffect, useState } from "react";

type ReadMap = Record<string, string>;

function storageKey(userId: string | null | undefined) {
  return `qail.tm.comments-read::${userId ?? "anon"}`;
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
    // ignore quota errors
  }
}

/**
 * 사용자별 TM 댓글 읽음 상태를 localStorage에 저장한다.
 * key = qail.tm.comments-read::<userId>, value = { [taskRawId]: lastReadAtISO }.
 */
export function useCommentReadState(userId: string | null | undefined) {
  const [map, setMap] = useState<ReadMap>(() => load(userId));

  useEffect(() => {
    setMap(load(userId));
  }, [userId]);

  const isRead = useCallback(
    (taskRawId: string, lastUpdatedAt: string | null | undefined) => {
      if (!lastUpdatedAt) return true;
      const seen = map[taskRawId];
      if (!seen) return false;
      return seen >= lastUpdatedAt;
    },
    [map],
  );

  const markRead = useCallback(
    (taskRawId: string, lastUpdatedAt: string | null | undefined) => {
      if (!taskRawId || !lastUpdatedAt) return;
      setMap((prev) => {
        if (prev[taskRawId] && prev[taskRawId] >= lastUpdatedAt) return prev;
        const next = { ...prev, [taskRawId]: lastUpdatedAt };
        save(userId, next);
        return next;
      });
    },
    [userId],
  );

  return { isRead, markRead };
}