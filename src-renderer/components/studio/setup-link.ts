/**
 * "Open in Setup": a link is a list-page `path` (always valid) plus a `ref` the
 * server turns into the exact item's page (`studio_setup_links`). Resolved
 * answers are kept per org, so selecting a block warms the click.
 */

/** What a Setup page can be looked up by; the server's `SetupRef` (src/studio/setup-links.ts). */
export type SetupRef =
  | { type: "layout"; object: string; name: string }
  | { type: "field"; object: string; field: string }
  | { type: "compactLayout"; object: string; name: string }
  | { type: "flexiPage"; name: string }
  | { type: "listView"; object: string; name: string }
  | { type: "validationRule"; object: string; id: string }
  | { type: "apexTrigger"; id: string }
  | { type: "flow"; id: string }
  | { type: "user"; id: string };

export interface SetupLink {
  label: string;
  /** The list page: used when the exact one can't be resolved. */
  path: string;
  ref?: SetupRef;
}

const resolved = new Map<string, Promise<string>>();

/** The deepest path for `link` in `org`; its list page when the server can't find the item. */
export function resolveSetupPath(org: string, link: SetupLink): Promise<string> {
  const ref = link.ref;
  if (!ref) return Promise.resolve(link.path);
  const key = `${org}\u0000${JSON.stringify(ref)}`;
  let hit = resolved.get(key);
  if (!hit) {
    hit = window.lscApi
      .studioSetupLinks([ref])
      .then((res) => {
        const l = (res.data as { links?: { path?: unknown }[] } | undefined)?.links?.[0];
        if (typeof l?.path !== "string") throw new Error("no link");
        return l.path;
      })
      .catch(() => {
        resolved.delete(key);
        return link.path;
      });
    resolved.set(key, hit);
  }
  return hit;
}

export async function openSetupLink(org: string, link: SetupLink): Promise<void> {
  await window.lscApi.openSfOrg(org, await resolveSetupPath(org, link));
}

/** The Setup page a board item (validation rule, trigger, flow, Visit layout, user) is on, or null for kinds with none. */
export function itemSetupLink(item: {
  id: string;
  label: string;
  detailKind?: string;
  properties: Record<string, string | number | boolean | null>;
  user?: { id: string };
}): SetupLink | null {
  const object = typeof item.properties.Object === "string" ? item.properties.Object : "";
  const lists: Record<string, string> = {
    layout: `/lightning/setup/ObjectManager/${object}/PageLayouts/view`,
    validationRule: `/lightning/setup/ObjectManager/${object}/ValidationRules/view`,
    apexTrigger: "/lightning/setup/ApexTriggers/home",
    flow: "/lightning/setup/Flows/home",
  };
  const ref = ((): SetupRef | null => {
    if (item.user) return { type: "user", id: item.user.id };
    switch (item.detailKind) {
      case "layout":
        return object ? { type: "layout", object, name: item.label } : null;
      case "validationRule":
        return object ? { type: "validationRule", object, id: item.id } : null;
      case "apexTrigger":
        return { type: "apexTrigger", id: item.id };
      case "flow":
        return { type: "flow", id: item.id };
      default:
        return null;
    }
  })();
  if (!ref) return null;
  return { label: item.label, path: lists[ref.type] ?? "/lightning/setup/ManageUsers/home", ref };
}
