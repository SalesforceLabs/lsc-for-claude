import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, ExternalLink, Plus, Sparkles, X } from "lucide-react";
import type { CreateConfigFix, FeatureMap, FlowOutline, ItemDetail, ItemEdit, LayoutSidebar, ProfileOption, StudioFinding, StudioFix, StudioItem, StudioSurface, SurfaceId } from "./types";
import { worstSeverity } from "./findings";
import ProfilePicker from "./ProfilePicker";
import CreateDialog from "./CreateDialog";
import UserAccessPanel from "./UserAccessPanel";
import { duplicateDraft } from "./templates";
import { fitFor, lensLine, sortByFit, type Lens } from "./lens";
import {
  activeChange,
  changeKey,
  layoutChange,
  queuedLayoutOps,
  scriptChange,
  createAffects,
  effectiveActive,
  effectiveProfiles,
  isQueued,
  isSuggestionQueued,
  itemAffects,
  pendingFor,
  profileChange,
  queueChange,
  splitList,
  stackChange,
  withoutSuggestion,
  type PendingChange,
} from "./changes";
import StateView from "../ui/StateView";
import { AssistantName } from "../../hooks/useAssistantName";

interface InspectorProps {
  map: FeatureMap;
  surface: StudioSurface;
  lens: Lens;
  onClose: () => void;
  /** Opens this surface on its feature's Setup board; set when the inspector is docked beside the iPad preview. */
  onOpenInSetup?: () => void;
  onAskClaude: (prompt: string) => void;
  /** Opens the profile check; set when the feature has per-profile setup. */
  onCheckProfile?: (profile: string) => void;
  /** Profiles in the org, for the "Who sees this" picker. */
  profiles: ProfileOption[];
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  /** Item to open, e.g. a block clicked in the iPad preview. */
  focusItem?: string | null;
}

/** Queue/unqueue callbacks shared by finding buttons and the edit panel. */
interface Queue {
  pending: PendingChange[];
  toggle: (change: PendingChange) => void;
  queue: (change: PendingChange) => void;
  queueAll: (changes: PendingChange[]) => void;
  /** Open the form for a new record (prefilled; `source` when duplicating). */
  create: (draft: CreateConfigFix, source?: StudioItem) => void;
}

/** A record form that's open: what it starts from, and the queued create it replaces when editing one. */
interface Creating {
  draft: CreateConfigFix;
  source?: StudioItem;
  replacing?: CreateConfigFix;
}

