import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Database,
  FilterX,
  LayoutGrid,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Undo2,
  UsersRound,
  X,
} from "lucide-react";
import StateView from "../ui/StateView";
import StatusIcon, { type StatusTone } from "../ui/StatusIcon";
import Spinner from "../ui/Spinner";
import Segmented from "../ui/Segmented";
import UpdatedAgo from "../ui/UpdatedAgo";
import { LIST_LIMIT } from "../ui/Limited";
import CreateDialog from "./CreateDialog";
import ProfilePicker from "./ProfilePicker";
import { changeKey, createAffects, queueChange, type PendingChange } from "./changes";
import type { CreateConfigFix, ProfileOption, StudioFinding } from "./types";
import type { CheckState, FilterCheckResponse, FilterCheckResult, ObjectSyncOverview } from "./object-sync-types";
import {
  ATTACHMENT_OPTIONS,
  CHECK_TEXT,
  EDITED_FIELDS,
  FIELD_LABELS,
  NO_FILTERS,
  activeChanges,
  deleteChanges,
  dropCreates,
  dropDelete,
  duplicateDraft,
  fieldChange,
  fieldValue,
  filterRows,
  hasField,
  hasProblems,
  newDraft,
  profileChanges,
  profileNames,
  statusPill,
  typeCounts,
  typeText,
  viewRows,
  type Filters,
  type TypeFilter,
  type ViewRow,
} from "./object-sync-logic";
import "./object-sync.css";

interface Props {
  /** Bumped after every apply, to read the records again. */
  version: number;
  pending: PendingChange[];
  onPendingChange: (next: PendingChange[]) => void;
  profiles: ProfileOption[];
  /** The org the records were read from, so the review dialog can apply changes before any map is loaded. */
  onOrgSeen: (org: string) => void;
  /** Open the record on Mobile Sync's board. */
  onOpenBoard: (surface: string, item: string) => void;
}

type Load =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: ObjectSyncOverview; cachedAt: string | null };

/** Checks are sent in groups this size, so a long run shows how far it got. */
const CHECK_BATCH = 40;

const CHECK_TONE: Record<CheckState, StatusTone> = { pass: "pass", warn: "warning", fail: "error", skipped: "skipped" };

/**
 * Object sync — the Admin Console's Object Metadata Cache Configuration (every DB Schema record:
 * which objects LSC Mobile syncs, with which filter, to whom) as a table. Changes are queued in
 * the tray; "Check filters" test-runs records read-only. Data: `studio_object_sync*`
 * (src/studio/object-sync.ts).
 */
