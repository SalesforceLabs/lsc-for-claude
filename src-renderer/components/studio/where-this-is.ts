import type { MetadataDocRef, StudioFix, StudioItem } from "./types";
import type { EditTarget } from "./edit-targets";
import type { DraftAction, DraftTab } from "./edit-draft";
import type { PendingChange } from "./changes";
import type { UnpublishedItem } from "./org-ahead";

/**
 * The inspector's "Where this is": the selected block in each of the three
 * places a change can be — your tray, the org, and reps' iPads (the profile's
 * published metadata cache).
 */

/** What a block is made from: the metadata documents behind it and the Admin Console records (by DeveloperName). */
export interface BlockRefs {
  docs: { type: MetadataDocRef["type"]; fullName: string }[];
  records: string[];
  /** A record queued to be created (a tab or action Draft added). */
  creates?: PendingChange[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function touches(fix: StudioFix, refs: BlockRefs): boolean {
  const doc = (type: string, fullName: string) => refs.docs.some((d) => d.type === type && same(d.fullName, fullName));
  const record = (developerName: string) => refs.records.some((r) => same(r, developerName));
  switch (fix.kind) {
    case "editMetadata":
    case "copyForProfile":
      return doc(fix.doc.type, fix.doc.fullName);
    case "setLayoutRelatedList":
      return doc("Layout", fix.layoutName);
    case "setConfigField":
    case "setProfileAssignments":
    case "createConfigRecord":
    case "deleteConfigRecord":
      return record(fix.developerName);
    case "setActive":
      return fix.record.type !== "validationRule" && record(fix.record.developerName);
    default:
      return false;
  }
}

/** The tray's changes to the documents and records behind a block. */
export function changesTouching(pending: PendingChange[], refs: BlockRefs): PendingChange[] {
  return pending.filter((p) => refs.creates?.includes(p) || touches(p.fix, refs));
}

export interface WhereRow {
  place: "tray" | "org" | "ipad";
  label: string;
  text: string;
  /** Full text when `text` is shortened (several queued changes). */
  title?: string;
  /** Nothing is waiting here: the row steps back. */
  quiet?: boolean;
}

const day = (iso: string | null | undefined): string | null => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
};

/** The three rows, in the order a change travels: your tray → the org → iPads. */
export function whereRows({
  mine,
  orgAhead,
  orgDiffers = false,
  publishedAt,
}: {
  mine: PendingChange[];
  orgAhead?: UnpublishedItem;
  /** The org's document differs from the published one, though the unpublished list doesn't name it (no date or author then). */
  orgDiffers?: boolean;
  /** When the profile's metadata cache was generated. */
  publishedAt?: string | null;
}): WhereRow[] {
  const labels = mine.map((c) => c.fix.label);
  const tray: WhereRow =
    labels.length === 0
      ? { place: "tray", label: "Your changes", text: "None queued", quiet: true }
      : labels.length === 1
        ? { place: "tray", label: "Your changes", text: labels[0], title: labels[0] }
        : { place: "tray", label: "Your changes", text: `${labels.length} queued: ${labels[0]}, …`, title: labels.join("\n") };

  const changed = orgAhead ? day(orgAhead.lastModifiedAt) : null;
  const by = orgAhead?.lastModifiedBy ? ` by ${orgAhead.lastModifiedBy}` : "";
  const org: WhereRow = orgAhead
    ? { place: "org", label: "In the org", text: `Changed ${changed ? `on ${changed}` : "since the publish"}${by}` }
    : orgDiffers
      ? { place: "org", label: "In the org", text: "Changed in Setup since the publish" }
      : { place: "org", label: "In the org", text: "Same as on iPads", quiet: true };

  const published = day(publishedAt);
  const ipad: WhereRow = orgAhead?.live
    ? { place: "ipad", label: "On iPads", text: "Read from the org, so reps already have it" }
    : {
        place: "ipad",
        label: "On iPads",
        text: published ? `Published ${published}${orgAhead || orgDiffers ? ", without the org's change" : ""}` : "Not published yet",
      };
  return [tray, org, ipad];
}

/** The documents and records behind a selected block, from what the preview already holds. */
export function refsOfTarget(
  t: EditTarget,
  { tabs, homeMenu, app }: { tabs: DraftTab[]; homeMenu: DraftAction[]; app?: string }
): BlockRefs {
  const fromItem = (d?: { item?: StudioItem; create?: PendingChange }): BlockRefs => ({
    docs: [],
    records: d?.item?.edit?.record && d.item.edit.record.type !== "validationRule" ? [d.item.edit.record.developerName] : [],
    creates: d?.create ? [d.create] : [],
  });
  switch (t.kind) {
    case "section":
    case "field":
      return { docs: [{ type: "Layout", fullName: t.layout }], records: [] };
    case "related":
      return { docs: t.layout ? [{ type: "Layout", fullName: t.layout }] : [], records: [] };
    case "headerField":
      return { docs: [{ type: "CompactLayout", fullName: t.compactLayout }], records: [] };
    case "highlights":
      return { docs: t.compactLayout ? [{ type: "CompactLayout", fullName: t.compactLayout }] : [], records: [] };
    case "component":
    case "recordTab":
      return { docs: [{ type: "FlexiPage", fullName: t.page }], records: [] };
    case "listView":
      return { docs: [{ type: "ListView", fullName: `${t.object}.${t.name}` }], records: [] };
    case "listColumn":
      return { docs: [{ type: "ListView", fullName: t.listView }], records: [] };
    case "tab": {
      const bar = tabs.find((d) => d.tab.fullName === t.fullName);
      const refs = fromItem(bar);
      return app && bar && !bar.item && !bar.create ? { ...refs, docs: [{ type: "CustomApplication", fullName: app }] } : refs;
    }
    case "action":
      return t.place === "home" ? fromItem(homeMenu.find((d) => d.value.name === t.name)) : { docs: [], records: [t.name] };
  }
}
