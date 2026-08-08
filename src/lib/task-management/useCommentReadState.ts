import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const SCOPE = "tm";

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
      if (userId) {
        void supabase
          .from("comment_read_state")
          .upsert(
            [{ scope: SCOPE, key: taskRawId, last_read_at: lastUpdatedAt }],
            { onConflict: "user_id,scope,key" },
          )
          .then(({ error }) => {
            if (error) console.warn("comment_read_state upsert failed", error.message);
          });
      }
    },
    [userId],
  );

  return { isRead, markRead };
}