export default function ObjectSyncView({ version, pending, onPendingChange, profiles, onOrgSeen, onOpenBoard }: Props) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openName, setOpenName] = useState<string | null>(null);
  const [checks, setChecks] = useState<Map<string, FilterCheckResult>>(new Map());
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ draft: CreateConfigFix; replacing?: CreateConfigFix } | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [limit, setLimit] = useState(LIST_LIMIT);
  const ticket = useRef(0);

  const fetchRows = useCallback(async () => {
    const mine = ++ticket.current;
    setRefreshing(true);
    const res = await window.lscApi.studioObjectSync();
    if (ticket.current !== mine) return;
    setRefreshing(false);
    if (res.error || !res.data) {
      setLoad((l) => (l.status === "ready" ? l : { status: "error", error: res.error || "Studio couldn't read the DB Schema records." }));
      return;
    }
    const data = res.data as ObjectSyncOverview;
    onOrgSeen(data.org);
    setLoad({ status: "ready", data, cachedAt: res.cachedAt ?? new Date().toISOString() });
  }, [onOrgSeen]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows, version]);

  const retry = () => {
    setLoad({ status: "loading" });
    fetchRows();
  };

  const data = load.status === "ready" ? load.data : null;
  const all = useMemo(() => (data ? viewRows(data.rows, pending) : []), [data, pending]);
  const shown = useMemo(() => filterRows(all, filters, checks), [all, filters, checks]);
  const counts = useMemo(() => typeCounts(all), [all]);
  const assignedNames = useMemo(() => profileNames(all), [all]);
  const chosen = all.filter((v) => selected.has(v.row.developerName));
  const open = all.find((v) => v.row.developerName === openName) ?? null;

  // Rows that disappear (deleted after an apply, a create taken out of the tray) leave the selection.
  useEffect(() => {
    const names = new Set(all.map((v) => v.row.developerName));
    setSelected((s) => (Array.from(s).every((n) => names.has(n)) ? s : new Set(Array.from(s).filter((n) => names.has(n)))));
    if (openName && !names.has(openName)) setOpenName(null);
  }, [all, openName]);

  const queueAll = (changes: PendingChange[]) => onPendingChange(changes.reduce((acc, c) => queueChange(acc, c), pending));

  const runChecks = async (rows: ViewRow[]) => {
    const names = rows.filter((v) => !v.created).map((v) => v.row.developerName);
    if (!names.length || checking) return;
    setCheckError(null);
    setChecking({ done: 0, total: names.length });
    for (let i = 0; i < names.length; i += CHECK_BATCH) {
      const res = await window.lscApi.studioObjectSyncCheck(names.slice(i, i + CHECK_BATCH));
      if (res.error || !res.data) {
        setCheckError(res.error || "Studio couldn't check the filters.");
        break;
      }
      const { results } = res.data as FilterCheckResponse;
      setChecks((m) => {
        const next = new Map(m);
        for (const r of results) next.set(r.developerName, r);
        return next;
      });
      setChecking({ done: Math.min(i + CHECK_BATCH, names.length), total: names.length });
    }
    setChecking(null);
  };

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const allShownSelected = shown.length > 0 && shown.every((v) => selected.has(v.row.developerName));
  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s);
      for (const v of shown) {
        if (allShownSelected) next.delete(v.row.developerName);
        else next.add(v.row.developerName);
      }
      return next;
    });

  const removeSelected = () => {
    onPendingChange(deleteChanges(chosen).reduce((acc, c) => queueChange(acc, c), dropCreates(pending, chosen)));
    setSelected(new Set());
  };

  const openCreate = (draft: CreateConfigFix) => {
    const queued = pending.find((p) => changeKey(p.fix) === changeKey(draft))?.fix;
    setCreating(queued?.kind === "createConfigRecord" ? { draft: queued, replacing: queued } : { draft });
  };
  const queueCreate = (fix: CreateConfigFix) => {
    const old = creating?.replacing;
    const rest = old && changeKey(old) !== changeKey(fix) ? pending.filter((p) => changeKey(p.fix) !== changeKey(old)) : pending;
    onPendingChange(queueChange(rest, { fix, affects: createAffects(fix) }));
    setCreating(null);
    setOpenName(fix.developerName);
  };

  const filtered = filters.search.trim() !== "" || filters.type !== "all" || !!filters.profile || filters.problemsOnly;
  const problems = all.filter((v) => hasProblems(v, checks.get(v.row.developerName))).length;

  let body: React.ReactNode;
  if (load.status === "loading") {
    body = <StateView kind="loading" title="Reading DB Schema records…" />;
  } else if (load.status === "error") {
    body = (
      <StateView
        kind="error"
        title="Couldn't read the DB Schema records"
        detail={load.error}
        actions={
          <button type="button" className="studio-btn" onClick={retry}>
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </button>
        }
      />
    );
  } else if (all.length === 0) {
    body = (
      <StateView
        kind="empty"
        icon={Database}
        title="No DB Schema records"
        detail="Without them LSC Mobile syncs no objects. Add one for each object reps need offline."
        actions={
          <button type="button" className="studio-btn primary" onClick={() => openCreate(newDraft())}>
            <Plus size={14} aria-hidden="true" />
            New record…
          </button>
        }
      />
    );
  } else if (shown.length === 0) {
    body = (
      <StateView
        kind="empty"
        icon={FilterX}
        title="No records match"
        detail="Try another search or clear the filters."
        actions={
          <button type="button" className="studio-btn" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        }
      />
    );
  } else {
    body = (
      <div className="objsync-table-wrap">
        <table className={`objsync-table${open ? " compact" : ""}`}>
          <thead>
            <tr>
              <th className="objsync-col-check">
                <input type="checkbox" aria-label="Select all shown" checked={allShownSelected} onChange={toggleAll} />
              </th>
              <th className="objsync-col-name">Name</th>
              <th className="objsync-col-object">Object</th>
              <th className="objsync-col-active">Active</th>
              <th className="objsync-col-type">Type</th>
              <th className="objsync-col-who">Who</th>
              <th className="objsync-col-filter">Filter</th>
              <th className="objsync-col-status">Status</th>
              <th className="objsync-col-problems">
                <span className="sr-only">Problems</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((v) => (
              <RecordRow
                key={v.row.developerName}
                v={v}
                check={checks.get(v.row.developerName)}
                selected={selected.has(v.row.developerName)}
                open={openName === v.row.developerName}
                onToggle={() => toggle(v.row.developerName)}
                onOpen={() => setOpenName(openName === v.row.developerName ? null : v.row.developerName)}
              />
            ))}
          </tbody>
        </table>
        {shown.length > limit && (
          <div className="ui-show-more">
            <button type="button" className="studio-link-btn" onClick={() => setLimit((n) => n + LIST_LIMIT)}>
              Show {Math.min(shown.length - limit, LIST_LIMIT).toLocaleString("en-US")} more
              <span className="ui-show-more-total"> ({(shown.length - limit).toLocaleString("en-US")} hidden)</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  const checkLabel = chosen.length ? `Check ${chosen.length} ${chosen.length === 1 ? "filter" : "filters"}` : "Check all shown";

  return (
    <>
      <header className="studio-header">
        <div className="studio-heading">
          <h1 className="studio-title">Object sync</h1>
          <div
            className="studio-subtitle"
            title="DB Schema records — the Admin Console's Mobile › Object Metadata Cache Configuration. They decide which objects and records LSC Mobile downloads, for whom."
          >
            {data
              ? `${all.length} DB Schema ${all.length === 1 ? "record" : "records"}${problems ? ` · ${problems} with problems` : ""} · the Admin Console's Object Metadata Cache Configuration`
              : "DB Schema records — the Admin Console's Object Metadata Cache Configuration"}
          </div>
        </div>
        <div className="studio-header-actions">
          {load.status === "ready" && load.cachedAt && <UpdatedAgo at={load.cachedAt} />}
          <button type="button" className="ui-icon-btn" onClick={fetchRows} disabled={refreshing} title="Read the records again" aria-label="Read the records again">
            {refreshing && load.status === "ready" ? <Spinner size={14} /> : <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />}
          </button>
          <button type="button" className="studio-btn primary collapsible" onClick={() => openCreate(newDraft())} disabled={!data} title="New DB Schema record">
            <Plus size={14} aria-hidden="true" />
            <span className="studio-btn-label">New record…</span>
          </button>
        </div>
      </header>

      {data && all.length > 0 && (
        <div className="studio-subbar objsync-subbar">
          {chosen.length > 0 ? (
            <div className="studio-subbar-group objsync-bulk">
              <span className="objsync-selected">{chosen.length} selected</span>
              <button type="button" className="studio-btn sm" onClick={() => setAssigning(true)}>
                <UsersRound size={14} aria-hidden="true" />
                Profiles…
              </button>
              <button type="button" className="studio-btn sm" onClick={() => queueAll(activeChanges(chosen, true))}>
                <Power size={14} aria-hidden="true" />
                Activate
              </button>
              <button type="button" className="studio-btn sm" onClick={() => queueAll(activeChanges(chosen, false))}>
                <PowerOff size={14} aria-hidden="true" />
                Deactivate
              </button>
              <button type="button" className="studio-btn sm danger" onClick={removeSelected}>
                <Trash2 size={14} aria-hidden="true" />
                Delete
              </button>
              <button type="button" className="studio-btn sm ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          ) : (
            <div className="studio-subbar-group objsync-filters">
              <input
                className="studio-input objsync-search"
                type="search"
                aria-label="Search records"
                placeholder="Search name, object or filter"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
              <Segmented<TypeFilter>
                aria-label="Record type"
                size="sm"
                value={filters.type}
                onChange={(type) => setFilters({ ...filters, type })}
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "DATA", label: "Data", count: counts.DATA },
                  { value: "CONFIGURATION", label: "Configuration", count: counts.CONFIGURATION },
                ]}
              />
              <select
                className="studio-select objsync-profile"
                aria-label="Profile"
                value={filters.profile ?? ""}
                onChange={(e) => setFilters({ ...filters, profile: e.target.value || null })}
              >
                <option value="">Every profile</option>
                {assignedNames.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label className="ui-check">
                <input type="checkbox" checked={filters.problemsOnly} onChange={(e) => setFilters({ ...filters, problemsOnly: e.target.checked })} />
                Problems only
              </label>
            </div>
          )}
          <div className="studio-subbar-group">
            {checking && (
              <span className="objsync-progress">
                <Spinner size={12} />
                Checked {checking.done} of {checking.total}
              </span>
            )}
            {checkError && !checking && <span className="ui-pill error" title={checkError}>Check stopped</span>}
            <button
              type="button"
              className="studio-btn sm"
              onClick={() => runChecks(chosen.length ? chosen : shown)}
              disabled={!!checking}
              title="Test-run each record's object, fields and filter against the org. Read-only: the Admin Console's Status isn't changed."
            >
              <ShieldCheck size={14} aria-hidden="true" />
              {checkLabel}
            </button>
          </div>
        </div>
      )}

      <div className="studio-stage">
        <div className={`studio-canvas objsync-canvas${filtered ? " filtered" : ""}`}>{body}</div>
        {open && (
          <RecordPanel
            key={open.row.developerName}
            v={open}
            check={checks.get(open.row.developerName)}
            checking={!!checking}
            pending={pending}
            profiles={profiles}
            onPendingChange={onPendingChange}
            onClose={() => setOpenName(null)}
            onCheck={() => runChecks([open])}
            onDuplicate={() => openCreate(duplicateDraft(open.row))}
            onEditCreate={(fix) => setCreating({ draft: fix, replacing: fix })}
            onOpenBoard={() => onOpenBoard(open.active ? "syncedObjects" : "disabledObjects", `DbSchema:${open.row.developerName}`)}
          />
        )}
      </div>

      {creating && data && (
        <CreateDialog draft={creating.draft} objects={data.objects} profiles={profiles} onCancel={() => setCreating(null)} onQueue={queueCreate} />
      )}
      {assigning && (
        <AssignDialog
          rows={chosen}
          profiles={profiles}
          onCancel={() => setAssigning(false)}
          onQueue={(changes) => {
            queueAll(changes);
            setAssigning(false);
          }}
        />
      )}
    </>
  );
}

