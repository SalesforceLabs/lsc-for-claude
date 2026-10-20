import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { describeStep, emptyHistory, record, typing } from "../components/studio/tray-history";
import type { PendingChange } from "../components/studio/changes";
import { stillAwaiting } from "../components/studio/reach";
import { usePublishJob, type PublishJob } from "../components/studio/usePublishJob";
import type { StudioFix } from "../components/studio/types";
import { pendingCount, queueInto, stepBack, stepForward, trayKey, trayOf, updateTray, type OrgTray, type TrayMap } from "../components/studio/tray-state";
import { useSelectedOrgId } from "./useOrgs";

type SetState<T> = T | ((prev: T) => T);
const resolve = <T,>(next: SetState<T>, prev: T): T => (typeof next === "function" ? (next as (p: T) => T)(prev) : next);

export interface StudioTray {
  /** The selected org's tray (lowercased username). */
  org: string;
  pending: PendingChange[];
  /** Records a step in the history. */
  setPending: (next: PendingChange[]) => void;
  /** Starts the history over (after changes are applied). */
  reset: (next: PendingChange[]) => void;
  undo: () => void;
  redo: () => void;
  /** What ⌘Z would take back, or null when there's nothing to undo. */
  undoLabel: string | null;
  /** What ⇧⌘Z would put back, or null. */
  redoLabel: string | null;
  /** The undo of the last apply, offered as "Undo last apply" until the next apply. */
  lastApply: PendingChange[] | null;
  setLastApply: (next: PendingChange[] | null) => void;
  /** Applied and waiting for Publish to iPad; a finished publish drops what it covered. */
  awaiting: PendingChange[];
  setAwaiting: (next: SetState<PendingChange[]>) => void;
  /** Everything applied this session (undos too), for the source-control step. */
  appliedFixes: StudioFix[];
  setAppliedFixes: (next: SetState<StudioFix[]>) => void;
  /** Queues changes into any org's tray as one undoable step, merging by `changeKey`. */
  queue: (org: string, changes: PendingChange[]) => void;
  /** How many changes wait in an org's tray. */
  countFor: (org: string) => number;
  /** Any org's tray, read and written as a step in its history (chat cards for a session whose org isn't selected). */
  pendingFor: (org: string) => PendingChange[];
  setPendingFor: (org: string, next: PendingChange[]) => void;
  /** Changes one org's tray, for work that must stay with the org it began in (the review dialog). */
  editTray: (org: string, fn: (t: OrgTray) => OrgTray) => void;
  /** "Publish to iPad" as a job that keeps polling while Studio is closed; empty while another org's runs. */
  publishJob: PublishJob;
  /** Moves each time a publish of the selected org finishes, so Studio can drop what it shows of the published iPad. */
  publishDoneVersion: number;
}

const Ctx = createContext<StudioTray | null>(null);

