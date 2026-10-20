import React, { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { joinNames, seatLabel, seatStatuses, type SeatStatus } from "./inline-lwc-seats";

/**
 * Which inline LWC gets the iPad's one web view on the screen drawn now (see
 * inline-lwc-seats.ts). Each slot registers its element; page order is read
 * from the DOM, so Home, nav tab and record pages, the selected record tab and
 * Draft's arrangement all count the same way. Removed blocks (Draft ghosts)
 * don't count.
 */

class SeatRegistry {
  private seats = new Map<string, { name: string; el: HTMLElement }>();
  private listeners = new Set<() => void>();
  private statuses = new Map<string, SeatStatus>();
  private signature = "";
  private queued = false;

  set(id: string, name: string, el: HTMLElement) {
    this.seats.set(id, { name, el });
    this.schedule();
  }

  remove(id: string) {
    this.seats.delete(id);
    this.schedule();
  }

  /** Recompute after this render's layout effects, notifying only when the order changed. */
  schedule() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      const list = [...this.seats]
        .filter(([, s]) => s.el.isConnected && !s.el.closest(".ghost"))
        .sort(([, a], [, b]) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map(([id, s]) => ({ id, name: s.name }));
      const signature = list.map((s) => `${s.id}=${s.name}`).join("|");
      if (signature === this.signature) return;
      this.signature = signature;
      this.statuses = seatStatuses(list);
      this.listeners.forEach((l) => l());
    });
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  get = (id: string) => this.statuses.get(id);
}

const SeatsContext = createContext<SeatRegistry | null>(null);

/** Wraps one iPad screen; Compare draws two, each with its own. */
export function InlineSeatsProvider({ children }: { children: React.ReactNode }) {
  const registry = useMemo(() => new SeatRegistry(), []);
  return <SeatsContext.Provider value={registry}>{children}</SeatsContext.Provider>;
}

const none = () => () => {};

function useInlineSeat(name: string): [(el: HTMLElement | null) => void, SeatStatus | undefined] {
  const registry = useContext(SeatsContext);
  const id = useId();
  const [el, setEl] = useState<HTMLElement | null>(null);
  const status = useSyncExternalStore(registry?.subscribe ?? none, () => registry?.get(id));
  useLayoutEffect(() => {
    if (!registry || !el) return;
    registry.set(id, name, el);
    return () => registry.remove(id);
  }, [registry, id, name, el]);
  // Draft can reorder blocks without remounting them: check the order again after every render.
  useLayoutEffect(() => registry?.schedule());
  return [useCallback((e: HTMLElement | null) => setEl(e), []), status];
}

/**
 * An inline LWC slot on the iPad screen. When another inline LWC on the screen
 * gets the web view, the component is still drawn, dimmed, under Studio's note
 * saying the iPad leaves it blank; the one that gets it carries a shorter note.
 */
export function InlineSeat({ name, height, children }: { name: string; height: number; children: React.ReactNode }) {
  const [ref, seat] = useInlineSeat(name);
  return (
    <div ref={ref} className="studio-ipad-inline-seat">
      {seat && !seat.owner ? (
        <>
          <div className="studio-ipad-rec-offline studio-ipad-inline-blank">
            <p>
              <strong>Blank on the iPad.</strong> LSC Mobile shows only one inline LWC on a screen, and this one has {seat.names.length}: {joinNames(seat.names)}.
              The last one on the page, {seatLabel(seat.ownerName)}, takes it, so reps see an empty area {height} pt tall where {seatLabel(name)} is drawn below.
              If it had already drawn, it keeps a still picture of what it showed, and taps on it do nothing.
            </p>
            <p>To show {seatLabel(name)}, keep one inline LWC on this page: remove the others, or combine them into one component.</p>
          </div>
          <div className="studio-ipad-inline-dimmed">{children}</div>
        </>
      ) : (
        children
      )}
      {seat?.owner && (
        <div className="studio-ipad-rec-offline studio-ipad-inline-owner">
          <p>
            <strong>Only this inline LWC shows on the iPad.</strong> LSC Mobile shows one inline LWC on a screen, and the last one on the page takes it.{" "}
            {joinNames(seat.names.filter((n, i) => i !== seat.names.length - 1))} {seat.names.length > 2 ? "are" : "is"} left blank.
          </p>
        </div>
      )}
    </div>
  );
}
