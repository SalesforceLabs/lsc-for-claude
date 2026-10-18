import { useState, useEffect, useCallback, useRef } from "react";
import type { LibraryItem, OrgScope } from "../types";

/**
 * Library items for the selected org (plus those tied to none), or for every org.
 * `orgId` is the selected org's username — undefined while it's still being worked out,
 * so the list doesn't flash another org's items first.
 */
export function useLibrary(orgId: string | undefined, scope: OrgScope) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useRef("");

  const refresh = useCallback(async () => {
    if (!window.lscApi?.listLibraryItems || orgId === undefined) return;
    setLoading(true);
    try {
      const q = query.current.trim();
      setItems(q ? await window.lscApi.searchLibraryItems(q, scope) : await window.lscApi.listLibraryItems(scope));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [orgId, scope]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveItem = useCallback(
    async (input: {
      title: string;
      content: string;
      contentType: LibraryItem["contentType"];
      svg?: string;
      sourceConversationId?: string;
      tags?: string[];
    }) => {
      if (!window.lscApi?.saveLibraryItem) return;
      const item = await window.lscApi.saveLibraryItem(input);
      setItems((prev) => [item, ...prev]);
      return item;
    },
    []
  );

  const deleteItem = useCallback(async (id: string) => {
    if (!window.lscApi?.deleteLibraryItem) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    await window.lscApi.deleteLibraryItem(id);
  }, []);

  const search = useCallback(
    async (q: string) => {
      query.current = q;
      await refresh();
    },
    [refresh]
  );

  return { items, loading, error, saveItem, deleteItem, search, refresh };
}
