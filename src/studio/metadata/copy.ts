/**
 * "Make a copy just for this profile": the pure parts. Names for the copy, and
 * the rewrites that point one profile at it, on the Profile metadata (a page
 * layout's `layoutAssignments`) and on CustomApplication metadata (a Lightning
 * page's `profileActionOverrides`). Everything else in those files is left as
 * it was, byte for byte. The org calls are in `copy-fix.ts`.
 */

import type { CopyMove } from "../types.js";
import {
  childText,
  childrenNamed,
  cloneNode,
  insertInOrder,
  leaf,
  setChildText,
  type XmlNode,
} from "./xml.js";

const SPLIT_PROFILES: Record<string, string> = {
  "System Administrator": "Admin",
  "Standard User": "Standard",
  "Read Only": "ReadOnly",
  "Solution Manager": "SolutionManager",
  "Marketing User": "MarketingProfile",
  "Contract Manager": "ContractManager",
  "Standard Platform User": "StandardAul",
};

/** A profile's Metadata API name from its Profile.Name ("System Administrator" → "Admin"). */
export const profileFullName = (name: string): string => SPLIT_PROFILES[name] ?? name;

/** The profile as CustomApplication overrides spell it: percent-encoded ("LS Rep" → "LS%20Rep"). */
export const profileXmlName = (name: string): string =>
  encodeURIComponent(profileFullName(name)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

/** Whether an override's `<profile>` text is this profile. */
export function isProfile(raw: string | undefined, name: string): boolean {
  if (!raw) return false;
  const full = profileFullName(name);
  if (raw === full) return true;
  try {
    return decodeURIComponent(raw) === full;
  } catch {
    return false;
  }
}

/** The longest a layout's name (after "Object-") can be. */
const LAYOUT_NAME_MAX = 80;
const FLEXIPAGE_NAME_MAX = 80;
const LABEL_MAX = 80;

const safeProfile = (profile: string) =>
  profile
    .replace(/[^\w .-]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "profile";

/** "Account-HCP Layout" + "LS Rep" → "Account-HCP Layout - LS Rep" and its label. */
export function layoutCopyName(
  source: string,
  profile: string
): { fullName: string; label: string } {
  const dash = source.indexOf("-");
  if (dash < 1) throw new Error(`Invalid layout name: ${source}`);
  const object = source.slice(0, dash);
  const suffix = ` - ${safeProfile(profile)}`;
  let rest = source.slice(dash + 1);
  if (rest.length + suffix.length > LAYOUT_NAME_MAX) {
    // Don't cut through a percent-escape such as %28.
    rest = rest
      .slice(0, Math.max(1, LAYOUT_NAME_MAX - suffix.length))
      .replace(/%[0-9A-Fa-f]?$/, "")
      .trimEnd();
  }
  let label: string;
  try {
    label = decodeURIComponent(rest);
  } catch {
    label = rest;
  }
  return { fullName: `${object}-${rest}${suffix}`, label: `${label}${suffix}` };
}

/** "Account_HCP_Page" + "LS Rep" → "Account_HCP_Page_LS_Rep" (a valid developer name) and a label from the page's own. */
export function flexiPageCopyName(
  source: string,
  profile: string,
  label: string
): { fullName: string; label: string } {
  const slug = profile.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "profile";
  const base = source.replace(/__/g, "_");
  const fullName = `${base}_${slug}`
    .replace(/_+/g, "_")
    .slice(0, FLEXIPAGE_NAME_MAX)
    .replace(/_+$/, "");
  const suffix = ` (${profile})`;
  return { fullName, label: `${label.slice(0, Math.max(1, LABEL_MAX - suffix.length))}${suffix}` };
}

/** True for a valid Lightning page developer name. */
export const isFlexiPageName = (n: string) =>
  /^[A-Za-z][A-Za-z0-9_]*$/.test(n) && !n.includes("__") && !n.endsWith("_") && n.length <= 80;

// --- Profile: page layout assignments ---------------------------------------------------

/** The profile's layout assignments for `layout`: their record types (null for the object's default). */
export function layoutAssignmentsOf(profile: XmlNode, layout: string): (string | null)[] {
  return childrenNamed(profile, "layoutAssignments")
    .filter((a) => childText(a, "layout") === layout)
    .map((a) => childText(a, "recordType") ?? null);
}

/**
 * The profile with its assignments of `from` pointed at `to` instead: all of them,
 * or only those for `recordTypes`. Other assignments, and the rest of the file, are untouched.
 */
export function reassignLayout(
  profile: XmlNode,
  from: string,
  to: string,
  recordTypes?: (string | null)[]
): { root: XmlNode; moves: CopyMove[] } {
  const root = cloneNode(profile);
  const moves: CopyMove[] = [];
  for (const a of childrenNamed(root, "layoutAssignments")) {
    if (childText(a, "layout") !== from) continue;
    const recordType = childText(a, "recordType") ?? null;
    if (recordTypes && !recordTypes.includes(recordType)) continue;
    setChildText(a, "layout", to, ["layout", "recordType"]);
    moves.push({ recordType });
  }
  return { root, moves };
}

/** What gets deployed for the reassignment: a Profile holding only the moved assignments, so nothing else about the profile is deployed. */
export function layoutAssignmentFile(profile: XmlNode, layout: string, moves: CopyMove[]): XmlNode {
  return {
    tag: "Profile",
    ...(profile.attrs ? { attrs: { ...profile.attrs } } : {}),
    children: moves.map((m) => ({
      tag: "layoutAssignments",
      children: [
        leaf("layout", layout),
        ...(m.recordType ? [leaf("recordType", m.recordType)] : []),
      ],
    })),
  };
}

// --- CustomApplication: Lightning page overrides -------------------------------------------

const APP_ORDER = [
  "actionOverrides",
  "brand",
  "consoleConfig",
  "defaultLandingTab",
  "description",
  "enableCustomizeMyTabs",
  "enableKeyboardShortcuts",
  "enableListViewHover",
  "enableListViewReskin",
  "enableMultiMonitorComponents",
  "enablePinTabs",
  "enableTabHover",
  "enableTabLimits",
  "footerColor",
  "formFactors",
  "headerColor",
  "isNavAutoTempTabsDisabled",
  "isNavPersonalizationDisabled",
  "isServiceCloudConsole",
  "label",
  "logoUrl",
  "navType",
  "preferences",
  "profileActionOverrides",
  "saveUserSessions",
  "setupExperience",
  "subscriberPackageVersion",
  "tabs",
  "uiType",
  "utilityBar",
  "workspaceConfig",
];
const OVERRIDE_ORDER = [
  "actionName",
  "content",
  "formFactor",
  "pageOrSobjectType",
  "profile",
  "recordType",
  "type",
];

/** Overrides without a form factor are for large screens too. */
const large = (n: XmlNode) => (childText(n, "formFactor") ?? "Large") === "Large";

/**
 * The app with `profile` pointed at the page `to` where it now gets the page `from`:
 * the profile's own large-screen overrides are re-pointed; when it has none and
 * the app's default for large screens is `from`, an override for the profile is added.
 * `move` is null when the app doesn't give the profile `from`.
 */
export function reassignPage(
  app: XmlNode,
  profile: string,
  from: string,
  to: string
): { root: XmlNode; move: CopyMove | null } {
  const root = cloneNode(app);
  const own = childrenNamed(root, "profileActionOverrides").filter(
    (o) => isProfile(childText(o, "profile"), profile) && large(o)
  );
  const mine = own.filter((o) => childText(o, "content") === from);
  if (mine.length) {
    for (const o of mine) setChildText(o, "content", to, OVERRIDE_ORDER);
    return { root, move: {} };
  }
  // A profile with an override for the same screen already gets its own page, not the app's default.
  const defaults = childrenNamed(root, "actionOverrides").filter(
    (o) => large(o) && childText(o, "content") === from
  );
  const taken = (d: XmlNode) =>
    own.some(
      (o) =>
        childText(o, "actionName") === childText(d, "actionName") &&
        (childText(o, "pageOrSobjectType") ?? "") === (childText(d, "pageOrSobjectType") ?? "") &&
        !childText(o, "recordType")
    );
  const fresh = defaults.filter((d) => !taken(d));
  if (!fresh.length) return { root, move: null };
  for (const d of fresh) {
    const o: XmlNode = { tag: "profileActionOverrides", children: [] };
    for (const tag of ["actionName", "formFactor", "pageOrSobjectType", "type"]) {
      const v = childText(d, tag);
      if (v !== undefined) o.children.push(leaf(tag, v));
    }
    o.children.push(leaf("content", to), leaf("profile", profileXmlName(profile)));
    o.children.sort((a, b) => OVERRIDE_ORDER.indexOf(a.tag) - OVERRIDE_ORDER.indexOf(b.tag));
    insertInOrder(root, o, APP_ORDER);
  }
  return { root, move: { added: true } };
}

/** The app with the profile's pointing at `copy` put back to `source`: re-pointed overrides go back, added ones are removed. */
export function restorePage(
  app: XmlNode,
  profile: string,
  copy: string,
  source: string,
  added: boolean
): { root: XmlNode; changed: boolean } {
  const root = cloneNode(app);
  let changed = false;
  const mine = (o: XmlNode) =>
    isProfile(childText(o, "profile"), profile) && large(o) && childText(o, "content") === copy;
  if (added) {
    const before = root.children.length;
    root.children = root.children.filter((c) => !(c.tag === "profileActionOverrides" && mine(c)));
    changed = root.children.length !== before;
  } else {
    for (const o of childrenNamed(root, "profileActionOverrides")) {
      if (!mine(o)) continue;
      setChildText(o, "content", source, OVERRIDE_ORDER);
      changed = true;
    }
  }
  return { root, changed };
}
