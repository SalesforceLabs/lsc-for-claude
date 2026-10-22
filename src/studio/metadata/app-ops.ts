/**
 * Edits to a Lightning app's tab bar (a CustomApplication): move a tab, add
 * one, take one off.
 *
 * An app lists its navigation items as `<tabs>` in order. An app installed from a
 * package (its name carries the package's namespace, `lsc4ce__lifeSciencesCommercial`) keeps
 * its own tabs in `<tabs>`, which a subscriber can't change, and the subscriber's in
 * `<subscriberTabs>`, listed before them in the file. Those are the ones edited here;
 * the package's stay where they are. Tabs are found by name. Each op is checked against
 * the document as it is now — a tab that isn't there, or one that's already there, throws
 * `StaleAppError` — and returns the op that reverses it. Ops apply in order, each to the
 * result of the one before.
 *
 * The iPad's tab bar is the app's tabs in this order (LSC's own UI Settings tabs are
 * merged in at their TabOrder; see published.ts `buildTabs`).
 */

import type { AppOp } from "../types.js";
import { childrenNamed, cloneNode, insertInOrder, leaf, unescapeXml, type XmlNode } from "./xml.js";

/** CustomApplication's top-level elements in Metadata API order (the ones that matter for placing tabs). */
const APP_ORDER = [
  "actionOverrides",
  "brand",
  "defaultLandingTab",
  "description",
  "enableMultiMonitorComponents",
  "formFactors",
  "isNavAutoTempTabsDisabled",
  "isNavPersonalizationDisabled",
  "isNavTabPersistenceDisabled",
  "isOmniPinnedViewEnabled",
  "label",
  "logo",
  "navType",
  "preferences",
  "profileActionOverrides",
  "setupExperience",
  "subscriberTabs",
  "tabs",
  "uiType",
  "utilityBar",
  "workspaceConfig",
];

export class StaleAppError extends Error {}

export interface AppChange {
  tab: string;
  before: string;
  after: string;
}

/** An app installed from a package has its namespace in front of its name. */
export const isInstalledApp = (fullName: string): boolean =>
  /^[A-Za-z][A-Za-z0-9]*__\w+$/.test(fullName);

/** The element holding the tabs a subscriber can change. */
export const editableTabTag = (fullName: string): "tabs" | "subscriberTabs" =>
  isInstalledApp(fullName) ? "subscriberTabs" : "tabs";

const NAME = /^[\w.\-]+$/;

function assertName(name: string): void {
  if (!NAME.test(name)) throw new Error(`Invalid tab name: ${name}`);
}

const unwrap = (node: XmlNode) => unescapeXml(node.text ?? "");

/** The tabs that can be arranged, in order. */
export const appTabs = (root: XmlNode, fullName: string): string[] =>
  childrenNamed(root, editableTabTag(fullName)).map(unwrap);

/** The package's own tabs, which can't be changed (empty for an app of the org's own). */
export const appFixedTabs = (root: XmlNode, fullName: string): string[] =>
  isInstalledApp(fullName) ? childrenNamed(root, "tabs").map(unwrap) : [];

function nodes(root: XmlNode, fullName: string): XmlNode[] {
  return childrenNamed(root, editableTabTag(fullName));
}

function findTab(root: XmlNode, fullName: string, tab: string): XmlNode {
  const node = nodes(root, fullName).find((f) => unwrap(f) === tab);
  if (!node) {
    const fixed = appFixedTabs(root, fullName).includes(tab);
    throw new StaleAppError(
      fixed
        ? `${tab} belongs to the app's package, so it can't be changed.`
        : `${tab} isn't a tab of the app.`
    );
  }
  return node;
}

function nextTab(root: XmlNode, fullName: string, node: XmlNode): string | null {
  const all = nodes(root, fullName);
  const next = all[all.indexOf(node) + 1];
  return next ? unwrap(next) : null;
}

/** Insert a tab before `before`, or after the last editable tab. */
function placeTab(root: XmlNode, fullName: string, node: XmlNode, before: string | null): void {
  if (!before) {
    const all = nodes(root, fullName);
    const last = all[all.length - 1];
    if (last) root.children.splice(root.children.indexOf(last) + 1, 0, node);
    else insertInOrder(root, node, APP_ORDER);
    return;
  }
  const target = findTab(root, fullName, before);
  root.children.splice(root.children.indexOf(target), 0, node);
}

function detach(root: XmlNode, node: XmlNode): void {
  root.children.splice(root.children.indexOf(node), 1);
}

const position = (root: XmlNode, fullName: string, node: XmlNode) =>
  `Position ${nodes(root, fullName).indexOf(node) + 1} of ${nodes(root, fullName).length}`;

/** Apply one op to `root` in place; returns its inverse and what changed, in words. */
export function applyAppOp(
  root: XmlNode,
  fullName: string,
  op: AppOp
): { inverse: AppOp; change: AppChange } {
  switch (op.op) {
    case "moveAppTab": {
      assertName(op.tab);
      const node = findTab(root, fullName, op.tab);
      const was = position(root, fullName, node);
      const next = nextTab(root, fullName, node);
      detach(root, node);
      placeTab(root, fullName, node, op.before);
      return {
        inverse: { op: "moveAppTab", tab: op.tab, before: next },
        change: { tab: `Tab ${op.tab}`, before: was, after: position(root, fullName, node) },
      };
    }
    case "removeAppTab": {
      assertName(op.tab);
      const node = findTab(root, fullName, op.tab);
      const was = position(root, fullName, node);
      const next = nextTab(root, fullName, node);
      detach(root, node);
      return {
        inverse: { op: "addAppTab", tab: op.tab, before: next },
        change: { tab: `Tab ${op.tab}`, before: was, after: "(removed)" },
      };
    }
    case "addAppTab": {
      assertName(op.tab);
      const present = [...nodes(root, fullName).map(unwrap), ...appFixedTabs(root, fullName)];
      if (present.includes(op.tab))
        throw new StaleAppError(`${op.tab} is already a tab of the app.`);
      const node = leaf(editableTabTag(fullName), op.tab);
      placeTab(root, fullName, node, op.before);
      return {
        inverse: { op: "removeAppTab", tab: op.tab },
        change: {
          tab: `Tab ${op.tab}`,
          before: "(not a tab of the app)",
          after: position(root, fullName, node),
        },
      };
    }
    default:
      throw new Error(`Not an app edit: ${(op as { op?: string }).op ?? "?"}`);
  }
}

/** Apply ops in order to a copy of `root`. The inverse ops undo them all, in the order given. */
export function applyAppOps(
  root: XmlNode,
  fullName: string,
  ops: AppOp[]
): { root: XmlNode; inverse: AppOp[]; changes: AppChange[] } {
  const copy = cloneNode(root);
  const inverse: AppOp[] = [];
  const changes: AppChange[] = [];
  for (const op of ops) {
    const r = applyAppOp(copy, fullName, op);
    inverse.unshift(r.inverse);
    changes.push(r.change);
  }
  return { root: copy, inverse, changes };
}
