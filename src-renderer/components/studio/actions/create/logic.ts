/** The record type chooser a new account starts with (AccountRecordTypeSelectorViewController.swift). */

export const BY_ID = "__searchById";

export interface ChooserCard {
  id: string;
  label: string;
  /** The line under the label (RecordTypeSelectorViewModel.RecordType.description). */
  description?: string;
  section: "type" | "license";
}

type Rt = { name: string; label: string };

const isOrg = (r: Rt) =>
  /organi[sz]ation|\bhco\b|hospital|clinic|pharmacy/i.test(`${r.label} ${r.name}`);

/** The record type a card stands for: HCP is the provider type (else the first person type), HCO the first organization type. */
function typeFor(id: string, recordTypes: Rt[]): number {
  if (id === "HCO") return recordTypes.findIndex(isOrg);
  const people = recordTypes.map((r, i) => ({ r, i })).filter((x) => !isOrg(x.r));
  return (
    (people.find((x) => /provider|\bhcp\b/i.test(`${x.r.label} ${x.r.name}`)) ?? people[0])?.i ?? -1
  );
}

/**
 * The cards under "Search by account type" (the device shows HCP and HCO, each with a search line), then the By ID
 * card under "Search by License" (AccountRecordTypeSelectorViewController.swift:161 and :185-216; the By ID section
 * only shows when the org has search by ID on, which the device in the demo org did). An org whose record types
 * aren't both person and organization gets one card per record type.
 */
export function chooserCards(recordTypes: Rt[], searchById = true): ChooserCard[] {
  const grouped = recordTypes.some(isOrg) && recordTypes.some((r) => !isOrg(r));
  const cards: ChooserCard[] = grouped
    ? [
        {
          id: "HCP",
          label: "HCP",
          description: "Search Healthcare Professional (HCP) Accounts",
          section: "type",
        },
        {
          id: "HCO",
          label: "HCO",
          description: "Search Healthcare Organization (HCO) Accounts",
          section: "type",
        },
      ]
    : recordTypes.map((r) => ({ id: r.name, label: r.label, section: "type" as const }));
  if (searchById)
    cards.push({
      id: BY_ID,
      label: "By ID",
      description: "Search Business Licenses",
      section: "license",
    });
  return cards;
}

/** Next stays off until a card is chosen (AccountRecordTypeSelectorViewController.swift:108-110). */
export function nextEnabled(selected: string | null): boolean {
  return selected !== null;
}

/** Where Next goes: the form of the chosen record type, or the license lookup Studio can't run. */
export function nextStep(
  selected: string | null,
  recordTypes: Rt[]
): { to: "form"; index: number } | { to: "byId" } | null {
  if (selected === null) return null;
  if (selected === BY_ID) return { to: "byId" };
  let index = recordTypes.findIndex((r) => r.name === selected);
  if (index < 0 && (selected === "HCP" || selected === "HCO"))
    index = typeFor(selected, recordTypes);
  return index < 0 ? null : { to: "form", index };
}
