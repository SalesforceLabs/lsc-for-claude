import React, { useMemo, useState } from "react";
import type { PublishedIpad, PublishedLayout, RecordFieldSpec } from "./published-types";
import type { Presentation } from "./ipad-fab-actions";
import { agentName } from "./ipad-fab-actions";
import { IpadStatusBar } from "./IpadChrome";
import { EmptyArt } from "./IpadHome";
import { HcoIcon, NewPersonAccountIcon } from "./assets/icons";
import { fmtDateTime, picklistStart, visitFields, visitTimes } from "./ipad-visit-form";
import type { VisitCreateAccount } from "./screens/fabs-types";
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

const Lock = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <rect x="4" y="9.5" width="14" height="10" rx="2" fill="currentColor" />
    <path d="M7 9.5V7a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const Mic = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="7" y="2" width="6" height="10" rx="3" fill="#555" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3" fill="none" stroke="#555" strokeWidth="1.5" />
  </svg>
);

const Shield = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1 2 3v4.5c0 3.4 2.5 6 6 7.5 3.5-1.5 6-4.1 6-7.5V3z" fill="currentColor" />
    <path d="m5.2 8 2 2 3.6-3.8" fill="none" stroke="#fff" strokeWidth="1.6" />
  </svg>
);

const BADGES: [keyof NonNullable<VisitCreateAccount["licenses"]>, string][] = [
  ["state", "State"],
  ["dea", "DEA"],
  ["sdl", "SDL"],
];

/** "5/15/26, 11:37 AM" (the record collector's format) to a Date; undefined when it does not parse. */
function parseRecordDate(text: string | undefined): Date | undefined {
  const m = /^(\d+)\/(\d+)\/(\d+),\s+(\d+):(\d+)\s*([AP]M)/i.exec((text ?? "").replace(/\u202f/g, " "));
  if (!m) return undefined;
  const hour = (Number(m[4]) % 12) + (/p/i.test(m[6]) ? 12 : 0);
  return new Date(2000 + Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]));
}

