import { useMemo } from "react";
import { useVisit } from "../draft";
import { buildSections, hcoOff, productsFor, type LayoutRelated, type Section } from "./logic";
import type { VisitSections } from "./types";

/** What the sections stream reads when the collector gave nothing: no settings, nothing to pick from. */
export const NO_SECTIONS: VisitSections = {
  settings: {
    showRecentSidebar: false,
    discussOffLabelProducts: false,
    hcoTypesForSamplesAndItems: [],
    requireBatchNumber: false,
    showExpiredBatches: false,
    validateSampleLimits: false,
    nextVisitObjectives: "None",
  },
  permissions: {},
  products: [],
  messages: [],
  inventory: { items: [], batches: [] },
  attendeePool: [],
  children: {},
  gates: { files: false, visitors: false },
};

/** The visit's account: the one picked in the header, else the record page it was opened from, else (an edit) the synced account of that name. */
export function useVisitAccountId(): string | undefined {
  const { snapshot, sheet, editId, draft } = useVisit();
  return useMemo(() => {
    if (draft.values.AccountId) return draft.values.AccountId;
    if (sheet.record?.object === "Account") return sheet.record.id;
    const existing = editId ? snapshot.records?.byId[editId] : undefined;
    const home = editId
      ? snapshot.screens?.home?.visits?.items.find((v) => v.id === editId)
      : undefined;
    const name = home?.account ?? existing?.values.Visit?.accountid;
    return name
      ? Object.entries(snapshot.records?.byId ?? {}).find(
          ([, r]) => r.object === "Account" && r.title === name
        )?.[0]
      : undefined;
  }, [snapshot, sheet.record, editId, draft.values.AccountId]);
}

/** The sidebar's sections for the visit being edited, with the data they read. */
export function useVisitSections(organisation?: boolean): {
  data: VisitSections;
  sections: Section[];
  accountId: string | undefined;
  childVisit: boolean;
} {
  const { snapshot, layouts, draft } = useVisit();
  const data = snapshot.screens?.visit?.sections ?? NO_SECTIONS;
  const accountId = useVisitAccountId();
  // The editor only tells the sidebar; the related sections work it out the same way.
  const org =
    organisation ??
    (accountId
      ? snapshot.screens?.fabs?.visitCreate?.accounts[accountId]?.person === false
      : false);
  const childVisit = false; // the editor opens parent visits; an attendee's own page is the structure stream's carousel
  const related: LayoutRelated[] = useMemo(
    () => layouts.flatMap((l) => l.relatedLists.map((r) => ({ name: r.name, label: r.label }))),
    [layouts]
  );
  const sections = useMemo(
    () =>
      buildSections({
        related,
        permissions: data.permissions,
        childVisit,
        hcoOff: hcoOff(org, draft.recordTypeName, data.settings),
        hasOptions: {
          samples: data.inventory.items.length > 0,
          dtp: productsFor("dtp", data.products).length > 0,
          items: productsFor("item", data.products).length > 0,
        },
      }),
    [related, data, org, draft.recordTypeName, childVisit]
  );
  return { data, sections, accountId, childVisit };
}
