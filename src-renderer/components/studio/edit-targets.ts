import type { PublishedIpad } from "./published-types";
import type { CreateConfigFix, StudioItem, StudioSurface } from "./types";
import {
  activeChange,
  effectiveActive,
  effectiveProfiles,
  profileChange,
  type PendingChange,
} from "./changes";
import type { SetupLink } from "./setup-link";
import { effectiveField, type DraftAction, type DraftTab } from "./edit-draft";

/**
 * Edit mode's provenance: every block in the published preview an admin can
 * select, and what to tell them about it — what it is, why this profile sees
 * it, and how to change it. Pure, so it's tested without a renderer.
 */
export type EditTarget =
  /** A pill in the tab bar; `index` is its place in the Draft bar. */
  | { kind: "tab"; fullName: string; label: string; index: number }
  /** A Lightning page component; `index` / `count` among the region's shown components. */
  | {
      kind: "component";
      page: string;
      pageLabel: string;
      region: string;
      index: number;
      count: number;
      name: string;
      label: string;
      home: boolean;
      visibility: "shown" | "conditional";
      visibilityNote?: string;
      /** Where it is in the page's XML (`sourceKey`), when the snapshot records it. */
      source?: string;
      /** The org item, for a component Draft inserted (it has no published source). */
      item?: string;
      /** Added in Draft: nothing to explain from the published page. */
      added?: boolean;
    }
  /** A tab of a record page's tab set; `index` / `count` among the drawn tabs. */
  | { kind: "recordTab"; page: string; pageLabel: string; title: string; index: number; count: number; active: boolean; source?: string }
  /** `key`: the section's index in the org's layout, once the preview is lined up with it. */
  | { kind: "section"; layout: string; index: number; count: number; label: string | null; key?: number }
  | {
      kind: "field";
      layout: string;
      section: string | null;
      field: string;
      label: string;
      required?: boolean;
      readOnly?: boolean;
      /** The layout item: a compound field's name for its parts. */
      item?: string;
    }
  /** `relatedList`: its name on the layout, when the layout lists it. */
  | { kind: "related"; object: string; label: string; parent: string; layout?: string; relatedList?: string }
  | { kind: "highlights"; object: string; compactLayout: string | null; fields: string[] }
  /** One field of the record header; `compactLayout` is its Metadata API name ("Account.LSC_Compact"). */
  | { kind: "headerField"; object: string; compactLayout: string; field: string; label: string; added?: boolean }
  /** A ••• menu item; `index` is its place in the Draft menu (Home) or the record's menu. */
  | {
      kind: "action";
      name: string;
      label: string;
      index: number;
      place: "home" | "record";
      object?: string;
    }
  | { kind: "listView"; object: string; name: string; label: string }
  /** One column of a list view; `listView` is its Metadata API name ("Account.MyAccounts"), `column` the id the view stores. */
  | { kind: "listColumn"; object: string; listView: string; viewLabel: string; column: string; label: string; added?: boolean };

/** Stable identity of a block, for hover, selection, and the DOM's `data-edit-key`. */
export function targetKey(t: EditTarget): string {
  switch (t.kind) {
    case "tab":
      return `tab:${t.fullName}`;
    case "component":
      return `component:${t.page}:${t.source ?? (t.item ? `+${t.item}` : `${t.region}:${t.index}`)}`;
    case "recordTab":
      return `recordTab:${t.page}:${t.source ?? t.index}`;
    case "section":
      return `section:${t.layout}:${t.key !== undefined ? `k${t.key}` : t.index}`;
    case "field":
      return `field:${t.layout}:${t.field}`;
    case "related":
      return `related:${t.parent}:${t.object}:${t.label}`;
    case "highlights":
      return `highlights:${t.object}:${t.compactLayout ?? ""}`;
    case "headerField":
      return `headerField:${t.compactLayout}:${t.field}`;
    case "action":
      return `action:${t.place}:${t.object ?? ""}:${t.name}`;
    case "listView":
      return `listView:${t.object}:${t.name}`;
    case "listColumn":
      return `listColumn:${t.listView}:${t.column}`;
  }
}

/** The short name tag shown on hover: "Home component · Next Best Customers". */
export function targetTag(t: EditTarget): string {
  return `${kindLabel(t)} · ${titleOf(t)}`;
}