export default function Inspector({
  map,
  surface,
  lens,
  onClose,
  onOpenInSetup,
  onAskClaude,
  onCheckProfile,
  profiles,
  pending,
  onPendingChange,
  focusItem,
}: InspectorProps) {
  const [creating, setCreating] = useState<Creating | null>(null);
  const queue: Queue = {
    pending,
    queue: (change) => onPendingChange(queueChange(pending, change)),
    queueAll: (changes) => onPendingChange(changes.reduce((acc, c) => queueChange(acc, stackChange(acc, c)), pending)),
    // Clicking a queued suggestion again takes it back out of the tray; suggestions for one record stack.
    toggle: (change) =>
      onPendingChange(
        isSuggestionQueued(pending, change.fix)
          ? withoutSuggestion(pending, change.fix)
          : queueChange(pending, stackChange(pending, change))
      ),
    // Editing a create that's already queued opens what was queued.
    create: (draft, source) => {
      const queued = pendingFor(pending, draft)?.fix;
      setCreating(queued?.kind === "createConfigRecord" ? { draft: queued, source, replacing: queued } : { draft, source });
    },
  };
  const queueCreate = (fix: CreateConfigFix) => {
    const old = creating?.replacing;
    const rest = old && changeKey(old) !== changeKey(fix) ? pending.filter((p) => changeKey(p.fix) !== changeKey(old)) : pending;
    onPendingChange(queueChange(rest, { fix, affects: createAffects(fix) }));
    setCreating(null);
  };
  const queuedCreates = pending.flatMap((p) =>
    p.fix.kind === "createConfigRecord" && (surface.creates ?? []).some((c) => c.category === (p.fix as CreateConfigFix).category) ? [p.fix] : []
  );
  const [itemId, setItemId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);

  // Reset drill-down when switching surfaces
  useEffect(() => {
    setItemId(null);
    setFilter("");
    setShowExcluded(false);
  }, [surface.id]);

  useEffect(() => {
    if (focusItem) setItemId(focusItem);
  }, [surface.id, focusItem]);

  const item = surface.items.find((i) => i.id === itemId) ?? null;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matching = q
      ? surface.items.filter((i) => `${i.label} ${i.sublabel ?? ""}`.toLowerCase().includes(q))
      : surface.items;
    return sortByFit(matching, lens);
  }, [surface.items, filter, lens]);
  // Items the lens excludes are tucked behind a toggle rather than hidden outright.
  const excluded = visible.filter((i) => fitFor(i, lens).fit === "excluded");
  const listed = showExcluded ? visible : visible.filter((i) => fitFor(i, lens).fit !== "excluded");
  const groups = groupByObject(surface.id, listed);

  return (
    <aside className="studio-inspector">
      <div className="studio-inspector-header">
        {item ? (
          <button className="studio-link-btn" onClick={() => setItemId(null)}>
            <ArrowLeft size={14} aria-hidden /> {surface.title}
          </button>
        ) : (
          <span className="studio-inspector-eyebrow">{map.title}</span>
        )}
        <span className="studio-inspector-header-actions">
          {onOpenInSetup && (
            <button className="studio-link-btn" onClick={onOpenInSetup} title={`Open ${map.title} in Setup`}>
              Open in Setup <ExternalLink size={12} aria-hidden />
            </button>
          )}
          <button className="ui-icon-btn" onClick={onClose} title="Close" aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </span>
      </div>

      {creating && (
        <CreateDialog
          draft={creating.draft}
          source={creating.source}
          objects={map.objects}
          profiles={profiles}
          onCancel={() => setCreating(null)}
          onQueue={queueCreate}
        />
      )}

      {item ? (
        <ItemView
          map={map}
          surface={surface}
          item={item}
          lens={lens}
          onAskClaude={onAskClaude}
          onCheckProfile={onCheckProfile}
          profiles={profiles}
          queue={queue}
        />
      ) : (
        <div className="studio-inspector-body">
          <h2 className="studio-inspector-title">{surface.title}</h2>
          <p className="studio-inspector-desc">{surface.description}</p>

          {surface.error && (
            <FindingList
              findings={[{ severity: "error", title: "Couldn't load this surface", detail: surface.error }]}
            />
          )}
          <FindingList findings={surface.findings} queue={queue} />

          {(surface.creates?.length || queuedCreates.length) ? (
            <div className="studio-create-row">
              {surface.creates?.map((c) => (
                <button key={c.label} className="studio-btn studio-new-btn" onClick={() => queue.create(c)}>
                  <Plus size={14} aria-hidden /> {c.label}
                </button>
              ))}
              {queuedCreates.map((c) => (
                <button key={changeKey(c)} className="studio-fix-btn queued" title="In pending changes — click to edit" onClick={() => queue.create(c)}>
                  <Check size={12} aria-hidden /> {c.recordLabel || c.developerName} (pending)
                </button>
              ))}
            </div>
          ) : null}

          {surface.items.length > 8 && (
            <input
              className="studio-filter"
              aria-label="Filter items"
              placeholder={`Filter ${surface.items.length} items…`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}

          {!surface.error && surface.items.length === 0 && (
            <div className="studio-empty-note">Nothing configured for this feature.</div>
          )}

          {groups.map((group) => (
            <React.Fragment key={group.object ?? ""}>
              {group.object && (
                <h3 className="ui-section-title studio-item-group">
                  {group.object} <span className="count">{group.items.length}</span>
                </h3>
              )}
              <ul className="studio-item-list">
            {group.items.map((i) => {
              const worst = worstSeverity(i.findings);
              const { fit, reason } = fitFor(i, lens);
              return (
                <li key={i.id} className={`lens-${fit}`}>
                  <button className="studio-item-row" onClick={() => setItemId(i.id)} title={reason}>
                    <span className={`studio-dot${i.active === false ? " inactive" : ""}`} />
                    <span className="studio-item-text">
                      <span className="studio-item-label">{i.label}</span>
                      {i.sublabel && !group.object && <span className="studio-item-sublabel">{i.sublabel}</span>}
                    </span>
                    {fit !== "applies" && (
                      <span className={`studio-lens-tag ${fit}`}>{fit === "conditional" ? "Depends" : "Not for profile"}</span>
                    )}
                    {worst && <span className={`studio-sev-dot ${worst}`} title={`${i.findings.length} finding(s)`} />}
                    <ChevronRight className="studio-chevron" size={14} aria-hidden />
                  </button>
                </li>
              );
            })}
              </ul>
            </React.Fragment>
          ))}

          {lens && excluded.length > 0 && (
            <button className="studio-link-btn studio-lens-toggle" onClick={() => setShowExcluded((v) => !v)}>
              {showExcluded
                ? `Hide ${excluded.length} that don't apply`
                : `Show ${excluded.length} that don't apply to ${lens.profile}`}
            </button>
          )}

          <button
            className="studio-ask-btn"
            onClick={() => onAskClaude(surfacePrompt(map, surface, lens))}
          >
            <Sparkles size={14} aria-hidden /> Ask <AssistantName /> about {surface.title}
          </button>
        </div>
      )}
    </aside>
  );
}

function ItemView({
  map,
  surface,
  item,
  lens,
  onAskClaude,
  onCheckProfile,
  profiles,
  queue,
}: {
  map: FeatureMap;
  surface: StudioSurface;
  item: StudioItem;
  lens: Lens;
  onAskClaude: (prompt: string) => void;
  onCheckProfile?: (profile: string) => void;
  profiles: ProfileOption[];
  queue: Queue;
}) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom scripts arrive with their code; formulas and trigger bodies are fetched on demand.
  const needsDetail = !!item.detailKind && !item.code;

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!needsDetail || !item.detailKind) return;
    let cancelled = false;
    setLoading(true);
    window.lscApi.studioItemDetail(item.detailKind, item.id).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error || res.data?.error) setError(res.error || res.data?.error || "Failed to load");
      else setDetail(res.data as ItemDetail);
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.detailKind, needsDetail]);

  const code = item.code ?? detail?.code;
  const scriptFix = item.detailKind === "customScript" && item.code ? pendingFor(queue.pending, scriptChange(item, item.code.text, "")) : undefined;
  const properties = Object.entries({ ...item.properties, ...(detail?.properties ?? {}) }).filter(
    ([, v]) => v !== null && v !== ""
  );

  return (
    <div className="studio-inspector-body">
      <div className="studio-item-heading">
        <span className={`studio-dot${item.active === false ? " inactive" : ""}`} />
        <h2 className="studio-inspector-title">{item.label}</h2>
      </div>
      {item.sublabel && <p className="studio-inspector-desc">{item.sublabel}</p>}
      {item.active !== undefined && !item.edit && (
        <span className={`ui-pill ${item.active ? "pass" : ""}`}>
          {item.active ? "Active" : "Inactive"}
        </span>
      )}
      {lens && item.audience && <LensBanner item={item} lens={lens} />}
      {item.checkProfile && onCheckProfile && lens?.profile !== item.checkProfile && (
        <button className="studio-fix-btn studio-check-profile-btn" onClick={() => onCheckProfile(item.checkProfile!)}>
          Check {item.checkProfile}'s setup <ArrowRight size={12} aria-hidden />
        </button>
      )}

      {item.edit && <EditPanel item={item} edit={item.edit} profiles={profiles} queue={queue} />}
      {item.edit && duplicateDraft(item) && (
        <button className="studio-link-btn studio-duplicate-btn" onClick={() => queue.create(duplicateDraft(item)!, item)}>
          Duplicate…
        </button>
      )}
      {item.user && (
        <UserAccessPanel
          user={item.user}
          others={surface.items.flatMap((i) => (i.user && i.user.id !== item.user!.id ? [i.user] : []))}
          pending={queue.pending}
          onQueue={queue.queueAll}
          refreshKey={map.collectedAt}
        />
      )}

      <FindingList findings={item.findings} queue={queue} affects={itemAffects(item)} />

      {properties.length > 0 && (
        <dl className="studio-props">
          {properties.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>{k}</dt>
              <dd>{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {loading && <StateView kind="loading" title="Loading…" layout="inline" className="studio-inspector-state" />}
      {error && <FindingList findings={[{ severity: "error", title: "Couldn't load detail", detail: error }]} />}
      {detail?.findings && <FindingList findings={detail.findings} queue={queue} />}
      {detail?.sidebar && <SidebarPanel layoutLabel={item.label} sidebar={detail.sidebar} queue={queue} />}
      {detail?.flow && <FlowPanel flow={detail.flow} />}
      {item.detailKind === "customScript" && item.code ? (
        <ScriptEditor item={item} original={item.code.text} queued={scriptFix?.fix} queue={queue} />
      ) : (
        // A flow's outline text is only for "Ask Claude"; the panel above shows it.
        code && !detail?.flow && <CodeBlock language={code.language} text={code.text} />
      )}

      <button
        className="studio-ask-btn"
        onClick={() => onAskClaude(itemPrompt(map, surface, item, lens, code?.text))}
      >
        <Sparkles size={14} aria-hidden /> Ask <AssistantName /> about this
      </button>
    </div>
  );
}

const FIT_TITLES = { applies: "Applies", conditional: "Depends on the user", excluded: "Doesn't apply" };

function LensBanner({ item, lens }: { item: StudioItem; lens: NonNullable<Lens> }) {
  const { fit, reason } = fitFor(item, lens);
  return (
    <div className={`studio-lens-banner ${fit}`}>
      <div className="studio-lens-banner-title">
        {FIT_TITLES[fit]} · {lens.profile}
      </div>
      {reason && <div className="studio-lens-banner-detail">{reason}</div>}
    </div>
  );
}

/** A suggestion that edits a profile list affects the profiles it adds or removes as well. */
function suggestionAffects(fix: StudioFix, affects: string[] | undefined): string[] | undefined {
  if (!affects || fix.kind !== "setConfigField" || fix.field !== "Profiles") return affects;
  return [...new Set([...affects, ...splitList(String(fix.from ?? "")), ...splitList(String(fix.to ?? ""))])];
}

// ─── Editing ─────────────────────────────────────────────────────────────────

function EditPanel({ item, edit, profiles, queue }: { item: StudioItem; edit: ItemEdit; profiles: ProfileOption[]; queue: Queue }) {
  const [picking, setPicking] = useState(false);
  const active = effectiveActive(edit, queue.pending);
  const activeQueued = active !== edit.active;
  const current = edit.profiles ? (edit.profiles.source === "field" ? splitList(edit.profiles.raw) : edit.profiles.names) : [];
  const assigned = effectiveProfiles(edit, queue.pending);
  const profilesQueued = !sameNames(current, assigned);
  const known = new Set(profiles.map((p) => p.name.toLowerCase()));
  const users = new Map(profiles.map((p) => [p.name.toLowerCase(), p.users]));
  const isTrigger = edit.record.type === "triggerHandler";

  const setActive = (to: boolean) => {
    const fix = activeChange(edit, to);
    if (fix) queue.queue({ fix, affects: isTrigger ? undefined : itemAffects(item) });
  };
  const setProfiles = (to: string[]) => {
    const fix = profileChange(edit, to);
    if (fix) queue.queue({ fix, affects: itemAffects(item, [...current, ...to]) });
  };

  return (
    <div className="studio-edit">
      {active !== undefined && (
        <div className="studio-edit-row">
          <span className="studio-edit-label">Active</span>
          <button
            role="switch"
            aria-checked={active}
            className={`studio-switch${active ? " on" : ""}`}
            onClick={() => setActive(!active)}
            title={isTrigger ? "Trigger handlers run for every user in the org" : undefined}
          >
            <span className="studio-switch-knob" />
          </button>
          <span className="studio-edit-value">{active ? "On" : "Off"}</span>
          {activeQueued && <span className="ui-pill warning">Pending</span>}
        </div>
      )}
      {active !== undefined && isTrigger && activeQueued && (
        <div className="studio-edit-note warning">
          {active ? "Turns this handler's logic on" : "Turns this automation off"} for the whole org, not one profile.
        </div>
      )}

      {edit.profiles && (
        <div className="studio-edit-block">
          <div className="studio-edit-row">
            <span className="studio-edit-label">Who sees this</span>
            {profilesQueued && <span className="ui-pill warning">Pending</span>}
            <button className="studio-link-btn studio-edit-action" onClick={() => setPicking((v) => !v)}>
              {picking ? "Done" : "Edit"}
            </button>
          </div>
          {!picking && (
            <div className="studio-chips">
              {assigned.length === 0 && (
                <span className="studio-edit-value">
                  {edit.profiles.source === "field" ? "Every profile (none listed)" : "No profiles"}
                </span>
              )}
              {assigned.map((n) => (
                <span
                  key={n}
                  className={`studio-chip${known.has(n.toLowerCase()) ? "" : " unknown"}`}
                  title={known.has(n.toLowerCase()) ? `${users.get(n.toLowerCase()) ?? 0} active user(s)` : "No profile with this name exists"}
                >
                  {n}
                </span>
              ))}
            </div>
          )}
          {picking && <ProfilePicker selected={assigned} profiles={profiles} onChange={setProfiles} />}
        </div>
      )}
    </div>
  );
}

function sameNames(a: string[], b: string[]): boolean {
  const key = (l: string[]) => l.map((n) => n.toLowerCase()).sort().join("|");
  return key(a) === key(b);
}

function FindingList({ findings, queue, affects }: { findings: StudioFinding[]; queue?: Queue; affects?: string[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="studio-findings">
      {findings.map((f, idx) => {
        const direct = (f.fixes ?? []).filter((fix) => fix.kind !== "createConfigRecord");
        const unqueued = queue ? direct.filter((fix) => !isSuggestionQueued(queue.pending, fix)) : [];
        return (
          <li key={idx} className={`studio-finding ${f.severity}`}>
            <div className="studio-finding-title">{f.title}</div>
            {f.detail && <div className="studio-finding-detail">{f.detail}</div>}
            {queue && f.fixes && f.fixes.length > 0 && (
              <div className="studio-fix-row">
                {f.fixes.map((fix) => {
                  // New records open their form first, so nothing is created from defaults the admin hasn't seen.
                  if (fix.kind === "createConfigRecord") {
                    const queued = isQueued(queue.pending, fix);
                    return (
                      <button
                        key={fix.label}
                        className={`studio-fix-btn${queued ? " queued" : ""}`}
                        title={queued ? "In pending changes — click to edit" : "Review and add to pending changes"}
                        onClick={() => queue.create(fix)}
                      >
                        {queued && <Check size={12} aria-hidden />}
                        {queued ? fix.label : `${fix.label}…`}
                      </button>
                    );
                  }
                  const queued = isSuggestionQueued(queue.pending, fix);
                  return (
                    <button
                      key={fix.label}
                      className={`studio-fix-btn${queued ? " queued" : ""}`}
                      title={queued ? "In pending changes — click to remove" : "Add to pending changes"}
                      onClick={() => queue.toggle({ fix, affects: suggestionAffects(fix, affects) })}
                    >
                      {queued && <Check size={12} aria-hidden />}
                      {fix.label}
                    </button>
                  );
                })}
                {direct.length > 1 && unqueued.length > 0 && (
                  <button
                    className="studio-link-btn"
                    onClick={() => queue.queueAll(unqueued.map((fix) => ({ fix, affects: suggestionAffects(fix, affects) })))}
                  >
                    Add all {unqueued.length}
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A custom script's code, with an Edit mode that queues the new CodeText in the pending-changes tray. */
function ScriptEditor({ item, original, queued, queue }: { item: StudioItem; original: string; queued?: StudioFix; queue: Queue }) {
  const [draft, setDraft] = useState<string | null>(null);
  const pendingCode = queued?.kind === "setCustomScriptCode" ? queued.to : null;
  // Editing starts from what's queued, so a second edit builds on the first.
  const shown = pendingCode ?? original;

  useEffect(() => setDraft(null), [item.id]);

  if (draft === null) {
    return (
      <>
        {pendingCode !== null && (
          <div className="studio-edit-row">
            <span className="studio-edit-label">Code</span>
            <span className="ui-pill warning">Pending</span>
            <button className="studio-link-btn studio-edit-action" onClick={() => queue.toggle({ fix: queued! })}>
              Discard edit
            </button>
          </div>
        )}
        <CodeBlock language="javascript" text={shown} onEdit={() => setDraft(shown)} editLabel={shown.trim() ? "Edit" : "Write code"} />
      </>
    );
  }

  const save = () => {
    // Textareas hand back \n; keep the script's own line endings so the diff shows only what was edited.
    const to = original.includes("\r\n") ? draft.replace(/\r?\n/g, "\r\n") : draft;
    queue.queue({ fix: scriptChange(item, original, to) });
    setDraft(null);
  };
  return (
    <div className="studio-code studio-code-edit">
      <div className="studio-code-header">
        <span>javascript · editing</span>
      </div>
      <textarea
        className="studio-code-input"
        aria-label={`Code of ${item.label}`}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="studio-edit-note warning">
        The platform runs CodeText. Clicking Refresh in Admin Console &gt; Custom Scripts later overwrites it from the deployed LWC.
      </div>
      <div className="studio-fix-row">
        <button className="studio-btn primary" onClick={save}>
          Add to pending changes
        </button>
        <button className="studio-btn" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function conditionIntro(flow: FlowOutline): string {
  const logic = flow.conditionLogic?.toLowerCase();
  let intro = "Only when all of these are true";
  if (logic === "formula") intro = "When this formula is true";
  else if (flow.conditions.length === 1) intro = "Only when";
  else if (logic === "or") intro = "When any of these are true";
  else if (logic && logic !== "and") intro = `When ${flow.conditionLogic}`;
  return flow.onlyWhenChanged ? `${intro} — and only when a record changes to meet them:` : `${intro}:`;
}

/** A record-triggered flow read from its metadata: when it runs, what it changes, and its path. */
function FlowPanel({ flow }: { flow: FlowOutline }) {
  const numbered = flow.conditions.length > 1 && !["and", "or"].includes(flow.conditionLogic?.toLowerCase() ?? "and");
  const Conditions = numbered ? "ol" : "ul";
  return (
    <div className="studio-flow">
      <div className="studio-flow-section">
        <span className="studio-edit-label">When it runs</span>
        <p className="studio-flow-trigger">{flow.trigger}</p>
        {flow.conditions.length > 0 ? (
          <>
            <p className="studio-flow-note">{conditionIntro(flow)}</p>
            <Conditions className="studio-flow-list">
              {flow.conditions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </Conditions>
          </>
        ) : (
          <p className="studio-flow-note">No entry conditions.</p>
        )}
      </div>
      <div className="studio-flow-section">
        <span className="studio-edit-label">What it changes</span>
        {flow.effects.length > 0 ? (
          <ul className="studio-flow-list">
            {flow.effects.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : (
          <p className="studio-flow-note">Nothing — it doesn't change records or run actions.</p>
        )}
      </div>
      {flow.steps.length > 0 && (
        <div className="studio-flow-section">
          <span className="studio-edit-label">Steps</span>
          <ol className="studio-flow-steps">
            {flow.steps.map((s, i) => (
              <li key={i} className={`studio-flow-step ${s.kind}`} style={{ paddingLeft: s.depth * 14 }}>
                {s.text}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Related lists in a Visit layout's engagement sidebar, and a picker to add another. */
function SidebarPanel({ layoutLabel, sidebar, queue }: { layoutLabel: string; sidebar: LayoutSidebar; queue: Queue }) {
  const [choice, setChoice] = useState("");
  const queuedAdds = queuedLayoutOps(queue.pending, sidebar.layoutName).flatMap((o) =>
    o.op === "addRelatedList" ? [{ relationshipName: o.relatedList, objectName: o.object ?? o.relatedList }] : []
  );
  const count = sidebar.relatedLists?.length ?? null;
  const full = count !== null && count + queuedAdds.length >= sidebar.max;

  const add = () => {
    const candidate = sidebar.candidates.find((c) => c.relationshipName === choice);
    if (!candidate) return;
    queue.queue({ fix: layoutChange(queue.pending, sidebar.layoutName, layoutLabel, candidate, true) });
    setChoice("");
  };

  return (
    <div className="studio-edit">
      <div className="studio-edit-row">
        <span className="studio-edit-label">Engagement sidebar</span>
        <span className="studio-edit-value">
          {count === null ? "Couldn't read the layout" : `${count + queuedAdds.length} of ${sidebar.max} related lists`}
        </span>
      </div>
      {sidebar.relatedLists && (
        <div className="studio-chips">
          {sidebar.relatedLists.map((n) => (
            <span key={n} className="studio-chip">
              {n}
            </span>
          ))}
          {queuedAdds.map((f) => (
            <span key={f.relationshipName} className="studio-chip" title="In pending changes — click to remove">
              <button className="studio-link-btn" onClick={() => queue.queue({ fix: layoutChange(queue.pending, sidebar.layoutName, layoutLabel, f, false) })}>
                {f.relationshipName} (pending) <X size={12} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="studio-edit-row">
        <select className="studio-select" aria-label="Child object to add" value={choice} disabled={full} onChange={(e) => setChoice(e.target.value)}>
          <option value="">{full ? "Sidebar is full" : "Add related list to sidebar…"}</option>
          {sidebar.candidates
            .filter((c) => !queuedAdds.some((f) => f.relationshipName === c.relationshipName))
            .sort((a, b) => a.objectName.localeCompare(b.objectName) || a.relationshipName.localeCompare(b.relationshipName))
            .map((c) => (
              <option key={c.relationshipName} value={c.relationshipName}>
                {c.objectName} ({c.relationshipName})
              </option>
            ))}
        </select>
        <button className="studio-btn" disabled={!choice} onClick={add}>
          Add
        </button>
      </div>
      <div className="studio-edit-note">Changes the layout for every profile assigned it. Publish to iPad afterwards.</div>
    </div>
  );
}

function CodeBlock({ language, text, onEdit, editLabel = "Edit" }: { language: string; text: string; onEdit?: () => void; editLabel?: string }) {
  if (!text.trim() && !onEdit) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="studio-code">
      <div className="studio-code-header">
        <span>{language}</span>
        {onEdit && (
          <button className="studio-link-btn" onClick={onEdit}>
            {editLabel}
          </button>
        )}
        <button className="studio-link-btn" onClick={() => navigator.clipboard.writeText(text)}>
          Copy
        </button>
      </div>
      <pre>
        {lines.map((line, i) => (
          <div key={i} className="studio-code-line">
            <span className="studio-code-ln">{i + 1}</span>
            <span>{line || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}

// ─── Prompts handed to chat ─────────────────────────────────────────────────

function findingLines(findings: StudioFinding[]): string {
  return findings.map((f) => `- [${f.severity}] ${f.title}${f.detail ? ` — ${f.detail}` : ""}`).join("\n");
}

/** " [doesn't apply: Assigned to X]" for prompts, when the lens has something to say. */
function fitNote(item: StudioItem, lens: Lens): string {
  if (!lens || !item.audience) return "";
  const { fit, reason } = fitFor(item, lens);
  return ` [${fit === "applies" ? "applies" : fit === "conditional" ? "depends on the user" : "doesn't apply"}${reason ? `: ${reason}` : ""}]`;
}

function surfacePrompt(map: FeatureMap, surface: StudioSurface, lens: Lens): string {
  const items = surface.items.map(
    (i) => `- ${i.label}${i.sublabel ? ` (${i.sublabel})` : ""}${i.active === false ? " [inactive]" : ""}${fitNote(i, lens)}`
  );
  const findings = [...surface.findings, ...surface.items.flatMap((i) => i.findings)];
  return [
    `In LSC Studio I'm reviewing ${map.title} → ${surface.title} in org ${map.org}.`,
    lensLine(lens),
    items.length ? `Items:\n${items.join("\n")}` : "Nothing is configured here.",
    findings.length ? `Studio flagged:\n${findingLines(findings)}` : "",
    `Explain how this is set up, whether it follows LSC best practices, and what I should change.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function itemPrompt(map: FeatureMap, surface: StudioSurface, item: StudioItem, lens: Lens, code?: string): string {
  const props = Object.entries(item.properties)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return [
    `In LSC Studio I'm looking at ${map.title} → ${surface.title} → "${item.label}" in org ${map.org}.`,
    lens ? `${lensLine(lens)} For that profile, Studio says:${fitNote(item, lens) || " [applies to everyone]"}` : "",
    props,
    item.findings.length ? `Studio flagged:\n${findingLines(item.findings)}` : "",
    code ? "```\n" + code + "\n```" : "",
    `Explain what this does, how it behaves on web vs. the iPad, and any risks or improvements.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Surfaces whose items span several objects; their lists get a heading per object. */
const GROUPED_BY_OBJECT: SurfaceId[] = ["recordTypes", "layouts"];

/** Splits a list into per-object groups (alphabetical), keeping each group's order; one ungrouped list otherwise. */
function groupByObject(surfaceId: SurfaceId, items: StudioItem[]): { object?: string; items: StudioItem[] }[] {
  if (!GROUPED_BY_OBJECT.includes(surfaceId)) return [{ items }];
  const byObject = new Map<string, StudioItem[]>();
  for (const i of items) {
    const object = String(i.properties.Object ?? i.sublabel ?? "Other");
    byObject.set(object, [...(byObject.get(object) ?? []), i]);
  }
  if (byObject.size < 2) return [{ items }];
  return [...byObject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([object, items]) => ({ object, items }));
}
