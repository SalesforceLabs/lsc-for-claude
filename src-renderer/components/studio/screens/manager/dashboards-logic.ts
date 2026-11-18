import type { DashboardItem } from "./dashboards-types";

/** MultiDashboardsViewController search: a flat list of dashboards whose title contains the text, case-insensitively. */
export function searchDashboards(items: DashboardItem[], text: string): DashboardItem[] {
  const needle = text.trim().toLowerCase();
  const out: DashboardItem[] = [];
  const walk = (list: DashboardItem[]) => {
    for (const i of list) {
      if (i.kind === "dashboard" && i.title.toLowerCase().includes(needle)) out.push(i);
      walk(i.children);
    }
  };
  walk(items);
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** The rows the tree shows: a node's children follow it when it is open. */
export function visibleRows(
  items: DashboardItem[],
  open: Set<string>,
  depth = 0,
  path = ""
): { item: DashboardItem; depth: number; key: string }[] {
  return items.flatMap((item, i) => {
    const key = `${path}/${i}:${item.title}`;
    return [
      { item, depth, key },
      ...(item.kind !== "dashboard" && open.has(key)
        ? visibleRows(item.children, open, depth + 1, key)
        : []),
    ];
  });
}