function kindLabel(t: EditTarget): string {
  switch (t.kind) {
    case "tab":
      return "Tab";
    case "component":
      return t.home ? "Home component" : "Page component";
    case "recordTab":
      return "Record tab";
    case "section":
      return "Layout section";
    case "field":
      return "Field";
    case "related":
      return "Related list";
    case "highlights":
      return "Record header";
    case "headerField":
      return "Header field";
    case "action":
      return t.place === "home" ? "Home action" : "Record action";
    case "listView":
      return "List view";
    case "listColumn":
      return "List column";
  }
}

function titleOf(t: EditTarget): string {
  switch (t.kind) {
    case "section":
      return t.label || "Untitled section";
    case "highlights":
      return t.compactLayout ?? "Default compact layout";
    case "recordTab":
      return t.title;
    default:
      return t.label;
  }
}

/** The object a layout belongs to ("PersonAccount-Person Account Layout" → Account). */
export function layoutObject(layout: string): string {
  const o = layout.slice(0, Math.max(0, layout.indexOf("-")));
  return o === "PersonAccount" ? "Account" : o;
}

/** Salesforce Setup pages "Open in Setup" goes to (paths for `sf org open --path`). */
export const SETUP = {
  appManager: { label: "App Manager", path: "/lightning/setup/NavigationMenus/home" } as SetupLink,
  /** `page`: the Lightning page's API name; without it the list of pages. */
  flexiPages: (page?: string): SetupLink => ({
    label: page ? `Lightning page ${page}` : "Lightning App Builder",
    path: "/lightning/setup/FlexiPageList/home",
    ...(page ? { ref: { type: "flexiPage", name: page } } : {}),
  }),
  /** `layout`: the layout's full name ("Visit-LSDO PH FSR Visit Layout"); without it the object's list. */
  pageLayouts: (object: string, layout?: string): SetupLink => ({
    label: layout ? `${layout} page layout` : `${object} page layouts`,
    path: `/lightning/setup/ObjectManager/${encodeURIComponent(object)}/PageLayouts/view`,
    ...(layout ? { ref: { type: "layout", object, name: layout } } : {}),
  }),
  /** `compactLayout`: its name, with or without the "Object." prefix. */
  compactLayouts: (object: string, compactLayout?: string | null): SetupLink => ({
    label: compactLayout ? `${compactLayout.slice(compactLayout.indexOf(".") + 1)} compact layout` : `${object} compact layouts`,
    path: `/lightning/setup/ObjectManager/${encodeURIComponent(object)}/CompactLayouts/view`,
    ...(compactLayout ? { ref: { type: "compactLayout", object, name: compactLayout } } : {}),
  }),
  /** `field`: the field's API name; without it the object's fields. */
  fields: (object: string, field?: string): SetupLink => ({
    label: field ? `${field} field` : `${object} fields`,
    path: `/lightning/setup/ObjectManager/${encodeURIComponent(object)}/FieldsAndRelationships/view`,
    ...(field ? { ref: { type: "field", object, field } } : {}),
  }),
  listView: (object: string, name: string): SetupLink => ({
    label: `${object} list view`,
    path: `/lightning/o/${encodeURIComponent(object)}/list?filterName=${encodeURIComponent(name)}`,
    ref: { type: "listView", object, name },
  }),
};

/** Whether the profile's iPad downloads `object`: its DB Schema filter, or null when it isn't synced. Undefined when the cache didn't say. */
export function syncFilter(snapshot: PublishedIpad, object: string): string | null | undefined {
  if (!snapshot.sync) return undefined;
  const key = Object.keys(snapshot.sync).find((k) => k.toLowerCase() === object.toLowerCase());
  return key === undefined ? null : snapshot.sync[key];
}

export interface TargetInfo {
  kind: string;
  title: string;
  /** Where it comes from, outermost first. */
  what: string[];
  /** Why this profile's iPad shows it. */
  why: string[];
  /** Setup steps, for changes Studio can't make from the preview. */
  how: string[];
  /** Who a change reaches. */
  reach?: string;
  setup?: SetupLink;
  /** More pages worth opening (a layout field's own Setup page). */
  setupMore?: SetupLink[];
  /** The Studio board item behind it, for "Open in Studio". */
  studio?: { featureId: string; surface: string; itemId: string };
  /** The object the block shows records of, when the iPad has to sync them. */
  syncObject?: string;
  /** The block exists only in Draft. */
  draftOnly?: boolean;
}