// --- Table row ------------------------------------------------------------------

function worstTone(findings: StudioFinding[], check?: FilterCheckResult): StatusTone | null {
  if (findings.some((f) => f.severity === "error") || check?.state === "fail") return "error";
  if (findings.some((f) => f.severity === "warning") || check?.state === "warn") return "warning";
  if (check?.state === "pass") return "pass";
  return null;
}

function problemTitle(findings: StudioFinding[], check?: FilterCheckResult): string {
  const lines = findings.filter((f) => f.severity === "error" || f.severity === "warning").map((f) => f.title);
  if (check) {
    const bad = check.parts.filter((p) => p.state === "fail" || p.state === "warn");
    lines.push(...(bad.length ? bad.map((p) => `${p.name}: ${p.detail}`) : [CHECK_TEXT[check.state]]));
  }
  return lines.join("\n");
}

function RecordRow({
  v,
  check,
  selected,
  open,
  onToggle,
  onOpen,
}: {
  v: ViewRow;
  check?: FilterCheckResult;
  selected: boolean;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { row } = v;
  const pill = statusPill(row.status);
  const tone = worstTone(row.findings, check);
  const who = row.orgLevel ? "Everyone" : v.profiles.length ? v.profiles.join(", ") : row.permissionSets.length ? `${row.permissionSets.length} permission sets` : "No one";
  return (
    <tr
      className={`objsync-row${open ? " open" : ""}${v.deleting ? " deleting" : ""}${v.created ? " created" : ""}`}
      aria-selected={open}
      onClick={onOpen}
    >
      <td className="objsync-col-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" aria-label={`Select ${row.label}`} checked={selected} onChange={onToggle} />
      </td>
      <td className="objsync-col-name objsync-name" title={`${row.label}\n${row.developerName}`}>
        <span className="objsync-label">{row.label}</span>
        {v.created ? <span className="ui-pill info">New</span> : v.deleting ? <span className="ui-pill error">Deleting</span> : v.queued > 0 && <span className="ui-pill warning">Pending</span>}
      </td>
      <td className="objsync-col-object mono" title={row.sobject ?? undefined}>
        {row.sobject ?? <span className="objsync-muted">{row.type?.toUpperCase() === "CONFIGURATION" ? "Admin Console" : "None"}</span>}
      </td>
      <td className="objsync-col-active">
        {v.active ? <Check size={16} aria-label="Active" /> : <span className="objsync-muted">Off</span>}
      </td>
      <td className="objsync-col-type">{typeText(row.type)}</td>
      <td className="objsync-col-who" title={who}>
        <span className={row.orgLevel || v.profiles.length ? undefined : "objsync-muted"}>{who}</span>
      </td>
      <td className="objsync-col-filter mono" title={v.whereSoql ?? "No filter"}>
        {v.whereSoql ?? <span className="objsync-muted">None</span>}
      </td>
      <td>{pill.tone ? <span className={`ui-pill ${pill.tone}`}>{pill.text}</span> : <span className="objsync-muted">{pill.text}</span>}</td>
      <td className="objsync-col-problems" title={tone ? problemTitle(row.findings, check) : undefined}>
        {tone && <StatusIcon tone={tone} size={18} />}
      </td>
    </tr>
  );
}

// --- Detail panel ---------------------------------------------------------------

function RecordPanel({
  v,
  check,
  checking,
  pending,
  profiles,
  onPendingChange,
  onClose,
  onCheck,
  onDuplicate,
  onEditCreate,
  onOpenBoard,
}: {
  v: ViewRow;
  check?: FilterCheckResult;
  checking: boolean;
  pending: PendingChange[];
  profiles: ProfileOption[];
  onPendingChange: (next: PendingChange[]) => void;
  onClose: () => void;
  onCheck: () => void;
  onDuplicate: () => void;
  onEditCreate: (fix: CreateConfigFix) => void;
  onOpenBoard: () => void;
}) {
  const { row } = v;
  const [picking, setPicking] = useState(false);
  const pill = statusPill(row.status);
  const queue = (change: PendingChange | null) => change && onPendingChange(queueChange(pending, change));
  const editable = !v.created && !v.deleting && !!row.edit;
  const known = new Set(profiles.map((p) => p.name.toLowerCase()));

  const setActive = (to: boolean) => queue(activeChanges([v], to)[0] ?? null);
  const setProfiles = (to: string[]) => {
    const add = to.filter((n) => !v.profiles.some((p) => p.toLowerCase() === n.toLowerCase()));
    const remove = v.profiles.filter((p) => !to.some((n) => n.toLowerCase() === p.toLowerCase()));
    const changes = [...profileChanges([v], "add", add).changes];
    // Removing after adding: build from the record as it will be once the add is queued.
    let next = changes.reduce((acc, c) => queueChange(acc, c), pending);
    if (remove.length) {
      const after = viewRows([row], next)[0];
      next = profileChanges([after], "remove", remove).changes.reduce((acc, c) => queueChange(acc, c), next);
    }
    onPendingChange(next);
  };

  return (
    <aside className="studio-inspector objsync-panel" aria-label={`${row.label} details`}>
      <div className="studio-inspector-header">
        <span className="studio-inspector-eyebrow">DB Schema record</span>
        <button type="button" className="ui-icon-btn" onClick={onClose} title="Close" aria-label="Close">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="studio-inspector-body">
        <div>
          <h2 className="studio-inspector-title">{row.label}</h2>
          <div className="objsync-devname mono">{row.developerName}</div>
        </div>
        <div className="objsync-pills">
          <span className="ui-pill">{typeText(row.type)}</span>
          {!v.created && (pill.tone ? <span className={`ui-pill ${pill.tone}`}>{pill.text}</span> : <span className="ui-pill">{pill.text}</span>)}
          {row.orgLevel && <span className="ui-pill info">Org level</span>}
        </div>

        {v.created && (
          <div className="studio-edit">
            <span className="studio-edit-note">Only in your changes. It's created when you review and apply them.</span>
            <div className="objsync-actions">
              <button type="button" className="studio-btn sm" onClick={() => onEditCreate(v.created!)}>
                Edit…
              </button>
              <button type="button" className="studio-btn sm ghost" onClick={() => onPendingChange(dropCreates(pending, [v]))}>
                <Undo2 size={14} aria-hidden="true" />
                Remove from changes
              </button>
            </div>
          </div>
        )}
        {v.deleting && (
          <div className="studio-edit">
            <span className="studio-edit-note warning">Queued for deletion. LSC Mobile stops syncing it after you apply and publish.</span>
            <div className="objsync-actions">
              <button type="button" className="studio-btn sm" onClick={() => onPendingChange(dropDelete(pending, row.developerName))}>
                <Undo2 size={14} aria-hidden="true" />
                Keep it
              </button>
            </div>
          </div>
        )}

        {editable && (
          <div className="studio-edit">
            <div className="studio-edit-row">
              <span className="studio-edit-label">Active</span>
              <button role="switch" aria-checked={v.active} aria-label="Active" className={`studio-switch${v.active ? " on" : ""}`} onClick={() => setActive(!v.active)}>
                <span className="studio-switch-knob" />
              </button>
              <span className="studio-edit-value">{v.active ? "On" : "Off"}</span>
              {v.active !== row.active && <span className="ui-pill warning">Pending</span>}
            </div>
            <div className="studio-edit-block">
              <div className="studio-edit-row">
                <span className="studio-edit-label">Who syncs it</span>
                {!row.orgLevel && (
                  <button type="button" className="studio-link-btn studio-edit-action" onClick={() => setPicking((p) => !p)}>
                    {picking ? "Done" : "Edit"}
                  </button>
                )}
              </div>
              {row.orgLevel ? (
                <span className="studio-edit-value">Everyone — it's an org-level record.</span>
              ) : picking ? (
                <ProfilePicker selected={v.profiles} profiles={profiles} onChange={setProfiles} />
              ) : (
                <div className="studio-chips">
                  {v.profiles.length === 0 && <span className="studio-edit-value">No profiles</span>}
                  {v.profiles.map((n) => (
                    <span key={n} className={`studio-chip${known.has(n.toLowerCase()) ? "" : " muted"}`} title={known.has(n.toLowerCase()) ? undefined : "No active users have this profile, or it no longer exists"}>
                      {n}
                    </span>
                  ))}
                </div>
              )}
              {row.permissionSets.length > 0 && (
                <span className="studio-edit-value">Also permission sets: {row.permissionSets.join(", ")}</span>
              )}
            </div>
          </div>
        )}

        {(row.type ?? "").toUpperCase() !== "CONFIGURATION" && (
          <section className="objsync-section">
            <h3 className="ui-section-title">What it syncs</h3>
            <div className="studio-form">
              <TextField v={v} name="WhereSoql" pending={pending} editable={editable} onQueue={queue} multiline mono
                help="A SOQL WHERE condition, without WHERE. Tags like {USER.ID} are filled in on the iPad." />
              <TextField v={v} name="DeltaDateField" pending={pending} editable={editable} onQueue={queue} mono
                help="The date field the delta sync compares, usually LastModifiedDate." />
              <BooleanField v={v} name="OneWaySync" pending={pending} editable={editable} onQueue={queue} help="Reps can't create or edit these records offline." />
              <AttachmentField v={v} pending={pending} editable={editable} onQueue={queue} />
              <TextField v={v} name="MandatoryFields" pending={pending} editable={editable} onQueue={queue} multiline mono
                help="Fields synced even when the layout doesn't show them, separated by commas." />
            </div>
          </section>
        )}

        {row.soql && (
          <section className="objsync-section">
            <h3 className="ui-section-title">Query LSC Mobile runs</h3>
            <pre className="objsync-soql">{row.soql}</pre>
          </section>
        )}

        {!v.created && (
          <section className="objsync-section">
            <div className="objsync-section-head">
              <h3 className="ui-section-title">Check</h3>
              <button type="button" className="studio-btn sm" onClick={onCheck} disabled={checking}>
                {checking ? <Spinner size={12} /> : <ShieldCheck size={14} aria-hidden="true" />}
                {check ? "Check again" : "Check this record"}
              </button>
            </div>
            {check ? (
              <ul className="objsync-parts">
                {check.parts.map((p) => (
                  <li key={p.name}>
                    <StatusIcon tone={CHECK_TONE[p.state]} size={16} />
                    <span className="objsync-part-name">{p.name}</span>
                    <span className="objsync-part-detail">{p.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="studio-inspector-desc">
                Test-runs the object, its fields and the filter (with sample values for its tags) against the org. Read-only: the Admin Console's Status stays as it is.
              </p>
            )}
            {v.queued > 0 && check && <p className="studio-edit-note">The check reads the org, so it doesn't include your queued changes.</p>}
          </section>
        )}

        {row.findings.length > 0 && (
          <section className="objsync-section">
            <h3 className="ui-section-title">
              Problems <span className="count">{row.findings.length}</span>
            </h3>
            <ul className="studio-findings">
              {row.findings.map((f, i) => (
                <li key={i} className={`studio-finding ${f.severity}`}>
                  <div className="studio-finding-title">{f.title}</div>
                  {f.detail && <div className="studio-finding-detail">{f.detail}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <OtherFields v={v} />

        {!v.created && (
          <div className="objsync-actions objsync-footer">
            <button type="button" className="studio-btn sm" onClick={onDuplicate}>
              <Copy size={14} aria-hidden="true" />
              Duplicate…
            </button>
            <button type="button" className="studio-btn sm" onClick={onOpenBoard}>
              <LayoutGrid size={14} aria-hidden="true" />
              Show on Mobile Sync board
            </button>
            {!v.deleting && (
              <button type="button" className="studio-btn sm danger" onClick={() => queue(deleteChanges([v])[0] ?? null)}>
                <Trash2 size={14} aria-hidden="true" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// --- Fields ---------------------------------------------------------------------

interface FieldProps {
  v: ViewRow;
  pending: PendingChange[];
  editable: boolean;
  onQueue: (change: PendingChange | null) => void;
}

const asText = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/** "Not on this record": Studio edits a field's existing value; adding one is the Admin Console's job. */
function Missing() {
  return <span className="studio-form-help">Not set on this record. Add it in the Admin Console, or duplicate a record that has it.</span>;
}

function FieldRow({ label, pendingTag, children, help }: { label: string; pendingTag: boolean; children: React.ReactNode; help?: string }) {
  return (
    <div className="studio-form-row">
      <span className="studio-form-label">{label}</span>
      <div className="studio-form-field">
        {children}
        {help && <span className="studio-form-help">{help}</span>}
        {pendingTag && <span className="ui-pill warning objsync-pending">Pending</span>}
      </div>
    </div>
  );
}

function TextField({ v, name, pending, editable, onQueue, multiline, mono, help }: FieldProps & { name: string; multiline?: boolean; mono?: boolean; help?: string }) {
  const current = asText(fieldValue(v.row, name, pending));
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  const label = FIELD_LABELS[name] ?? name;
  const original = asText(v.row.fields.find((f) => f.name === name)?.value);
  if (!v.created && !hasField(v.row, name)) {
    return (
      <FieldRow label={label} pendingTag={false}>
        <Missing />
      </FieldRow>
    );
  }
  const commit = () => {
    if (draft === current) return;
    onQueue(fieldChange(v.row, name, draft.trim() === "" ? "" : draft));
  };
  const props = {
    className: `studio-input${mono ? " mono" : ""}`,
    "aria-label": label,
    value: draft,
    disabled: !editable,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
  };
  return (
    <FieldRow label={label} pendingTag={editable && current !== original} help={editable ? help : undefined}>
      {multiline ? (
        <textarea {...props} rows={name === "WhereSoql" ? 5 : 3} spellCheck={false} />
      ) : (
        <input {...props} spellCheck={false} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      )}
    </FieldRow>
  );
}

function BooleanField({ v, name, pending, editable, onQueue, help }: FieldProps & { name: string; help?: string }) {
  const label = FIELD_LABELS[name] ?? name;
  if (!v.created && !hasField(v.row, name)) {
    return (
      <FieldRow label={label} pendingTag={false}>
        <Missing />
      </FieldRow>
    );
  }
  const on = fieldValue(v.row, name, pending) === true || fieldValue(v.row, name, pending) === "true";
  const original = v.row.fields.find((f) => f.name === name)?.value;
  const wasOn = original === true || original === "true";
  return (
    <FieldRow label={label} pendingTag={editable && on !== wasOn} help={help}>
      <div className="objsync-switch-row">
        <button
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={!editable}
          className={`studio-switch${on ? " on" : ""}`}
          onClick={() => onQueue(fieldChange(v.row, name, !on))}
        >
          <span className="studio-switch-knob" />
        </button>
        <span className="studio-edit-value">{on ? "Yes" : "No"}</span>
      </div>
    </FieldRow>
  );
}

function AttachmentField({ v, pending, editable, onQueue }: FieldProps) {
  const name = "AttachmentsSupport";
  const label = FIELD_LABELS[name];
  if (!v.created && !hasField(v.row, name)) {
    return (
      <FieldRow label={label} pendingTag={false}>
        <Missing />
      </FieldRow>
    );
  }
  const current = asText(fieldValue(v.row, name, pending)).toUpperCase();
  const original = asText(v.row.fields.find((f) => f.name === name)?.value).toUpperCase();
  const options = ATTACHMENT_OPTIONS.some((o) => o.value === current) ? ATTACHMENT_OPTIONS : [...ATTACHMENT_OPTIONS, { value: current, label: current }];
  return (
    <FieldRow label={label} pendingTag={editable && current !== original} help={editable ? "Files on these records add to every sync. Keep them off unless reps need the files offline." : undefined}>
      <select className="studio-select" aria-label={label} value={current} disabled={!editable} onChange={(e) => onQueue(fieldChange(v.row, name, e.target.value))}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

/** The record's remaining values, read-only. */
function OtherFields({ v }: { v: ViewRow }) {
  const rest = v.row.fields.filter((f) => !EDITED_FIELDS.has(f.name) && f.name !== "Errors");
  if (!rest.length) return null;
  return (
    <details className="objsync-section objsync-other">
      <summary className="ui-section-title">
        Other values <span className="count">{rest.length}</span>
      </summary>
      <dl className="objsync-values">
        {rest.map((f) => (
          <React.Fragment key={f.name}>
            <dt>{FIELD_LABELS[f.name] ?? f.name}</dt>
            <dd className={f.value === null || f.value === "" ? "objsync-muted" : undefined}>{f.value === null || f.value === "" ? "Empty" : String(f.value)}</dd>
          </React.Fragment>
        ))}
      </dl>
    </details>
  );
}

// --- Bulk profiles dialog -------------------------------------------------------------

function AssignDialog({
  rows,
  profiles,
  onCancel,
  onQueue,
}: {
  rows: ViewRow[];
  profiles: ProfileOption[];
  onCancel: () => void;
  onQueue: (changes: PendingChange[]) => void;
}) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const { changes, skipped } = profileChanges(rows, mode, names);
  const onRows = new Set(rows.flatMap((v) => v.profiles.map((p) => p.toLowerCase())));
  // Removing offers only profiles the selected records have.
  const offered = mode === "remove" ? profiles.filter((p) => onRows.has(p.name.toLowerCase())) : profiles;
  const n = rows.length;

  return (
    <div className="studio-modal-backdrop" onClick={onCancel}>
      <div className="studio-modal objsync-assign ui-pop-in" role="dialog" aria-label="Change profiles" onClick={(e) => e.stopPropagation()}>
        <div className="studio-modal-header">
          <span className="studio-inspector-eyebrow">
            {n} {n === 1 ? "record" : "records"}
          </span>
          <button type="button" className="ui-icon-btn" onClick={onCancel} title="Close" aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <h2 className="studio-inspector-title">Change who syncs these</h2>
        <Segmented<"add" | "remove">
          aria-label="Add or remove"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setNames([]);
          }}
          options={[
            { value: "add", label: "Add profiles" },
            { value: "remove", label: "Remove profiles" },
          ]}
        />
        {offered.length ? (
          <ProfilePicker selected={names} profiles={offered} onChange={setNames} />
        ) : (
          <p className="studio-inspector-desc">None of the selected records is assigned to a profile.</p>
        )}
        <p className="studio-edit-note">
          {names.length === 0
            ? "Pick one or more profiles."
            : changes.length === 0
              ? "The selected records already have this."
              : `Changes ${changes.length} of ${n} ${n === 1 ? "record" : "records"}.`}
          {skipped > 0 && ` ${skipped} org-level ${skipped === 1 ? "record reaches" : "records reach"} everyone and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.`}
        </p>
        <div className="studio-modal-actions">
          <button type="button" className="studio-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="studio-btn primary" disabled={changes.length === 0} onClick={() => onQueue(changes)}>
            Add to changes
          </button>
        </div>
      </div>
    </div>
  );
}
