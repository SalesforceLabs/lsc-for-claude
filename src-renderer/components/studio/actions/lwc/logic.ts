import type { InlineLwcCheck } from "../../published-types";

/**
 * Quick actions that are Lightning web components (LSC apps), as the app runs them. Pure rules; the
 * sheet is LwcActionSheet.tsx.
 */

/** LMRModule.swift:90 — a bundle with this prefix is an inline component (Home / record page), never an action. */
export const INLINE_PREFIX = "lscmobileinline_";
/** LMRModule.swift:92 — these action bundles are prefetched for offline use (LWCPrefetchService.swift:108). */
export const QUICK_ACTION_PREFIX = "lscmobilequickaction_";

/** The last dot component of an action name, as SFActionFactory.processActionComponents gives it (SFActionFactory.swift:44). */
const lastPart = (name: string): string => name.split(".").pop() ?? name;

/** The component bundle an LWC action opens: the layout item's `lightningWebComponent`, else the action's own name. A `c:` prefix is dropped. */
export function bundleName(actionName: string, component?: string): string {
  return (component || lastPart(actionName)).replace(/^c[:_]{1,2}/, "");
}

/**
 * LMRModule.action(for:…) (LMRModule.swift:56-81): an action whose type is LightningWebComponent and whose
 * name does not start with lscMobileInline_ is run by SFLMRAction. Anything else is not an LWC action.
 */
export function isLwcAction(
  type: string | undefined,
  actionName: string,
  component?: string
): boolean {
  if ((type ?? "").toLowerCase() !== "lightningwebcomponent") return false;
  return (
    !lastPart(actionName).toLowerCase().startsWith(INLINE_PREFIX) &&
    !bundleName(actionName, component).toLowerCase().startsWith(INLINE_PREFIX)
  );
}

/** Only the action prefix is prefetched, so only those run without a connection (LWCPrefetchService.swift:108). */
export const worksOffline = (actionName: string, component?: string): boolean =>
  lastPart(actionName).toLowerCase().includes(QUICK_ACTION_PREFIX) ||
  bundleName(actionName, component).toLowerCase().includes(QUICK_ACTION_PREFIX);

/**
 * What the component receives: SFLMRAction.swift:54 takes the object from the first part of the action name
 * ("Account.Foo" → Account), LMRContext.swift:231-239 passes it as `objectApiName` with the record id as `recordId`.
 * An action with no object in its name (Home) falls back to the record the menu is on.
 */
export function actionContext(
  actionName: string,
  record: { id: string; object: string } | null
): { recordId: string; objectApiName: string } {
  const parts = actionName.split(".");
  const object = parts.length > 1 ? parts[0] : "";
  return { recordId: record?.id ?? "", objectApiName: object || record?.object || "" };
}

/** Words for each kind of thing the offline check found (the same wording the record page's inline note uses). */
const ISSUE_TEXT: Record<InlineLwcCheck["issues"][number]["kind"], (detail: string) => string> = {
  apex: (d) => `Apex ${d}`,
  adapter: (d) => d,
  graphql: () => "GraphQL",
  network: (d) => d,
  component: (d) => `<${d}>`,
};

/** The lines under the component: what needs a connection on the iPad, and what only works with offline GraphQL. */
export function offlineLines(check: InlineLwcCheck | undefined): string[] {
  if (!check) return [];
  const text = (i: InlineLwcCheck["issues"][number]) =>
    ISSUE_TEXT[i.kind](i.detail) + (i.bundle ? ` (in c/${i.bundle})` : "");
  const online = check.issues.filter((i) => i.severity === "online");
  const gated = check.issues.filter((i) => i.severity === "gated");
  const out: string[] = [];
  if (online.length) out.push(`Needs a connection on the iPad: ${online.map(text).join(", ")}.`);
  if (gated.length)
    out.push(
      `${gated.map(text).join(", ")} works offline only when the org has offline GraphQL for LSC Mobile turned on.`
    );
  return out;
}

/** The one-line reason shown when the component can't run in the preview. */
export function notInPreview(reason: string): string {
  const r = reason.trim().replace(/\s+/g, " ");
  const short = r.length > 220 ? `${r.slice(0, 217)}...` : r;
  return `Not in the preview: ${short || "the component could not run"}`;
}
