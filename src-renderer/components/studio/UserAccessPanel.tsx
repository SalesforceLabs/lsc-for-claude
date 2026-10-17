import React, { useEffect, useMemo, useState } from "react";
import type { AccessOptions, AccessRef, StudioFix, StudioItem, UserAccess } from "./types";
import type { PendingChange } from "./changes";

interface UserAccessPanelProps {
  user: { id: string; name: string };
  /** Other users in the surface, for "Give same access as…". */
  others: { id: string; name: string }[];
  pending: PendingChange[];
  onQueue: (changes: PendingChange[]) => void;
  /** Changes when the map is reloaded, so the panel re-reads the user's access. */
  refreshKey: string;
}

type Kind = AccessRef["type"];

const SECTIONS: { type: Kind; title: string; empty: string }[] = [
  { type: "permissionSet", title: "Permission sets", empty: "None" },
  { type: "permissionSetGroup", title: "Permission set groups", empty: "None" },
  { type: "territory", title: "Territories", empty: "No territory — this user sees no aligned accounts" },
];

function responseError(res: { data?: unknown; error?: string }): string | undefined {
  return res.error || (res.data as { error?: string } | undefined)?.error;
}

const refKey = (a: { type: string; id: string }) => `${a.type}:${a.id}`;

/** A user's permission sets, groups, and territories — added and removed through pending changes. */
export default function UserAccessPanel({ user, others, pending, onQueue, refreshKey }: UserAccessPanelProps) {
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [options, setOptions] = useState<AccessOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [copying, setCopying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    setError(null);
    setNote(null);
    Promise.all([window.lscApi.studioUserAccess(user.id), window.lscApi.studioAccessOptions()]).then(([a, o]) => {
      if (cancelled) return;
      const err = responseError(a) || responseError(o);
      if (err) setError(err);
      else {
        setAccess(a.data as UserAccess);
        setOptions(o.data as AccessOptions);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user.id, refreshKey]);

  // This user's queued access changes, by thing.
  const queued = useMemo(() => {
    const m = new Map<string, Extract<StudioFix, { kind: "assignAccess" | "removeAccess" }>>();
    for (const p of pending) {
      if ((p.fix.kind === "assignAccess" || p.fix.kind === "removeAccess") && p.fix.userId === user.id) m.set(refKey(p.fix.access), p.fix);
    }
    return m;
  }, [pending, user.id]);

  if (error) {
    return (
      <div className="studio-finding error">
        <div className="studio-finding-title">Couldn't load this user's access</div>
        <div className="studio-finding-detail">{error}</div>
      </div>
    );
  }
  if (!access || !options) return <div className="studio-empty-note">Loading access…</div>;

  const held = new Set(access.access.map(refKey));
  const licensesQueued = pending.flatMap((p) => (p.fix.kind === "assignPsl" && p.fix.userId === user.id ? [p.fix] : []));
  const give = (ref: AccessRef): PendingChange => ({
    fix: { kind: "assignAccess", label: `Give ${ref.label} to ${user.name}`, userId: user.id, userName: user.name, access: ref },
  });
  const take = (ref: AccessRef & { assignmentId: string }): PendingChange => ({
    fix: { kind: "removeAccess", label: `Remove ${ref.label} from ${user.name}`, userId: user.id, userName: user.name, access: ref, assignmentId: ref.assignmentId },
  });
  // Queuing the opposite of a queued change cancels it out (see queueChange).
  const undoQueued = (ref: AccessRef) => {
    const q = queued.get(refKey(ref))!;
    const assignmentId = access.access.find((a) => refKey(a) === refKey(ref))?.assignmentId ?? "";
    onQueue([q.kind === "assignAccess" ? take({ ...ref, assignmentId }) : give(ref)]);
  };

  const optionsFor = (type: Kind): AccessRef[] =>
    type === "permissionSet" ? options.permissionSets : type === "permissionSetGroup" ? options.permissionSetGroups : options.territories;

  const sameAs = async (otherId: string) => {
    const other = others.find((o) => o.id === otherId);
    if (!other) return;
    setCopying(false);
    setNote("Reading their access…");
    const res = await window.lscApi.studioUserAccess(otherId);
    const err = responseError(res);
    if (err) return setNote(`Couldn't read ${other.name}'s access: ${err}`);
    const theirs = res.data as UserAccess;
    const mine = new Set(access.licenses.map((l) => l.pslId));
    // Licenses first — permission sets that need one are refused without it.
    const licenses: PendingChange[] = theirs.licenses
      .filter((l) => !mine.has(l.pslId))
      .map((l) => ({
        fix: { kind: "assignPsl", label: `Assign ${l.label} to ${user.name}`, userId: user.id, userName: user.name, pslId: l.pslId, pslLabel: l.label },
      }));
    const missing = theirs.access.filter((a) => !held.has(refKey(a)) && queued.get(refKey(a))?.kind !== "assignAccess");
    const extra = access.access.filter((a) => !theirs.access.some((t) => refKey(t) === refKey(a)));
    const changes = [...licenses, ...missing.map(({ assignmentId: _id, ...ref }) => give(ref))];
    if (changes.length) onQueue(changes);
    setNote(
      [
        changes.length
          ? `Added ${changes.length} ${changes.length === 1 ? "change" : "changes"} to pending to match ${other.name}.`
          : `${user.name} already has everything ${other.name} has.`,
        extra.length ? `${user.name} keeps ${extra.length} ${extra.length === 1 ? "thing" : "things"} ${other.name} doesn't have (${extra.slice(0, 5).map((e) => e.label).join(", ")}${extra.length > 5 ? `, +${extra.length - 5} more` : ""}).` : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  };

  return (
    <div className="studio-edit studio-access">
      <div className="studio-edit-block">
        <span className="studio-edit-label">Permission set licenses</span>
        <div className="studio-chips">
          {access.licenses.length + licensesQueued.length === 0 && <span className="studio-edit-value">None</span>}
          {access.licenses.map((l) => (
            <span key={l.pslId} className="studio-chip">
              {l.label}
            </span>
          ))}
          {licensesQueued.map((l) => (
            <span key={l.pslId} className="studio-chip adding">
              + {l.pslLabel}
            </span>
          ))}
        </div>
      </div>

      {SECTIONS.map((s) => {
        const current = access.access.filter((a) => a.type === s.type);
        const additions = [...queued.values()].filter((q) => q.kind === "assignAccess" && q.access.type === s.type).map((q) => q.access);
        return (
          <div key={s.type} className="studio-edit-block">
            <div className="studio-edit-row">
              <span className="studio-edit-label">{s.title}</span>
              <button className="studio-link-btn studio-edit-action" onClick={() => setAdding(adding === s.type ? null : s.type)}>
                {adding === s.type ? "Done" : "+ Add"}
              </button>
            </div>
            <div className="studio-chips">
              {current.length + additions.length === 0 && <span className="studio-edit-value">{s.empty}</span>}
              {current.map((a) => {
                const removing = queued.get(refKey(a))?.kind === "removeAccess";
                return (
                  <span key={a.id} className={`studio-chip${removing ? " removing" : ""}`}>
                    {a.label}
                    <button
                      className="studio-chip-x"
                      title={removing ? "Keep" : `Remove from ${user.name}`}
                      onClick={() => (removing ? undoQueued(a) : onQueue([take(a)]))}
                    >
                      {removing ? "↺" : "×"}
                    </button>
                  </span>
                );
              })}
              {additions.map((a) => (
                <span key={a.id} className="studio-chip adding">
                  + {a.label}
                  <button className="studio-chip-x" title="Don't add" onClick={() => undoQueued(a)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            {adding === s.type && (
              <AccessPicker
                options={optionsFor(s.type).filter((o) => !held.has(refKey(o)) && !queued.has(refKey(o)))}
                onPick={(ref) => onQueue([give(ref)])}
              />
            )}
          </div>
        );
      })}

      {others.length > 0 && (
        <div className="studio-edit-block">
          {copying ? (
            <select className="studio-input" defaultValue="" onChange={(e) => sameAs(e.target.value)}>
              <option value="" disabled>
                Give {user.name} the same access as…
              </option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <button className="studio-link-btn" onClick={() => setCopying(true)}>
              Give same access as…
            </button>
          )}
          {note && <div className="studio-edit-note">{note}</div>}
        </div>
      )}
    </div>
  );
}

const PICKER_ROWS = 50;

function AccessPicker({ options, onPick }: { options: AccessRef[]; onPick: (ref: AccessRef) => void }) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  // Territories in the active model first — those are the ones that give accounts today.
  const rows = options
    .filter((o) => !q || `${o.label} ${(o as { model?: string }).model ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number(!!(a as { planning?: boolean }).planning) - Number(!!(b as { planning?: boolean }).planning));
  return (
    <div className="studio-picker">
      <input className="studio-filter" placeholder={`Filter ${options.length}…`} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      <ul className="studio-picker-list">
        {rows.slice(0, PICKER_ROWS).map((o) => {
          const t = o as AccessRef & { model?: string; planning?: boolean };
          return (
            <li key={o.id}>
              <button className="studio-picker-row studio-picker-pick" onClick={() => onPick(o)}>
                <span className="studio-picker-name">{o.label}</span>
                {t.model !== undefined && <span className="studio-picker-meta">{t.planning ? `${t.model} (not active)` : t.model}</span>}
              </button>
            </li>
          );
        })}
        {rows.length > PICKER_ROWS && <li className="studio-picker-more">{rows.length - PICKER_ROWS} more — keep typing to narrow</li>}
        {rows.length === 0 && <li className="studio-picker-more">Nothing matches</li>}
      </ul>
    </div>
  );
}