/** One pending-changes tray per org, held above Studio so it survives leaving it and can receive changes from chat. */
export function StudioTrayProvider({ children }: { children: React.ReactNode }) {
  const selected = useSelectedOrgId();
  const org = trayKey(selected);
  const [trays, setTrays] = useState<TrayMap>({});

  const edit = useCallback((key: string, fn: Parameters<typeof updateTray>[2]) => setTrays((m) => updateTray(m, key, fn)), []);

  // Publishing belongs to the org it was started in, even if another is selected when it finishes; other orgs
  // see no job (so their bar doesn't show it, or offer its Retry).
  const jobOrg = useRef(org);
  const [jobOrgKey, setJobOrgKey] = useState(org);
  const [doneVersions, setDoneVersions] = useState<Record<string, number>>({});
  const job = usePublishJob(
    useCallback(
      (done: string[]) => {
        const key = jobOrg.current;
        edit(key, (t) => ({ ...t, awaiting: stillAwaiting(t.awaiting, done) }));
        setDoneVersions((v) => ({ ...v, [key]: (v[key] ?? 0) + 1 }));
      },
      [edit]
    )
  );
  const start = job.start;
  const publishJob = useMemo<PublishJob>(() => {
    const startHere: PublishJob["start"] = (profiles, jobOrgName) => {
      jobOrg.current = org;
      setJobOrgKey(org);
      return start(profiles, jobOrgName);
    };
    if (jobOrgKey === org) return { ...job, start: startHere };
    return { status: null, error: null, starting: false, last: null, lastStart: null, start: startHere, clear: () => {} };
  }, [job, start, org, jobOrgKey]);

  // Chat writes that map to a Studio change arrive here from the main process.
  useEffect(() => {
    if (!window.lscApi?.onTrayQueue) return;
    return window.lscApi.onTrayQueue((e) => {
      setTrays((m) => queueInto(m, e.org, e.changes as unknown as PendingChange[]));
    });
  }, []);

  const tray = trayOf(trays, org);
  const { past, present, future } = tray.history;

  // The setters keep their identity while the org stays the same, so effects can depend on them.
  const setPending = useCallback((next: PendingChange[]) => edit(org, (t) => ({ ...t, history: record(t.history, next) })), [edit, org]);
  const reset = useCallback((next: PendingChange[]) => edit(org, (t) => ({ ...t, history: emptyHistory(next) })), [edit, org]);
  const undo = useCallback(() => setTrays((m) => stepBack(m, org)), [org]);
  const redo = useCallback(() => setTrays((m) => stepForward(m, org)), [org]);
  const setLastApply = useCallback((next: PendingChange[] | null) => edit(org, (t) => ({ ...t, lastApply: next })), [edit, org]);
  const setAwaiting = useCallback((next: SetState<PendingChange[]>) => edit(org, (t) => ({ ...t, awaiting: resolve(next, t.awaiting) })), [edit, org]);
  const setAppliedFixes = useCallback((next: SetState<StudioFix[]>) => edit(org, (t) => ({ ...t, appliedFixes: resolve(next, t.appliedFixes) })), [edit, org]);
  const queue = useCallback((to: string, changes: PendingChange[]) => setTrays((m) => queueInto(m, to, changes)), []);
  const countFor = useCallback((of: string) => pendingCount(trays, of), [trays]);
  const editTray = useCallback((key: string, fn: (t: OrgTray) => OrgTray) => edit(key, fn), [edit]);
  const pendingFor = useCallback((of: string) => trayOf(trays, of).history.present, [trays]);
  const setPendingFor = useCallback((of: string, next: PendingChange[]) => edit(of, (t) => ({ ...t, history: record(t.history, next) })), [edit]);

  const value = useMemo<StudioTray>(
    () => ({
      org,
      pending: present,
      setPending,
      reset,
      undo,
      redo,
      undoLabel: past.length ? describeStep(past[past.length - 1], present) : null,
      redoLabel: future.length ? describeStep(present, future[0]) : null,
      lastApply: tray.lastApply,
      setLastApply,
      awaiting: tray.awaiting,
      setAwaiting,
      appliedFixes: tray.appliedFixes,
      setAppliedFixes,
      queue,
      countFor,
      pendingFor,
      setPendingFor,
      editTray,
      publishJob,
      publishDoneVersion: doneVersions[org] ?? 0,
    }),
    [org, past, present, future, tray.lastApply, tray.awaiting, tray.appliedFixes, setPending, reset, undo, redo, setLastApply, setAwaiting, setAppliedFixes, queue, countFor, pendingFor, setPendingFor, editTray, publishJob, doneVersions]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudioTray(): StudioTray {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStudioTray needs a StudioTrayProvider");
  return v;
}

/**
 * ⌘Z / ⇧⌘Z (Ctrl on Windows and Linux) step the tray anywhere except in a text field. Mounted by Studio, so
 * they only work while it is on screen; `paused` while a dialog is open.
 */
export function useTrayKeys(paused = false) {
  const { undo, redo } = useStudioTray();
  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z" || typing(e.target)) return;
      e.preventDefault();
      (e.shiftKey ? redo : undo)();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, undo, redo]);
}
