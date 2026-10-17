import React, { useMemo, useState } from "react";
import type { PublishedIpad, PublishedLayout, RecordFieldSpec } from "./published-types";
import type { Presentation } from "./ipad-fab-actions";
import { agentName } from "./ipad-fab-actions";
import { IpadStatusBar } from "./IpadChrome";
import { EmptyArt } from "./IpadHome";
import "./action-sheets.css";

/**
 * What a ••• menu item (or the Agentforce button) opens on the device, drawn from the cache and the
 * snapshot's read data. Nothing here saves, sends or calls the org: Save / Send / Submit are inert, and
 * Cancel / Close / Back dismiss the sheet.
 */

export interface SheetContext {
  snapshot: PublishedIpad;
  /** The record page the menu belongs to; null on Home. */
  record: { id: string; object: string; title: string } | null;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

/** A labeled note for the parts of a screen the preview can't read. */
function Note({ children }: { children: React.ReactNode }) {
  return <div className="studio-ipad-act-note">{children}</div>;
}

function Backdrop({ onClose, children, className = "" }: { onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className="studio-ipad-act-backdrop" onClick={onClose}>
      <div className={`studio-ipad-act-sheet ${className}`} onClick={(e) => e.stopPropagation()} role="dialog">
        {children}
      </div>
    </div>
  );
}

function NavBar({ left, title, right, plain }: { left?: React.ReactNode; title: React.ReactNode; right?: React.ReactNode; plain?: boolean }) {
  return (
    <div className={`studio-ipad-act-nav${plain ? " plain" : ""}`}>
      <div className="studio-ipad-act-nav-l">{left}</div>
      <div className="studio-ipad-act-nav-t">{title}</div>
      <div className="studio-ipad-act-nav-r">{right}</div>
    </div>
  );
}

function Full({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`studio-ipad-act-full ${className}`} role="dialog">
      <IpadStatusBar />
      {children}
    </div>
  );
}

const linkBtn = (label: string, onClick?: () => void, disabled = false) => (
  <button type="button" className="studio-ipad-act-link" disabled={disabled} onClick={onClick}>
    {label}
  </button>
);

// ── Form fields (the record view's layout items, as a create form) ───────────

const Caret = () => (
  <svg className="studio-ipad-act-caret" width="14" height="8" viewBox="0 0 14 8" aria-hidden="true">
    <path d="M0 0h14L7 8z" fill="#555" />
  </svg>
);

function Control({ spec, value, tall }: { spec: RecordFieldSpec; value?: string; tall?: boolean }) {
  const t = spec.type;
  if (spec.readOnly || /^Owner/.test(spec.name) || t === "masterdetail" || /^(autonumber|calculated)$/.test(t)) {
    return <div className="studio-ipad-act-static">{value ?? (t === "masterdetail" ? "Assigned on save" : "")}</div>;
  }
  if (t === "boolean") return <span className="studio-ipad-act-toggle" aria-label={spec.label} />;
  if (t === "picklist" || t === "multipicklist" || t === "combobox") {
    return (
      <div className="studio-ipad-act-box">
        <span>{value ?? ""}</span>
        <Caret />
      </div>
    );
  }
  if (t === "datetime" || t === "date" || t === "time") {
    return (
      <div className="studio-ipad-act-box">
        <span>{value ?? ""}</span>
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="#555" strokeWidth="1.4" />
          <path d="M10 5v5l3 2" fill="none" stroke="#555" strokeWidth="1.4" />
        </svg>
      </div>
    );
  }
  if (t === "lookup" || t === "reference" || t === "hierarchy") {
    return (
      <div className={`studio-ipad-act-box${tall ? " tall" : ""}`}>
        <span className="studio-ipad-act-plus">⊕</span>
        <span className="studio-ipad-act-grow">{value ?? ""}</span>
        <Caret />
      </div>
    );
  }
  if (t === "textarea") return <textarea className="studio-ipad-act-input area" aria-label={spec.label} />;
  return <input className="studio-ipad-act-input" aria-label={spec.label} defaultValue={value ?? ""} />;
}