function VisitEditor({ ctx, edit, onClose }: { ctx: SheetContext; edit?: string; onClose: () => void }) {
  const { snapshot, record } = ctx;
  // Edit Visit: the existing values come from the snapshot's Visit record (and its Provider Visit partner), plus the Home row for the account and place.
  const existing = edit ? snapshot.records?.byId[edit] : undefined;
  const row = edit ? snapshot.screens?.home?.visits?.items.find((v) => v.id === edit) : undefined;
  const val = (name: string): string | undefined => existing?.values.Visit?.[name.toLowerCase()] || existing?.values.ProviderVisit?.[name.toLowerCase()] || undefined;
  const create = snapshot.screens?.fabs?.visitCreate;
  const rts = snapshot.objects.Visit?.recordTypes ?? [];
  const rt = rts[rts.length - 1];
  const layouts = rt ? layoutsFor(snapshot, "Visit", rt.name) : [];
  const related = new Set(layouts.flatMap((l) => l.relatedLists.map((r) => r.label)));
  const sidebar = VISIT_SIDEBAR.filter((l) => (l === "Attendees" ? related.has("Visitors") || related.has("Attendees") : related.has(l)));
  const times = useMemo(() => visitTimes(new Date(), create?.durationMinutes ?? 30, create?.blankStart ?? false), [create?.durationMinutes, create?.blankStart]);
  const fields = useMemo(() => visitFields(layouts), [layouts]);
  const accountId = record?.object === "Account" ? record.id : "";
  const account = accountId ? create?.accounts[accountId] : undefined;
  const hasLicense = !!account?.licenses && BADGES.some(([k]) => account.licenses?.[k]);

  const control = (s: RecordFieldSpec): React.ReactNode => {
    switch (s.name) {
      case "AccountId":
        if (existing) {
          return (
            <div className="studio-ipad-act-box tall acct">
              <span className="studio-ipad-act-acctico" style={{ background: "#5867e8" }}>
                <NewPersonAccountIcon />
              </span>
              <span className="studio-ipad-act-acctname">{row?.account ?? val("AccountId") ?? ""}</span>
              <span className="studio-ipad-act-switch">Switch Account</span>
            </div>
          );
        }
        return (
          <div className="studio-ipad-act-box tall acct">
            <span className="studio-ipad-act-acctico" style={{ background: account?.person === false ? "#4a8fdb" : "#5867e8" }}>
              {account?.person === false ? <HcoIcon /> : <NewPersonAccountIcon />}
            </span>
            <span className="studio-ipad-act-acctname">{record?.title ?? ""}</span>
            <span className="studio-ipad-act-acctsub">{account?.subLabel ?? ""}</span>
            <span className="studio-ipad-act-switch">Switch Account</span>
          </div>
        );
      case "PlaceId":
        return (
          <div className="studio-ipad-act-box tall place">
            <div className="studio-ipad-act-placetext">{existing ? (row?.address ?? val("PlaceId") ?? "None") : (account?.place?.text ?? "None")}</div>
            {hasLicense && (
              <div className="studio-ipad-act-badges">
                {BADGES.map(([k, label]) =>
                  account?.licenses?.[k] ? (
                    <span key={k} className={`studio-ipad-act-badge ${account.licenses[k]}`}>
                      <Shield />
                      {label}
                    </span>
                  ) : null
                )}
              </div>
            )}
            <Caret />
          </div>
        );
      case "PlannedVisitStartTime":
      case "PlannedVisitEndTime": {
        if (existing) {
          const at = parseRecordDate(val(s.name));
          return <Control spec={{ ...s, readOnly: false }} value={at ? fmtDateTime(at) : (val(s.name) ?? "")} />;
        }
        const d = s.name === "PlannedVisitStartTime" ? times.start : times.end;
        return <Control spec={{ ...s, readOnly: false }} value={d ? fmtDateTime(d) : ""} />;
      }
      case "TerritoryId":
        return <div className="studio-ipad-act-static">{existing ? (val("TerritoryId") ?? "") : (create?.territory ?? "")}</div>;
      case "Status":
        return <div className="studio-ipad-act-static">{existing ? (val("Status") ?? "") : (s.picklist?.Planned ?? "Planned")}</div>;
      case "OwnerId":
        return <div className="studio-ipad-act-static">{snapshot.viewer?.name ?? ""}</div>;
      case "RecordTypeId":
        return (
          <div className="studio-ipad-act-box">
            <span>{rt?.label ?? ""}</span>
            <Caret />
          </div>
        );
      case "External_ID__c":
        return (
          <div className="studio-ipad-act-box">
            <span className="studio-ipad-act-grow" />
            <Mic />
          </div>
        );
    }
    // Counts and other numbers have no control on the device's create form.
    if (/^(double|int|currency|percent)$/.test(s.type)) return <div className="studio-ipad-act-static">{existing ? (val(s.name) ?? "") : ""}</div>;
    if (existing && s.type !== "picklist") return <Control spec={s} value={(s.name === "Name" ? existing.title : val(s.name)) ?? ""} />;
    if (s.type === "picklist") {
      return (
        <div className="studio-ipad-act-box">
          <span>{existing ? ((s.name === "Channel" ? row?.channel : undefined) || val(s.name) || "") : (picklistStart(s, rt?.picklistDefaults) ?? "")}</span>
          <Caret />
        </div>
      );
    }
    return <Control spec={s} />;
  };

  return (
    <Full>
      <NavBar
        left={linkBtn(existing ? "Close" : "Cancel", onClose)}
        title="Visit Engagement"
        right={
          <>
            <span className="studio-ipad-act-pill disabled">
              <Lock />
              Get Signature
            </span>
            <span className="studio-ipad-act-pill">Save</span>
            <span className="studio-ipad-act-pill split">
              Submit
              <span className="studio-ipad-act-split">
                <Caret />
              </span>
            </span>
          </>
        }
      />
      <div className="studio-ipad-act-visit">
        <div className="studio-ipad-act-side">
          {sidebar.map((l) => (
            <div key={l} className="studio-ipad-act-card">
              <span className="studio-ipad-act-chev">›</span>
              <span className="studio-ipad-act-cardl">{l}</span>
            </div>
          ))}
        </div>
        <div className="studio-ipad-act-main">
          <div className="studio-ipad-act-mainhead">
            <span>
              <span className="studio-ipad-act-chev down">›</span>
              {layouts[0]?.sections[0]?.label ?? "Visit Information"}
            </span>
            <span className="studio-ipad-act-reqnote">
              <span className="studio-ipad-act-req">*</span> Required
            </span>
          </div>
          {layouts.length ? (
            <div className="studio-ipad-act-grid two">
              {fields.map((s) => (
                <div key={s.name} className={`studio-ipad-act-field vfield${s.name === "AccountId" || s.name === "PlaceId" ? " tall" : ""}`}>
                  <div className="studio-ipad-act-label">
                    {s.required && <span className="studio-ipad-act-req">*</span>}
                    {s.label}
                  </div>
                  {control(s)}
                </div>
              ))}
            </div>
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
      return <VisitEditor ctx={ctx} edit={presentation.edit} onClose={onClose} />;
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