export interface DescribeContext {
  snapshot: PublishedIpad;
  profile: string;
  pending: PendingChange[];
  tabs: DraftTab[];
  homeMenu: DraftAction[];
}

const PUBLISH = "Publish to iPad so reps get the change.";

const audienceLine = (item: StudioItem, pending: PendingChange[]) => {
  const profiles = item.edit?.profiles
    ? effectiveProfiles(item.edit, pending)
    : (item.audience?.profiles ?? []);
  return profiles.length
    ? `Assigned to ${profiles.length === 1 ? "1 profile" : `${profiles.length} profiles`}: ${profiles.join(", ")}.`
    : "Not limited to any profile.";
};

const reachOf = (item: StudioItem, pending: PendingChange[]) => {
  const n = item.edit?.profiles
    ? effectiveProfiles(item.edit, pending).length
    : (item.audience?.profiles.length ?? 0);
  return n
    ? `Turning it off reaches ${n === 1 ? "1 profile" : `all ${n} profiles`}; hiding it reaches only this one.`
    : undefined;
};

export function describeTarget(t: EditTarget, ctx: DescribeContext): TargetInfo {
  const base = { kind: kindLabel(t), title: titleOf(t) };
  switch (t.kind) {
    case "tab": {
      const d =
        ctx.tabs[t.index]?.tab.fullName === t.fullName
          ? ctx.tabs[t.index]
          : ctx.tabs.find((x) => x.tab.fullName === t.fullName);
      if (d?.create) {
        return {
          ...base,
          draftOnly: true,
          what: ["Admin Console", "Mobile › UI Settings", "New tab record (pending)"],
          why: [`The new record is assigned to ${ctx.profile}.`],
          how: [PUBLISH],
        };
      }
      if (d?.item) {
        const item = d.item;
        return {
          ...base,
          draftOnly: d.state === "added",
          what: [
            "Admin Console",
            "Mobile › UI Settings",
            `${item.label} (TabName ${String(item.properties.TabName ?? t.fullName)})`,
          ],
          why: [
            `${effectiveActive(item.edit!, ctx.pending) ? "An active" : "A switched-off"} UI Settings tab record at TabOrder ${String(effectiveField(item, "TabOrder", ctx.pending) ?? "?")}.`,
            audienceLine(item, ctx.pending),
            "The profile's tab visibility lets it through, so the iPad keeps it.",
          ],
          how: [
            "Move, hide or turn it off from the toolbar. The order sets TabOrder; tabs from the Lightning app keep their own places.",
            PUBLISH,
          ],
          reach: reachOf(item, ctx.pending),
          studio: { featureId: "actions-home", surface: "navigationTabs", itemId: item.id },
        };
      }
      return {
        ...base,
        what: ["Lightning app navigation", t.fullName],
        why: [
          t.fullName === "standard-home"
            ? "Home is the app's first tab."
            : "The tab is a navigation item of the Lightning app the profile opens in LSC Mobile.",
          "The profile's tab visibility for it isn't Hidden, so the iPad keeps it.",
        ],
        how: [
          "In Setup › App Manager, edit the LSC app › Navigation Items to add, remove or reorder its tabs.",
          "To hide it from one profile only, set the tab to Hidden in that profile's Tab Settings.",
          PUBLISH,
        ],
        reach: "The app's navigation reaches every profile that uses the app.",
        setup: SETUP.appManager,
      };
    }
    case "component": {
      if (t.added) {
        const related = /(^|:)relatedListSingleContainer$/.test(t.name);
        return {
          ...base,
          draftOnly: true,
          what: [`Lightning page "${t.pageLabel}"`, `${t.region} region`, "New component (pending)"],
          why: ["Draft inserts it here; the page's XML gets it when the tray is applied."],
          how: [
            related
              ? "Its records reach the iPad only if the profile syncs the child object (DB Schema)."
              : "Its other properties are App Builder's defaults; change them in Lightning App Builder after applying.",
            PUBLISH,
          ],
          reach: "Every app, profile and record type the page is activated for.",
          setup: SETUP.flexiPages(t.page),
        };
      }
      const notes =
        t.visibility === "conditional"
          ? [
              t.visibilityNote ??
                "It has a visibility rule: shown only when the rule passes for the rep.",
            ]
          : ["It has no visibility rule, so everyone who gets the page sees it."];
      return {
        ...base,
        what: [
          `Lightning page "${t.pageLabel}"`,
          `${t.region} region`,
          `${ordinal(t.index + 1)} of ${t.count}`,
        ],
        why: [
          t.home
            ? "This is the Home page activated for the profile's app."
            : "This is the Lightning page assigned to the record type.",
          ...notes,
        ],
        how: [
          `Setup › Lightning App Builder › open "${t.pageLabel}" › Edit.`,
          "Drag the component to reorder it, or select it and delete it. Its properties are in the right-hand panel.",
          "Save. The page's activations decide who gets it.",
          PUBLISH,
        ],
        reach: "Every app, profile and record type the page is activated for.",
        setup: SETUP.flexiPages(t.page),
      };
    }
    case "recordTab":
      return {
        ...base,
        what: [`Lightning page "${t.pageLabel}"`, "Tabs component", `${ordinal(t.index + 1)} of ${t.count} tabs`],
        why: [
          "This is the Lightning page assigned to the record type.",
          t.active ? "It's the tab the record opens on." : "The record opens on another tab; this one shows when tapped.",
        ],
        how: [
          `Setup › Lightning App Builder › open "${t.pageLabel}" › Edit, then select the Tabs component.`,
          "Reorder, rename or remove tabs, or pick the default tab, in its properties. Removing a tab removes what's in it.",
          "Save.",
          PUBLISH,
        ],
        reach: "Every app, profile and record type the page is activated for.",
        setup: SETUP.flexiPages(t.page),
      };
    case "section": {
      const object = layoutObject(t.layout);
      return {
        ...base,
        what: [`Page layout "${t.layout}"`, `Section ${t.index + 1} of ${t.count}`],
        why: [
          "The page layout assigned to this record type for the profile (Page Layout Assignment).",
        ],
        how: [
          `Setup › Object Manager › ${object} › Page Layouts › ${t.layout}.`,
          "Drag the section to move it. Its wrench renames it or changes its columns.",
          "Save.",
          PUBLISH,
        ],
        reach: "Every profile and record type assigned this layout.",
        setup: SETUP.pageLayouts(object, t.layout),
      };
    }
    case "field": {
      const object = layoutObject(t.layout);
      const flags = [
        t.required && "Required on this layout.",
        t.readOnly && "Read-only on this layout.",
      ].filter((x): x is string => !!x);
      return {
        ...base,
        what: [
          `Page layout "${t.layout}"`,
          t.section ? `Section "${t.section}"` : "Untitled section",
          t.field,
        ],
        why: [
          "The field is on the record type's page layout.",
          ...flags,
          "The profile can read it (field-level security). Fields it can't read are left off.",
        ],
        how: [
          `Setup › Object Manager › ${object} › Page Layouts › ${t.layout}.`,
          "Drag the field to move it, or back to the palette to remove it. Its wrench sets Read-Only and Required.",
          `Who can see it: Object Manager › ${object} › Fields & Relationships › ${t.field} › Set Field-Level Security.`,
          PUBLISH,
        ],
        reach: "Every profile and record type assigned this layout.",
        setup: SETUP.pageLayouts(object, t.layout),
        setupMore: [SETUP.fields(object, t.field.split(".")[0])],
      };
    }
    case "related": {
      const object = t.layout ? layoutObject(t.layout) : t.parent;
      return {
        ...base,
        what: [
          t.layout ? `Page layout "${t.layout}"` : `${t.parent} record page`,
          "Related lists",
          // Draft's placeholder for a layout with none has no object.
          ...(t.object ? [t.object] : []),
        ],
        why: [
          "The related list is on the record's page layout, or a related-list component on its Lightning page.",
          "Its rows are the child records the iPad has synced.",
        ],
        how: [
          `Setup › Object Manager › ${object} › Page Layouts › ${t.layout ?? "the layout"} › Related Lists: drag to reorder or remove; the wrench picks its columns.`,
          PUBLISH,
        ],
        reach: "Every profile and record type assigned this layout.",
        setup: SETUP.pageLayouts(object, t.layout),
        syncObject: t.object,
      };
    }
    case "highlights":
      return {
        ...base,
        what: [
          t.object,
          t.compactLayout
            ? `Compact layout "${t.compactLayout}"`
            : "The object's default compact layout",
        ],
        why: [
          `The record type's compact layout fills the header: ${t.fields.join(", ") || "no fields"}.`,
          "Fields the profile can't read are left off.",
        ],
        how: [
          `Setup › Object Manager › ${t.object} › Compact Layouts › ${t.compactLayout ?? "the default"} › Edit, then choose and order the fields.`,
          "To use another compact layout for a record type, change Compact Layout Assignment.",
          PUBLISH,
        ],
        reach: "Every record type assigned this compact layout, for every profile.",
        setup: SETUP.compactLayouts(t.object, t.compactLayout),
      };
    case "headerField": {
      const name = t.compactLayout.slice(t.compactLayout.indexOf(".") + 1);
      return {
        ...base,
        draftOnly: !!t.added,
        what: [t.object, `Compact layout "${name}"`, t.field],
        why: [
          "The field is on the compact layout the record type uses, so the iPad shows it in the record header.",
          "The record's name is the header's title, so a Name field isn't repeated. The profile has to be able to read the field (field-level security).",
        ],
        how: [
          `Setup › Object Manager › ${t.object} › Compact Layouts › ${name} › Edit, then add, remove or reorder the fields.`,
          "The header fits about 6 fields across; the rest scroll off to the side.",
          PUBLISH,
        ],
        reach: "Every record type assigned this compact layout, for every profile.",
        setup: SETUP.compactLayouts(t.object, t.compactLayout),
      };
    }
    case "action": {
      if (t.place === "record") {
        const object = t.object ?? "the object";
        return {
          ...base,
          what: [`${object} record`, "Page layout › Mobile & Lightning Actions"],
          why: [
            "The record's Lightning page lists it in the highlights panel's actions, or its page layout does.",
            "The iPad shows the actions it supports and skips the rest.",
          ],
          how: [
            `Setup › Object Manager › ${object} › Page Layouts › Mobile & Lightning Actions: drag to reorder or remove.`,
            PUBLISH,
          ],
          reach: "Every profile and record type assigned this layout.",
          setup: t.object ? SETUP.pageLayouts(t.object) : undefined,
        };
      }
      const d =
        ctx.homeMenu[t.index]?.value.name === t.name
          ? ctx.homeMenu[t.index]
          : ctx.homeMenu.find((x) => x.value.name === t.name);
      if (d?.create)
        return {
          ...base,
          draftOnly: true,
          what: ["Admin Console", "New action record (pending)"],
          why: ["Added by a change in the tray."],
          how: [PUBLISH],
        };
      const item = d?.item;
      if (!item)
        return {
          ...base,
          what: ["Admin Console"],
          why: ["Read live from the org's Home actions."],
          how: [PUBLISH],
        };
      const studio = { featureId: "actions-home", surface: "homeActions", itemId: item.id };
      if (!d.quick) {
        return {
          ...base,
          studio,
          what: ["Admin Console", "Custom actions (EntityType HomePage)", item.label],
          why: [
            "Every active Home custom action reaches every device: the iPad doesn't read its profiles.",
            "Custom actions come after the quick actions, sorted by name.",
          ],
          how: [
            "Turn it off from the toolbar, or open it in Studio to change its target.",
            PUBLISH,
          ],
          reach: "Turning it off reaches every profile.",
        };
      }
      return {
        ...base,
        studio,
        what: ["Admin Console", "Quick actions (Location HomePage)", item.label],
        why: [
          `SortOrder ${String(effectiveField(item, "SortOrder", ctx.pending) ?? "?")} puts it ${ordinal(ctx.homeMenu.filter((x) => x.state !== "removed").indexOf(d) + 1)} in the menu.`,
          `${ctx.profile} is listed in its Profiles field.`,
          "Home shows only New Visit, Inquiry, Share Content, Email and Order quick actions.",
        ],
        how: [
          "Move, hide or turn it off from the toolbar. Moving swaps SortOrder with its neighbour.",
          PUBLISH,
        ],
        reach: reachOf(item, ctx.pending),
      };
    }
    case "listView": {
      const hidden = ctx.snapshot.objects[t.object]?.hiddenListViews ?? [];
      return {
        ...base,
        what: [t.object, `List view "${t.label}"`, t.name],
        why: [
          "The list view is shared with the rep: with all users, or a group, role or territory they're in.",
          ...(hidden.length ? [`${hidden.length} other list views aren't shared with them.`] : []),
          "The iPad lists a view's records as Everything or Mine; it ignores any other filter scope. A view's sort comes from the org, and can't be changed here.",
        ],
        how: [
          `Open ${t.object} in Salesforce, choose the list view, then the gear: Edit List Filters, Select Fields to Display, or Sharing Settings.`,
          "Change its columns, filters and filter scope here in Draft. The iPad reads list views from the org when a rep opens them, so there is nothing to publish.",
        ],
        reach: "Everyone the list view is shared with.",
        setup: SETUP.listView(t.object, t.name),
        syncObject: t.object,
      };
    }
    case "listColumn": {
      const name = t.listView.slice(t.listView.indexOf(".") + 1);
      return {
        ...base,
        draftOnly: !!t.added,
        what: [t.object, `List view "${t.viewLabel}"`, t.column],
        why: [
          "The list view has the field as a column, so the iPad shows it as a column of the list.",
          "The profile has to be able to read the field (field-level security).",
        ],
        how: [
          `Open ${t.object} in Salesforce, choose the list view "${name}", then the gear: Select Fields to Display.`,
          "Move, remove or add columns from the toolbar; the order is the order on the iPad.",
        ],
        reach: "Everyone the list view is shared with.",
        setup: SETUP.listView(t.object, name),
        syncObject: t.object,
      };
    }
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * What "Add to iPad sync" does for an object the profile doesn't download: switch
 * on or assign its DB Schema record if there is one, else a prefilled new record
 * (the form opens before it's queued).
 */
export type SyncAction =
  | { kind: "change"; label: string; change: PendingChange }
  | { kind: "create"; label: string; draft: CreateConfigFix }
  | { kind: "queued"; label: string };

export function syncAction(
  object: string,
  surface: StudioSurface | undefined,
  profile: string,
  pending: PendingChange[]
): SyncAction | null {
  if (!surface) return null;
  const records = surface.items.filter(
    (i) => String(i.properties.SObject ?? "").toLowerCase() === object.toLowerCase() && i.edit
  );
  for (const item of records) {
    const edit = item.edit!;
    const profiles = edit.profiles ? effectiveProfiles(edit, pending) : null;
    const assigned = !profiles || profiles.some((p) => p.toLowerCase() === profile.toLowerCase());
    const active = effectiveActive(edit, pending);
    if (active && assigned)
      return { kind: "queued", label: `${item.label} syncs ${object} for ${profile} once applied` };
    if (assigned && !active) {
      const fix = activeChange(edit, true);
      if (fix)
        return {
          kind: "change",
          label: `Turn on ${item.label}`,
          change: { fix, affects: item.audience?.profiles },
        };
    }
    if (active && profiles) {
      const fix = profileChange(edit, [...profiles, profile]);
      if (fix)
        return {
          kind: "change",
          label: `Sync ${object} for ${profile}`,
          change: { fix, affects: [profile] },
        };
    }
  }
  const queued = pending.find(
    (p) =>
      p.fix.kind === "createConfigRecord" &&
      p.fix.category === "DbSchema" &&
      p.fix.fields.some(
        (f) => f.name === "SObject" && String(f.value).toLowerCase() === object.toLowerCase()
      )
  );
  if (queued)
    return { kind: "queued", label: `A new DB Schema record for ${object} is in the tray` };
  const template = surface.creates?.find((c) => c.category === "DbSchema");
  if (!template) return null;
  const taken = new Set(surface.items.map((i) => i.id.replace(/^DbSchema:/, "").toLowerCase()));
  const base =
    `DbSchema_${object.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "New"}`.slice(
      0,
      76
    );
  let developerName = base;
  for (let n = 2; taken.has(developerName.toLowerCase()); n++) developerName = `${base}_${n}`;
  return {
    kind: "create",
    label: `Add ${object} to iPad sync`,
    draft: {
      ...template,
      label: `Add ${object} to iPad sync`,
      developerName,
      recordLabel: `DbSchema ${object}`,
      fields: template.fields.map((f) => (f.name === "SObject" ? { ...f, value: object } : f)),
      profiles: [profile],
    },
  };
}
