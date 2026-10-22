import type { PublishedTab } from "./published-types";

/**
 * LSC Mobile deep links (`lsc4ce://deeplink/...`), parsed as DeepLinkParse.swift
 * does and matched to a tab as ApplicationTabVC.tabItemWithCoordinator does.
 */

/** DeepLinkNavigation.Tab: matched by tab name (idName), or for `lightning/o|r` by the tab's object. */
export type DeepLinkTab = { name: string; bySobject: boolean };

/** DeepLinkNavigation.Object. */
export type DeepLinkObject =
  | { kind: "existing"; sobject: string; recordId: string }
  | { kind: "edit"; sobject: string; recordId: string }
  | { kind: "new"; sobject: string }
  | { kind: "quickAction"; sobject: string; recordId: string; action: string };

export type DeepLink =
  | { kind: "tab"; tab: DeepLinkTab }
  | { kind: "tabWithObject"; tab: DeepLinkTab; object: DeepLinkObject }
  | { kind: "modal"; object: DeepLinkObject }
  /** tab/…/action/upsert, modal/action/upsert, lightning/o/…/upsert: the app writes records from the URL. */
  | { kind: "upsert"; tab?: DeepLinkTab };

/** NotificationLinkOpener: these schemes go to the deep link service. */
export function isDeepLink(url: string): boolean {
  return /^lsc4ce(dev)?:/i.test(url);
}

const ieq = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

function object(sobject: string, action: string | undefined, recordId?: string): DeepLinkObject | null {
  switch (action?.toLowerCase()) {
    case "view":
      return recordId ? { kind: "existing", sobject, recordId } : null;
    case "edit":
      return recordId ? { kind: "edit", sobject, recordId } : null;
    case "new":
      return { kind: "new", sobject };
    default:
      return null;
  }
}

/** DeepLinkParse.parse: null when the app shows "Cannot parse deeplink URL". */
export function parseDeepLink(url: string): DeepLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  // url.pathComponents minus the leading "/" — the host ("deeplink") isn't part of the path.
  const p = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  const [a, b, c, d, e, f, g] = p;
  const len = p.length;
  const modalParam = u.searchParams.get("modal") === "1";
  const named = (name: string): DeepLinkTab => ({ name, bySobject: false });
  const bySobject = (name: string): DeepLinkTab => ({ name, bySobject: true });

  if (ieq(a, "tab") && b) {
    if (len === 2) return { kind: "tab", tab: named(b) };
    if (len === 4 && ieq(c, "action") && ieq(d, "upsert")) return { kind: "upsert", tab: named(b) };
    if (ieq(c, "sobject-name") && d) {
      if (len === 6 && ieq(e, "action")) {
        const o = object(d, f);
        return o ? { kind: "tabWithObject", tab: named(b), object: o } : null;
      }
      if (ieq(e, "record-id") && f) {
        if (len === 6) return { kind: "tabWithObject", tab: named(b), object: { kind: "existing", sobject: d, recordId: f } };
        if (len === 8 && ieq(g, "action")) {
          const o = object(d, p[7], f);
          return o ? { kind: "tabWithObject", tab: named(b), object: o } : null;
        }
        if (len === 8 && ieq(g, "quick-action")) return { kind: "tabWithObject", tab: named(b), object: { kind: "quickAction", sobject: d, recordId: f, action: p[7] } };
      }
    }
    return null;
  }
  if (ieq(a, "modal")) {
    if (len === 3 && ieq(b, "action") && ieq(c, "upsert")) return { kind: "upsert" };
    if (ieq(b, "sobject-name") && c) {
      if (len === 5 && ieq(d, "action")) {
        const o = object(c, e);
        return o ? { kind: "modal", object: o } : null;
      }
      if (ieq(d, "record-id") && e) {
        if (len === 5) return { kind: "modal", object: { kind: "existing", sobject: c, recordId: e } };
        if (len === 7 && ieq(f, "action")) {
          const o = object(c, g, e);
          return o ? { kind: "modal", object: o } : null;
        }
        if (len === 7 && ieq(f, "quick-action")) return { kind: "modal", object: { kind: "quickAction", sobject: c, recordId: e, action: g } };
      }
    }
    return null;
  }
  if (ieq(a, "lightning")) {
    if (ieq(b, "r") && c && d && e) {
      if (len === 6 && ieq(e, "action")) return { kind: "tabWithObject", tab: bySobject(c), object: { kind: "quickAction", sobject: c, recordId: d, action: f } };
      const o = object(c, e, d);
      if (!o) return null;
      return modalParam ? { kind: "modal", object: o } : { kind: "tabWithObject", tab: bySobject(c), object: o };
    }
    if (ieq(b, "o") && c && d) {
      if (ieq(d, "upsert")) return { kind: "upsert", tab: modalParam ? undefined : bySobject(c) };
      if (ieq(d, "list")) return { kind: "tab", tab: bySobject(c) };
      const o = object(c, d);
      if (!o) return null;
      return modalParam ? { kind: "modal", object: o } : { kind: "tabWithObject", tab: bySobject(c), object: o };
    }
    if (len === 3 && ieq(b, "n") && c) return { kind: "tab", tab: named(c) };
    // Tab.name: the "home" Lightning page is the standard-home tab.
    if (len === 3 && ieq(b, "page") && c) return { kind: "tab", tab: named(ieq(c, "home") ? "standard-home" : c) };
    return null;
  }
  return null;
}

/** The tab a deep link opens: idName (the tab's fullName) or, for Lightning object links, the tab's object. */
export function findDeepLinkTab(tab: DeepLinkTab, tabs: PublishedTab[]): PublishedTab | undefined {
  if (tab.bySobject) return tabs.find((t) => (t.kind === "accounts" ? "Account" : t.sobject)?.toLowerCase() === tab.name.toLowerCase());
  return tabs.find((t) => t.fullName.toLowerCase() === tab.name.toLowerCase());
}

/** A record the snapshot holds, by its 18- or 15-character id. */
export function findRecordId(id: string, byId: Record<string, unknown> | undefined): string | undefined {
  if (!byId) return undefined;
  if (byId[id]) return id;
  return id.length === 15 ? Object.keys(byId).find((k) => k.startsWith(id)) : byId[id.slice(0, 15)] ? id.slice(0, 15) : undefined;
}
