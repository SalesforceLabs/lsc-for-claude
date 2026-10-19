import React, { useCallback, useEffect, useRef, useState } from "react";
import { UserRoundSearch } from "lucide-react";
import SearchPicker, { type PickerOption } from "../ui/SearchPicker";

interface PerfUser {
  id: string;
  username: string;
  name: string;
  profile: string;
  territories: number;
  syncs?: number;
}

const SEARCH_DEBOUNCE_MS = 300;
const WINDOW_DAYS = 30;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "Look up a rep…": a search over the org's active users (heaviest first until you type), picking one by id. */
export default function RepLookup({ onPick, onCancel }: { onPick: (userId: string) => void; onCancel: () => void }) {
  const [users, setUsers] = useState<PerfUser[]>([]);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState<string | undefined>();
  // Only the newest search may fill the list.
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = useCallback(async (q: string) => {
    const request = ++latest.current;
    setSearching(true);
    try {
      const res = await window.lscApi.studioPerfUsers(q.trim() || undefined, undefined, WINDOW_DAYS);
      if (request !== latest.current) return;
      const failure = res.error || (res.data as { error?: string } | undefined)?.error;
      setError(failure);
      setUsers(failure ? [] : ((res.data as PerfUser[]) ?? []));
    } catch (e) {
      if (request === latest.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === latest.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    void search("");
    return () => {
      latest.current++;
      clearTimeout(timer.current);
    };
  }, [search]);

  const options: PickerOption[] = users.map((u) => ({
    value: u.id,
    label: u.name,
    detail: [u.username, u.profile, plural(u.territories, "territory", "territories"), u.syncs !== undefined ? plural(u.syncs, "sync") : null].filter(Boolean).join(" · "),
  }));

  return (
    <SearchPicker
      eyebrow="Sync health"
      title="Look up a rep"
      description="See what a rep's iPad downloads and how their syncs are going. Until you type, the reps with the most territories are listed."
      options={options}
      placeholder="Search by name or username"
      emptyTitle="No active users"
      emptyIcon={UserRoundSearch}
      searching={searching}
      error={error}
      onQueryChange={(q) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void search(q), SEARCH_DEBOUNCE_MS);
      }}
      onPick={onPick}
      onCancel={onCancel}
    />
  );
}
