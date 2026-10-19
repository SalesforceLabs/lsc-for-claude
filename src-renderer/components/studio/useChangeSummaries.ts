import { useEffect, useRef, useState } from "react";
import type { UnpublishedItem } from "./org-ahead";
import type { PublishedIpad } from "./published-types";
import type { LiveCompactLayout, LiveFlexiPage, LiveLayout, LiveListView } from "./types";
import { summarizeCompact, summarizeFlexiPage, summarizeLayout, summarizeListView } from "./org-ahead-summary";

/** One row's "what changed": being read, the lines (null: can't say), or a failed read. */
export type ChangeSummary = { status: "loading" } | { status: "ready"; lines: string[] | null } | { status: "error" };

const norm = (s: string) => s.trim().toLowerCase();
const find = <T>(map: Record<string, T> | undefined, name: string): T | undefined => {
  if (!map) return undefined;
  const key = Object.keys(map).find((k) => norm(k) === norm(name));
  return key === undefined ? undefined : map[key];
};

type DocType = "Layout" | "CompactLayout" | "FlexiPage" | "ListView";
const DOC_TYPE: Partial<Record<UnpublishedItem["kind"], DocType>> = { layout: "Layout", compactLayout: "CompactLayout", flexiPage: "FlexiPage", listView: "ListView" };

/** The lines for `item` once its org document is read; pure given the snapshot. */
export function summaryFor(item: UnpublishedItem, snap: PublishedIpad, doc: unknown): string[] | null {
  switch (item.kind) {
    case "layout":
      return summarizeLayout(find(snap.layouts, item.name), doc as LiveLayout);
    case "compactLayout":
      return summarizeCompact(find(snap.compactSources, item.name)?.fields, doc as LiveCompactLayout);
    case "flexiPage":
      return summarizeFlexiPage(find(snap.pages, item.name) ?? (snap.home && norm(snap.home.name) === norm(item.name) ? snap.home : undefined), doc as LiveFlexiPage);
    case "listView": {
      const [object, name] = item.name.split(".");
      return summarizeListView(snap.objects[object]?.listViews.find((v) => norm(v.name) === norm(name)), doc as LiveListView);
    }
    default:
      return null;
  }
}

/** Reads kept for the session: a document is read again only when it changed or the cache did. */
const memo = new Map<string, string[] | null>();
const CONCURRENCY = 3;

/**
 * What changed in each listed item, read from the org when the popover is open (never for the badge count):
 * the org's document against the published snapshot, three at a time. Admin Console records carry their own
 * `summary` from the server. Rows with nothing to read are absent from the result.
 */
export function useChangeSummaries(enabled: boolean, items: UnpublishedItem[], snapshot: PublishedIpad | null): Record<string, ChangeSummary> {
  const [state, setState] = useState<Record<string, ChangeSummary>>({});
  const ticket = useRef(0);

  useEffect(() => {
    if (!enabled || !snapshot) return;
    const mine = ++ticket.current;
    const cache = snapshot.cache.recordId;
    const todo = items.filter((i) => DOC_TYPE[i.kind]);
    const initial: Record<string, ChangeSummary> = {};
    const queue: UnpublishedItem[] = [];
    for (const i of todo) {
      const key = `${cache}|${i.id}|${i.lastModifiedAt}`;
      if (memo.has(key)) initial[i.id] = { status: "ready", lines: memo.get(key)! };
      else {
        initial[i.id] = { status: "loading" };
        queue.push(i);
      }
    }
    setState(initial);
    const set = (id: string, s: ChangeSummary) => ticket.current === mine && setState((m) => ({ ...m, [id]: s }));
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        if (ticket.current !== mine) return;
        try {
          const res = await window.lscApi.studioMetadataDoc(DOC_TYPE[item.kind]!, item.name);
          const error = res.error ?? (res.data as { error?: string } | undefined)?.error;
          if (error) {
            set(item.id, { status: "error" });
            continue;
          }
          const lines = summaryFor(item, snapshot, res.data);
          memo.set(`${cache}|${item.id}|${item.lastModifiedAt}`, lines);
          set(item.id, { status: "ready", lines });
        } catch {
          set(item.id, { status: "error" });
        }
      }
    };
    for (let n = 0; n < Math.min(CONCURRENCY, queue.length); n++) void worker();
    return () => {
      ticket.current++;
    };
  }, [enabled, items, snapshot]);

  return state;
}
