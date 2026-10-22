/**
 * LSC Mobile draws every inline LWC (lscMobileInline_*) in one shared web view:
 * LMRContext.createLWCInlineViewController hands each SFComponentInlineLWC the
 * same HybridContainer, and HybridViewController.takeOwnership (viewWillAppear)
 * moves the web view to whichever appears last. With two or more on a screen,
 * the last one on the page draws and the others are left empty at their full
 * height (SceneContainerView.yieldScene), or keep a still snapshot if they had
 * drawn before.
 */

/** One inline LWC drawn on the screen, in page order. */
export interface InlineSeat {
  id: string;
  name: string;
}

/** What the iPad does with one inline LWC on a screen that has several. */
export interface SeatStatus {
  /** True when this one gets the web view. */
  owner: boolean;
  /** The one that gets the web view. */
  ownerName: string;
  /** Every inline LWC on the screen, in page order. */
  names: string[];
}

/** Each seat's status, by id; empty when the screen has fewer than two. */
export function seatStatuses(seats: InlineSeat[]): Map<string, SeatStatus> {
  const out = new Map<string, SeatStatus>();
  if (seats.length < 2) return out;
  const owner = seats[seats.length - 1];
  const names = seats.map((s) => s.name);
  for (const s of seats) out.set(s.id, { owner: s === owner, ownerName: owner.name, names });
  return out;
}

/** The bundle name without its prefix, as the preview labels it: "nbc_msl". */
export const seatLabel = (name: string) => name.replace(/^lscMobileInline_/, "");

/** "nbc_msl and ThisWeekSVisits", "a, b and c". */
export function joinNames(names: string[]): string {
  const l = names.map(seatLabel);
  return l.length < 2 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
}