function Field({ spec, value, tall }: { spec: RecordFieldSpec; value?: string; tall?: boolean }) {
  return (
    <div className="studio-ipad-act-field">
      <div className="studio-ipad-act-label">
        {spec.required && <span className="studio-ipad-act-req">*</span>}
        {spec.label}
      </div>
      <Control spec={spec} value={value} tall={tall} />
    </div>
  );
}

/** Layout sections as a two-column form: the cell at (row, column) is column[column][row], as the record view lays them out. */
function Sections({ layout, values }: { layout: PublishedLayout; values: (spec: RecordFieldSpec) => string | undefined }) {
  return (
    <>
      {layout.sections.map((s, i) => {
        const cols = s.fields ?? s.columns.map((c) => c.map((label) => ({ name: label, label, type: "string" })));
        const rows = Math.max(0, ...cols.map((c) => c.length));
        return (
          <div key={i} className="studio-ipad-act-section">
            {s.label && <h3>{s.label}</h3>}
            <div className="studio-ipad-act-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols.length)}, 1fr)` }}>
              {Array.from({ length: rows }).flatMap((_, r) =>
                cols.map((c, ci) => (c[r] ? <Field key={`${r}:${ci}`} spec={c[r]} value={values(c[r])} /> : <div key={`${r}:${ci}`} />))
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function layoutsFor(snapshot: PublishedIpad, object: string, recordType: string): PublishedLayout[] {
  const rt = snapshot.objects[object]?.recordTypes.find((r) => r.name === recordType);
  const names = rt?.multiEntity?.layouts ?? (rt?.layout ? [rt.layout] : []);
  return names.map((n) => snapshot.layouts[n]).filter((l): l is PublishedLayout => !!l);
}

// ── New Visit: the Visit Engagement editor ────────────────────────────────────

const VISIT_SIDEBAR = ["Content", "Product Messages", "Samples", "Drop Ship Samples", "Leave-Behinds", "Attendees"];

const fmtDateTime = (d: Date): string =>
  `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

function VisitEditor({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const { snapshot, record } = ctx;
  const rts = snapshot.objects.Visit?.recordTypes ?? [];
  const rt = rts[rts.length - 1];
  const layouts = rt ? layoutsFor(snapshot, "Visit", rt.name) : [];
  const layout = layouts[0];
  const related = new Set(layout?.relatedLists.map((r) => r.label) ?? []);
  const sidebar = VISIT_SIDEBAR.filter((l) => (l === "Attendees" ? related.has("Visitors") || related.has("Attendees") : related.has(l)));
  const start = useMemo(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
    return d;
  }, []);
  const end = new Date(start.getTime() + 30 * 60000);
  const account = record?.object === "Account" ? record.title : "";
  const values = (s: RecordFieldSpec): string | undefined => {
    if (s.name === "PlannedVisitStartTime") return fmtDateTime(start);
    if (s.name === "PlannedVisitEndTime") return fmtDateTime(end);
    if (/^Owner/.test(s.name)) return snapshot.viewer?.name;
    return undefined;
  };
  return (
    <Full>
      <NavBar
        left={linkBtn("Cancel", onClose)}
        title="Visit Engagement"
        right={
          <>
            <span className="studio-ipad-act-pill disabled">Get Signature</span>
            <span className="studio-ipad-act-pill">Save</span>
            <span className="studio-ipad-act-pill split">
              Submit<span className="studio-ipad-act-split">▾</span>
            </span>
          </>
        }
      />
      <div className="studio-ipad-act-visit">
        <div className="studio-ipad-act-side">
          {sidebar.map((l) => (
            <div key={l} className="studio-ipad-act-card">
              <span className="studio-ipad-act-chev">›</span>
              {l}
            </div>
          ))}
        </div>
        <div className="studio-ipad-act-main">
          <div className="studio-ipad-act-mainhead">
            <span>
              <span className="studio-ipad-act-chev down">›</span>
              {layout?.sections[0]?.label ?? "Visit Information"}
            </span>
            <span className="studio-ipad-act-reqnote">
              <span className="studio-ipad-act-req">*</span> Required
            </span>
          </div>
          {layout ? (
            <>
              <div className="studio-ipad-act-grid two">
                {layout.sections.flatMap((s, si) => {
                  const cols = s.fields ?? [];
                  const rows = Math.max(0, ...cols.map((c) => c.length));
                  return Array.from({ length: rows }).flatMap((_, r) =>
                    cols.map((c, ci) => {
                      const spec = c[r];
                      if (!spec) return <div key={`${si}:${r}:${ci}`} />;
                      if (spec.name === "AccountId") {
                        return (
                          <div key={spec.name} className="studio-ipad-act-field">
                            <div className="studio-ipad-act-label">
                              <span className="studio-ipad-act-req">*</span>
                              {spec.label}
                            </div>
                            <div className="studio-ipad-act-box tall col">
                              <span className="studio-ipad-act-acct">{account || "None"}</span>
                              <span className="studio-ipad-act-switch">Switch Account</span>
                            </div>
                          </div>
                        );
                      }
                      if (/^Place|Address/.test(spec.name)) {
                        return (
                          <div key={spec.name} className="studio-ipad-act-field">
                            <div className="studio-ipad-act-label">
                              <span className="studio-ipad-act-req">*</span>
                              {spec.label}
                            </div>
                            <div className="studio-ipad-act-box tall">
                              <span className="studio-ipad-act-grow">None</span>
                              <Caret />
                            </div>
                          </div>
                        );
                      }
                      // The app fills Territory and Status itself; they show as text.
                      const shown = /^Territory|^Status$/.test(spec.name) ? { ...spec, readOnly: true } : spec;
                      return <Field key={`${si}:${r}:${ci}`} spec={shown} value={values(spec)} />;
                    })
                  );
                })}
              </div>
              <Note>
                Visit layout “{layout.name}” for record type {rt?.label}. The app also lists fields the layout's other entities add (record type, name, external ID); the preview shows the layout only.
              </Note>
            </>
          ) : (
            <Note>The Visit layout isn't in the cache.</Note>
          )}
        </div>
      </div>
    </Full>
  );
}

// ── Inquiry: record type picker, then the create form ─────────────────────────

function InquirySheet({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const { snapshot, record } = ctx;
  const rts = snapshot.objects.Inquiry?.recordTypes ?? [];
  const [picked, setPicked] = useState(rts.length ? rts.length - 1 : 0);
  const [step, setStep] = useState<"pick" | "form">("pick");
  const rt = rts[picked];
  const layouts = rt ? layoutsFor(snapshot, "Inquiry", rt.name) : [];
  const account = record?.object === "Account" ? record.title : "";
  if (step === "pick") {
    return (
      <Backdrop onClose={onClose} className="inquiry">
        <NavBar plain left={linkBtn("Cancel", onClose)} title="New Inquiry" right={linkBtn("Next", () => setStep("form"), !rts.length)} />
        <div className="studio-ipad-act-body">
          {rts.map((r, i) => (
            <div key={r.name} className={`studio-ipad-act-radio${i === picked ? " on" : ""}`} onClick={() => setPicked(i)} role="radio" aria-checked={i === picked}>
              {r.label}
              {i === picked && <span className="studio-ipad-act-tick" />}
            </div>
          ))}
          {!rts.length && <Note>The Inquiry object has no record types in the cache.</Note>}
        </div>
      </Backdrop>
    );
  }
  return (
    <Backdrop onClose={onClose} className="inquiry">
      <NavBar
        plain
        left={
          <button type="button" className="studio-ipad-act-link back" onClick={() => setStep("pick")}>
            ‹ New Inquiry
          </button>
        }
        title="New Inquiry"
        right={linkBtn("Save")}
      />
      <div className="studio-ipad-act-body form">
        {layouts.map((l) => (
          <Sections key={l.name} layout={l} values={(s) => (/^Account/.test(s.name) && account ? account : /Owner/.test(s.name) ? snapshot.viewer?.name : undefined)} />
        ))}
        {!layouts.length && <Note>The layout for this record type isn't in the cache.</Note>}
        <Note>The form is not saved. Case ID and Case Number are assigned when the app saves.</Note>
      </div>
    </Backdrop>
  );
}

// ── Email: provider picker, then the template picker ──────────────────────────

function ProviderPicker({ ctx, onClose, onPick }: { ctx: SheetContext; onClose: () => void; onPick: (name: string) => void }) {
  const [q, setQ] = useState("");
  const cards = [...(ctx.snapshot.screens?.accounts?.cards ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const shown = cards.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Backdrop onClose={onClose} className="providers">
      <NavBar plain left={linkBtn("Cancel", onClose)} title="Choose provider" />
      <div className="studio-ipad-act-search">
        <span aria-hidden="true">⌕</span>
        <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="studio-ipad-act-list">
        {shown.map((c) => (
          <div key={c.id} className="studio-ipad-act-prov" onClick={() => onPick(c.name)}>
            <span className={`studio-ipad-act-avatar${c.hco ? " hco" : ""}`} aria-hidden="true" />
            {c.name}
          </div>
        ))}
      </div>
    </Backdrop>
  );
}

function EmailTemplates({ onClose }: { onClose: () => void }) {
  return (
    <Full>
      <NavBar left={linkBtn("Cancel", onClose)} title="Send Email" right={linkBtn("Next", undefined, true)} />
      <div className="studio-ipad-act-tplbar">
        <div className="studio-ipad-act-search wide">
          <span aria-hidden="true">⌕</span>
          <input placeholder="Search templates…" />
        </div>
        <span className="studio-ipad-act-filter">
          Product: <b>All</b>
        </span>
        <span className="studio-ipad-act-filter">
          Topics: <b>All</b>
        </span>
      </div>
      <h3 className="studio-ipad-act-tplhead">Email Templates</h3>
      <div className="studio-ipad-act-body">
        <Note>The app lists the approved email templates for this provider and product; Studio doesn't read them. Selecting one opens the email composer, which the preview doesn't draw. Nothing is sent.</Note>
      </div>
    </Full>
  );
}

function EmailFlow({ ctx, pickProvider, onClose }: { ctx: SheetContext; pickProvider: boolean; onClose: () => void }) {
  const [provider, setProvider] = useState<string | null>(pickProvider ? null : (ctx.record?.title ?? ""));
  return provider === null ? <ProviderPicker ctx={ctx} onClose={onClose} onPick={setProvider} /> : <EmailTemplates onClose={onClose} />;
}

// ── Next Best Customer and Survey ─────────────────────────────────────────────

function NbcSheet({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const card = ctx.snapshot.screens?.accounts?.cards.find((c) => c.id === ctx.record?.id);
  const title = ctx.record?.title ?? "";
  return (
    <Backdrop onClose={onClose} className="nbc">
      <div className="studio-ipad-act-grabber" />
      <NavBar plain left={null} title={`Why ${title}?`} right={linkBtn("Close", onClose)} />
      <div className="studio-ipad-act-body nbc">
        <div className="studio-ipad-act-white">
          <div className="studio-ipad-act-prov plain">
            <span className="studio-ipad-act-avatar" aria-hidden="true" />
            <span className="studio-ipad-act-blue">{title}</span>
          </div>
          {card?.address && <div className="studio-ipad-act-addr">{card.address}</div>}
          <span className="studio-ipad-act-outline">Visit</span>
        </div>
        <div className="studio-ipad-act-white empty">
          <EmptyArt height={150} />
          <div className="studio-ipad-act-emptyt">Nothing to see here... yet</div>
          <div className="studio-ipad-act-emptyd">After your admin adds rationales, you'll see them here. Make sure you're connected to the internet to sync the latest changes.</div>
        </div>
        <Note>The rationales are read from the org by the app; the preview shows the empty state.</Note>
      </div>
    </Backdrop>
  );
}

function SurveySheet({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"Open" | "Completed">("Open");
  return (
    <Backdrop onClose={onClose} className="survey">
      <NavBar left={linkBtn("Close", onClose)} title="Surveys" />
      <div className="studio-ipad-act-seg">
        {(["Open", "Completed"] as const).map((t) => (
          <span key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
            {t}
          </span>
        ))}
      </div>
      <div className="studio-ipad-act-search">
        <span aria-hidden="true">⌕</span>
        <input placeholder="Search..." />
      </div>
      <div className="studio-ipad-act-empty">
        <EmptyArt height={150} />
        <div className="studio-ipad-act-emptyt">No data available</div>
      </div>
      <Note>Surveys are read from the org by the app; the preview doesn't list them.</Note>
    </Backdrop>
  );
}

// ── Custom actions: in-app browser, Safari, placeholder ───────────────────────

function Browser({ url, hideSafari, onClose }: { url: string; hideSafari: boolean; onClose: () => void }) {
  return (
    <Full className="browser">
      <NavBar
        left={linkBtn("Close", onClose)}
        title="External URL"
        right={
          <>
            <span className="studio-ipad-act-ico disabled">‹</span>
            <span className="studio-ipad-act-ico disabled">›</span>
            <span className="studio-ipad-act-ico">↻</span>
            {!hideSafari && <span className="studio-ipad-act-ico">◎</span>}
          </>
        }
      />
      <div className="studio-ipad-act-webplaceholder">
        <div className="studio-ipad-act-weburl">{url}</div>
        <div className="studio-ipad-act-webnote">The app loads this page in a full-screen browser. Studio doesn't load external URLs; it shows the address instead.</div>
      </div>
    </Full>
  );
}

function Placeholder({ p, onClose }: { p: Extract<Presentation, { kind: "placeholder" | "safari" }>; onClose: () => void }) {
  const safari = p.kind === "safari";
  return (
    <Backdrop onClose={onClose} className="placeholder">
      <NavBar plain left={null} title={safari ? "Opens in Safari" : p.title} right={linkBtn("Close", onClose)} />
      <div className="studio-ipad-act-body">
        <dl className="studio-ipad-act-facts">
          <dt>Action</dt>
          <dd>{safari ? "URL (external target)" : p.title}</dd>
          <dt>Type</dt>
          <dd>{safari ? "URL" : p.type}</dd>
          <dt>Target</dt>
          <dd>{safari ? p.url : p.target}</dd>
        </dl>
        <Note>{safari ? "The app leaves for Safari with this address. Studio doesn't open it." : p.detail}</Note>
      </div>
    </Backdrop>
  );
}

// ── Agentforce panel ──────────────────────────────────────────────────────────

function AgentPanel({ ctx, utterance, onClose }: { ctx: SheetContext; utterance: string; onClose: () => void }) {
  const name = agentName(ctx.snapshot.viewer?.permissionSets);
  return (
    <Full className="agent">
      <div className="studio-ipad-act-agentnav">
        <button type="button" className="studio-ipad-act-circle" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="studio-ipad-act-agentt">{name}</div>
        <span className="studio-ipad-act-circle" aria-label="Clear chat">
          ✕
        </span>
      </div>
      <div className="studio-ipad-act-chat">
        {utterance && <div className="studio-ipad-act-bubble">{utterance}</div>}
        {!utterance && (
          <Note>
            The app opens a chat with {name}. Studio doesn't talk to the agent
            {utterance ? "" : " or show earlier messages"}; nothing is sent.
          </Note>
        )}
        {utterance && <Note>The app sends this message to {name} and shows its reply. The preview doesn't send it.</Note>}
      </div>
      <div className="studio-ipad-act-composer">
        <div className="studio-ipad-act-ask">Ask me anything</div>
        <div className="studio-ipad-act-composer-row">
          <span className="studio-ipad-act-agentpill">
            {name} <Caret />
          </span>
          <span className="studio-ipad-act-mic" aria-hidden="true" />
        </div>
      </div>
      <div className="studio-ipad-act-disclaimer">Agentforce is AI and can make mistakes</div>
    </Full>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

export default function IpadActionSheet({ presentation, ctx, onClose }: { presentation: Presentation; ctx: SheetContext; onClose: () => void }) {
  switch (presentation.kind) {
    case "visit":
      return <VisitEditor ctx={ctx} onClose={onClose} />;
    case "inquiry":
      return <InquirySheet ctx={ctx} onClose={onClose} />;
    case "email":
      return <EmailFlow ctx={ctx} pickProvider={presentation.pickProvider} onClose={onClose} />;
    case "nbc":
      return <NbcSheet ctx={ctx} onClose={onClose} />;
    case "survey":
      return <SurveySheet onClose={onClose} />;
    case "browser":
      return <Browser url={presentation.url} hideSafari={presentation.hideSafari} onClose={onClose} />;
    case "agent":
      return <AgentPanel ctx={ctx} utterance={presentation.utterance} onClose={onClose} />;
    case "safari":
    case "placeholder":
      return <Placeholder p={presentation} onClose={onClose} />;
  }
}
