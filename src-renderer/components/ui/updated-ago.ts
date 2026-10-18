/** "Updated just now" / "Updated 12 min ago" / "Updated 3 h ago" / "Updated on 12 Oct", for a cached answer. */
export function updatedAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  return `Updated on ${new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
