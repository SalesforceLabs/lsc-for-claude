import React, { createContext, useContext, useMemo, useState } from "react";
import type {
  InlineLwcCheck,
  PublishedComponent,
  PublishedFieldMeta,
  PublishedIpad,
  PublishedLayout,
  PublishedObject,
  PublishedRecordData,
  PublishedRelated,
  RecordFieldSpec,
} from "./published-types";
import { EmptyArt } from "./IpadHome";
import { ActivityHistoryCard, MapCard, NextBestActionsCard, OverviewCard, SummaryCard } from "./DashboardCards";
import "./record.css";
import { LiveInlineLwc } from "./LiveInlineLwc";
import { CustomIcon, FileIcon, PersonAccountIcon } from "./assets/icons";

/** Highlights/segment/tab metrics, measured on LSC Mobile (pt). */
const SCREEN_W = 1210;
const CELL_PADDING = 20;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

let canvas: CanvasRenderingContext2D | null | undefined;
/** Text width in pt at the given size/weight (NSString.size(withAttributes:)). */
export function textWidth(text: string, size: number, weight = 400): number {
  if (canvas === undefined) canvas = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!canvas) return text.length * size * 0.55;
  canvas.font = `${weight} ${size}px ${FONT}`;
  return canvas.measureText(text).width;
}

/**
 * SFComponentHighlightPanelView.calculateCellWidths: each cell fits the wider of its label and value
 * plus the cell padding; spare room across the 15pt-inset view is shared evenly.
 */
export function highlightWidths(cells: { label: string; value: string }[], measure: (t: string, bold: boolean) => number = (t) => textWidth(t, 16, 400)): number[] {
  const widths = cells.map((c) => Math.max(measure(c.value, true), measure(c.label, false)) + CELL_PADDING);
  const total = widths.reduce((a, b) => a + b, 0);
  const room = SCREEN_W - 2 * 15;
  return room > total && widths.length ? widths.map((w) => w + (room - total) / widths.length) : widths;
}

/**
 * GenericRelatedListViewController.GridLayout.calculateWidths: each column fits its longest string
 * plus padding; spare room up to `max` is shared evenly.
 */
export function gridWidths(
  columns: { title: string; cells: string[] }[],
  max: number,
  measure: (t: string, header: boolean) => number = (t, h) => textWidth(t, 17, h ? 500 : 400)
): number[] {
  // The longest string by character count (first line of each value) sets a column, plus 16*2 + 15 + 3 of padding (+4: UILabel measures that much wider than canvas, measured).
  // The device renders suggestedAPFont(14) at 17pt here. The first column also reserves its sort icon (+20, measured).
  const widths = columns.map((c, k) => {
    let longest = c.title;
    let header = true;
    for (const x of c.cells) {
      const line = x.split(/\r?\n/)[0] ?? "";
      if (line.length > longest.length) {
        longest = line;
        header = false;
      }
    }
    return (longest ? measure(longest, header) : 50) + 54 + (k === 0 ? 20 : 0);
  });
  const total = widths.reduce((a, b) => a + b, 0);
  return total <= max && widths.length ? widths.map((w) => w + (max - total) / widths.length) : widths;
}

/** Only plain lookups are tappable links; master-detail and record type references print as text. */
const LOOKUP = new Set(["lookup", "hierarchy", "phone", "email", "url"]);

/** The label the device reads from the field's own describe, and whether it is drawn at all. */
function metaOf(snapshot: PublishedIpad, object: string, spec: RecordFieldSpec): PublishedFieldMeta {
  return snapshot.records?.fields[object]?.[spec.name.toLowerCase()] ?? { label: spec.label };
}

/** Objects whose flexipage components are all drawn, unsupported ones as placeholder cards. */
const isVisit = (rec: PublishedRecordData) => rec.object === "Visit" || rec.object === "ProviderVisit";

const PLACEHOLDER_TITLES: Record<string, string> = {
  accountSummary: "Provider Summary",
  accountManagementDashboard: "Overview",
  nextBestActions: "Next Best Actions",
  accountMapDisplay: "Map",
  CarouselLwc: "Insights",
  ActivityHistory: "Activity History",
  Ratings: "Ratings",
  AccountAffiliations: "Affiliations",
  optsWebView: "Consent",
  lscMobileInline_hcpEngagement: "HCP Engagement",
  lscMobileInline_inquiries: "Inquiries",
  surveyListView: "Surveys",
  AccountTerritoryFields: "Territory",
};

function pageOf(snapshot: PublishedIpad, rec: PublishedRecordData) {
  const object = snapshot.objects[rec.object];
  const rt = object?.recordTypes.find((r) => r.name === rec.recordType) ?? object?.recordTypes[0];
  return { object, rt, page: rt?.flexiPage ? snapshot.pages[rt.flexiPage] : undefined };
}

/** Flexipage components in region order, tabsets kept whole. */
function mainComponents(page: ReturnType<typeof pageOf>["page"]): PublishedComponent[] {
  return (page?.regions ?? []).flatMap((r) => r.components);
}

const bare = (name: string) => name.replace(/^.*:/, "");

// ── Screen ────────────────────────────────────────────────────────────────────

/** Opens another collected record (a related-list row) in the same preview. */
const OpenRecord = createContext<((id: string) => void) | undefined>(undefined);

export default function RecordScreen({ snapshot, recordId, onOpenRecord }: { snapshot: PublishedIpad; recordId: string; onOpenRecord?: (id: string) => void }) {
  const rec = snapshot.records?.byId[recordId];
  if (!rec) return null;
  return (
    <OpenRecord.Provider value={onOpenRecord}>
      <RecordBody key={recordId} snapshot={snapshot} rec={rec} />
    </OpenRecord.Provider>
  );
}

function RecordBody({ snapshot, rec }: { snapshot: PublishedIpad; rec: PublishedRecordData }) {
  const { object, rt, page } = pageOf(snapshot, rec);
  const components = mainComponents(page);
  const tabset = components.find((c) => c.tabs);
  const tabs = useMemo(
    () => (tabset?.tabs ?? [{ title: "Details", active: true, components: components.filter((c) => !c.tabs && bare(c.name) !== "highlightsPanel") }]).filter((t) => t.components.some((c) => renderable(c, snapshot, rec))),
    [tabset, components, snapshot, rec]
  );
  const [i, setI] = useState(Math.max(0, tabs.findIndex((t) => t.active)));
  const tab = tabs[Math.min(i, tabs.length - 1)];
  return (
    <div className="studio-ipad-rec">
      <Header snapshot={snapshot} rec={rec} object={object} compact={rt?.compactLayout ?? object?.defaultCompactLayout ?? null} />
      {tabs.length > 1 && (
        <div className={`studio-ipad-rec-tabs${tabs.length > 5 ? " scroll" : ""}`}>
          {tabs.map((t, j) => (
            <button key={j} type="button" className={`studio-ipad-rec-tab${t === tab ? " current" : ""}`} onClick={() => setI(j)}>
              {t.title}
            </button>
          ))}
        </div>
      )}
      <div className="studio-ipad-rec-body">{tab && <TabContent components={tab.components} snapshot={snapshot} rec={rec} />}</div>
    </div>
  );
}

function renderable(c: PublishedComponent, snapshot: PublishedIpad, rec: PublishedRecordData): boolean {
  if (c.visibility === "hidden") return false;
  const name = bare(c.name);
  if (!isVisit(rec) && !/^(multiEntityRecordView|detailPanel|relatedListSingleContainer|relatedListContainer)$/.test(name) && !/^lscMobileInline_/.test(name)) return true;
  if (!isVisit(rec) && /^lscMobileInline_/.test(name)) return true;
  if (name === "multiEntityRecordView" || name === "detailPanel" || name === "ExpensesListView" || name === "relatedListContainer") return true;
  if (/^lscMobileInline_/.test(name)) return !!snapshot.records?.inline[name] || !!snapshot.records?.inlineChecks?.[name];
  if (name === "relatedListSingleContainer") return !!findRelated(rec, c.properties.relatedListApiName);
  return false;
}

function findRelated(rec: PublishedRecordData, api: string | undefined): PublishedRelated | undefined {
  return api ? Object.values(rec.related).find((r) => r.api === api) : undefined;
}

function TabContent({ components, snapshot, rec }: { components: PublishedComponent[]; snapshot: PublishedIpad; rec: PublishedRecordData }) {
  const details = components.filter((c) => c.visibility !== "hidden" && /^(multiEntityRecordView|detailPanel)$/.test(bare(c.name)));
  return (
    <>
      {components
        .filter((c) => renderable(c, snapshot, rec))
        .map((c, k) => {
          const name = bare(c.name);
          if (details.includes(c)) return <DetailsCard key={k} snapshot={snapshot} rec={rec} />;
          if (name === "AccountTerritoryFields") return null;
          if (name === "ExpensesListView") return <ExpensesCard key={k} rec={rec} />;
          if (/^lscMobileInline_/.test(name)) return <InlineSlot key={k} snapshot={snapshot} rec={rec} name={name} height={Number(c.properties.mobileHeight) || 400} />;
          if (name === "relatedListContainer")
            return (
              <React.Fragment key={k}>
                {Object.values(rec.related).map((r) => (
                  <RelatedCard key={r.key} snapshot={snapshot} related={r} editable={rec.editable} />
                ))}
              </React.Fragment>
            );
          if (name === "relatedListSingleContainer") {
            const r = findRelated(rec, c.properties.relatedListApiName);
            return r ? <RelatedCard key={k} snapshot={snapshot} related={r} editable={rec.editable} /> : null;
          }
          if (name === "LSCGenericRelatedList") {
            const r = Object.values(rec.related).find((x) => x.api === "LSCGenericRelatedList" && x.label === c.properties.label);
            return r ? <RelatedCard key={k} snapshot={snapshot} related={r} editable={rec.editable} /> : null;
          }
          if (name === "ActivityHistory") {
            const r = findRelated(rec, "ActivityHistory");
            return r ? <ActivityHistoryCard key={k} rows={r.rows} /> : null;
          }
          if (name === "ActivityHistory") {
            const r = findRelated(rec, "ActivityHistory");
            return r ? <ActivityHistoryCard key={k} rows={r.rows} /> : null;
          }
          if (name === "AccountAffiliations") {
            const r = findRelated(rec, "AccountAffiliations");
            return r ? <RelatedCard key={k} snapshot={snapshot} related={r} editable={rec.editable} /> : null;
          }
          if (name === "Ratings" && rec.ratings) return <RatingsCard key={k} ratings={rec.ratings} />;
          if (rec.dashboard) {
            if (name === "accountSummary") return <SummaryCard key={k} data={rec.dashboard} />;
            if (name === "accountManagementDashboard") return <OverviewCard key={k} data={rec.dashboard} />;
            if (name === "nextBestActions") return <NextBestActionsCard key={k} data={rec.dashboard} />;
            if (name === "accountMapDisplay") return <MapCard key={k} data={rec.dashboard} />;
          }
          return <PlaceholderCard key={k} title={PLACEHOLDER_TITLES[name] ?? c.properties.label ?? c.label ?? name} />;
        })}
    </>
  );
}

// ── Header and highlights ─────────────────────────────────────────────────────

function Header({ snapshot, rec, object, compact }: { snapshot: PublishedIpad; rec: PublishedRecordData; object?: PublishedObject; compact: string | null }) {
  const [broken, setBroken] = useState(false);
  const specs = (compact ? snapshot.compactFields?.[`${rec.object}.${compact}`] : undefined) ?? [];
  const cells = specs
    .map((s) => ({ spec: s, meta: metaOf(snapshot, rec.object, s) }))
    .filter((c) => !c.meta.hidden)
    .map((c) => ({ spec: c.spec, label: c.spec.label, value: valueOf(rec, rec.object, c.spec) }));
  const widths = useMemo(() => highlightWidths(cells.map((c) => ({ label: c.label, value: c.value }))), [cells]);
  const theme = object?.theme;
  // A person account (a PersonAccount layout) uses the standard:person_account glyph.
  const person = rec.object === "Account" && detailLayouts(snapshot, rec).some((l) => l.name.startsWith("PersonAccount-"));
  return (
    <>
      <div className="studio-ipad-rec-head">
        <span className="studio-ipad-rec-icon" style={theme ? { background: theme.color } : undefined} aria-hidden="true">
          {person ? (
            <PersonAccountIcon />
          ) : /work_plan_selection_rule/.test(theme?.iconUrl ?? "") ? (
            <CustomIcon />
          ) : theme && !broken ? (
            <img src={theme.iconUrl} alt="" onError={() => setBroken(true)} />
          ) : (
            (object?.label ?? rec.object).slice(0, 1)
          )}
        </span>
        <div className="studio-ipad-rec-eyebrow">{object?.label ?? rec.object}</div>
        <div className="studio-ipad-rec-title">{rec.title || rec.id}</div>
      </div>
      <div className="studio-ipad-rec-hl">
        {cells.map((c, k) => (
          <div key={k} className="studio-ipad-rec-hl-cell" style={{ width: widths[k] }}>
            <div className="studio-ipad-rec-hl-label">{c.label}</div>
            <div className={`studio-ipad-rec-hl-value${c.value && (LOOKUP.has(c.spec.type) || c.spec.type === "masterdetail") ? " link" : ""}`}>{c.value}</div>
          </div>
        ))}
      </div>
      {rec.stagePath && <StagePath path={rec.stagePath} />}
    </>
  );
}

/** The Inquiry status path (InquiryProgressComponent): done steps checked, the current one ringed, the rest dots. Inert here. */
function StagePath({ path }: { path: { steps: string[]; current: string } }) {
  const at = path.steps.indexOf(path.current);
  return (
    <div className="studio-ipad-rec-stage">
      <div className="studio-ipad-rec-stage-row">
        {path.steps.map((s, k) => (
          <div key={s} className={`studio-ipad-rec-stage-step${k < at ? " done" : k === at ? " current" : ""}`}>
            <div className="line l" />
            <div className="line r" />
            <span className="node">{k < at ? "✓" : ""}</span>
            <div className="label">{s}</div>
          </div>
        ))}
      </div>
      <button type="button" className="studio-ipad-rec-stage-actions" disabled title="Actions are not run from this preview">
        Actions
      </button>
    </div>
  );
}

function valueOf(rec: PublishedRecordData, object: string, spec: RecordFieldSpec): string {
  return rec.values[object]?.[spec.name.toLowerCase()] ?? "";
}

// ── Details ───────────────────────────────────────────────────────────────────

/** The layouts a record's Details tab stacks: its multi-entity layouts, else its own. */
function detailLayouts(snapshot: PublishedIpad, rec: PublishedRecordData): PublishedLayout[] {
  const { rt } = pageOf(snapshot, rec);
  const names = rt?.multiEntity?.layouts ?? (rt?.layout ? [rt.layout] : []);
  return names.map((n) => snapshot.layouts[n]).filter((l): l is PublishedLayout => !!l);
}

const layoutObject = (name: string) => {
  const o = name.slice(0, Math.max(0, name.indexOf("-")));
  return o === "PersonAccount" ? "Account" : o;
};

const READ_ONLY = new Set(["id", "formula", "autonumber", "rollup"]);
const PICKLIST = new Set(["picklist", "multipicklist"]);
const DATE = new Set(["date", "datetime"]);
const TEXTY = new Set(["string", "text", "textarea", "email", "phone", "url"]);

/** Edit mode: the sheet LSC Mobile opens from Edit. Inert here: Save writes nothing to the org. */
function EditSheet({ snapshot, rec, onClose }: { snapshot: PublishedIpad; rec: PublishedRecordData; onClose: () => void }) {
  const layouts = detailLayouts(snapshot, rec);
  return (
    <div className="studio-ipad-rec-sheet-scrim">
      <div className="studio-ipad-rec-sheet" role="dialog" aria-label="Edit record">
        <div className="studio-ipad-rec-sheet-bar">
          <button type="button" className="cancel" onClick={onClose}>Cancel</button>
          <div className="title">Edit {rec.title}</div>
          <button type="button" className="save" disabled title="This preview never writes to the org">Save</button>
        </div>
        <div className="studio-ipad-rec-sheet-body">
          {layouts.map((layout, li) => {
            const object = layoutObject(layout.name);
            return layout.sections.map((s, si) => {
              // Person accounts edit Salutation / First Name / Last Name; the compound Name is not drawn.
              const person = layout.name.startsWith("PersonAccount-");
              const NAME_PARTS = ["salutation", "firstname", "lastname"];
              const cols = (s.fields ?? s.columns.map((col) => col.map((label) => ({ name: label, label, type: "" })))).map((col) =>
                col.filter((f) => (person && NAME_PARTS.includes(f.name.toLowerCase())) || (!metaOf(snapshot, object, f).hidden && !(person && f.name === "Name")))
              );
              if (!cols.some((c) => c.length)) return null;
              return (
                <div key={`${li}.${si}`} className="studio-ipad-rec-sheet-sec">
                  {s.label && <div className="studio-ipad-rec-sheet-sec-title">{s.label}</div>}
                  <div className="studio-ipad-rec-sheet-cols">
                    {cols.map((col, ci) => (
                      <div key={ci} className="col">
                        {col.map((f, fi) => {
                          const meta = metaOf(snapshot, object, f);
                          const v = valueOf(rec, object, f);
                          const ro = READ_ONLY.has(f.type) || ("readOnly" in f && f.readOnly === true);
                          return (
                            <div key={fi} className="studio-ipad-rec-sheet-field">
                              <div className="lbl">
                                {"required" in f && f.required === true ? <span className="req">* </span> : null}
                                {meta.label}
                                {meta.help && <span className="studio-ipad-rec-help" aria-hidden="true">i</span>}
                              </div>
                              {ro ? (
                                <div className="ro">{v}</div>
                              ) : (
                                <div className={`inp${PICKLIST.has(f.type) ? " pick" : ""}`}>
                                  {LOOKUP.has(f.type) && <span className="ic plus">⊕</span>}
                                  <span className="v">{v}</span>
                                  {LOOKUP.has(f.type) && v && <span className="ic">⊗</span>}
                                  {(PICKLIST.has(f.type) || LOOKUP.has(f.type)) && <span className="ic">▾</span>}
                                  {DATE.has(f.type) && <span className="ic">▦</span>}
                                  {TEXTY.has(f.type) && <span className="ic">🎤︎</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            });
          })}
        </div>
        <div className="studio-ipad-rec-sheet-note">Preview only: on the iPad Save writes the record. Nothing is saved from here.</div>
      </div>
    </div>
  );
}

function DetailsCard({ snapshot, rec }: { snapshot: PublishedIpad; rec: PublishedRecordData }) {
  const layouts = detailLayouts(snapshot, rec);
  const [editing, setEditing] = useState(false);
  return (
    <div className="studio-ipad-rec-card details">
      {editing && <EditSheet snapshot={snapshot} rec={rec} onClose={() => setEditing(false)} />}
      {rec.editable && isVisit(rec) && (
        <span className="studio-ipad-rec-pencil" title="Edit" aria-label="Edit" onClick={() => setEditing(true)}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <path d="M3 19l1-4L15 4l3 3L7 18z M13 6l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      {layouts.map((layout, li) => {
        const object = layoutObject(layout.name);
        // Compound-field components and addresses are not drawn; a section left with no field disappears.
        const sections = layout.sections
          .map((s) => ({ s, cols: (s.fields ?? s.columns.map((col) => col.map((label) => ({ name: label, label, type: "" })))).map((col) => col.filter((f) => !metaOf(snapshot, object, f).hidden)) }))
          .filter((x) => x.cols.some((c) => c.length));
        return sections.map(({ s, cols }, si) => {
          const first = li === 0 && si === 0;
          const cls = s.label ? (si === 0 ? " layout-gap" : " section-gap") : "";
          return (
            <div key={`${li}.${si}`} className={`studio-ipad-rec-section${first ? " first" : ""}${cls}${first && s.label ? " labeled" : ""}`}>
              {s.label && (
                <div className="studio-ipad-rec-section-head">
                  <div className="studio-ipad-rec-section-title">{s.label}</div>
                  {rec.editable && !isVisit(rec) && si === 0 && <span className="studio-ipad-rec-edit" onClick={() => setEditing(true)}>Edit</span>}
                </div>
              )}
              <div className="studio-ipad-rec-cols">
                {cols.map((col, ci) => (
                  <div key={ci} className="studio-ipad-rec-col">
                    {col.map((f, fi) => {
                      const v = valueOf(rec, object, f);
                      const meta = metaOf(snapshot, object, f);
                      return (
                        <div key={fi} className={`studio-ipad-rec-field${f.type === "textarea" ? " tall" : ""}`}>
                          <div className="studio-ipad-rec-label">
                            {meta.label}
                            {meta.help && <span className="studio-ipad-rec-help" aria-hidden="true">i</span>}
                          </div>
                          <div className={`studio-ipad-rec-value${v && LOOKUP.has(f.type) ? " link" : ""}`}>{v}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        });
      })}
    </div>
  );
}

// ── Related lists ─────────────────────────────────────────────────────────────

const TABLE_MAX = 1080;
/** The related table is the card's width less its 15/16pt insets. */
const TABLE_W = 1137;
const LINK_COLUMNS = new Set(["email", "url", "phone"]);

function RelatedCard({ snapshot, related, editable = false }: { snapshot: PublishedIpad; related: PublishedRelated; editable?: boolean }) {
  const theme = snapshot.records?.themes[related.object];
  const [broken, setBroken] = useState(false);
  const widths = useMemo(
    () => gridWidths(related.columns.map((c, k) => ({ title: c.label, cells: related.rows.map((r) => r.cells[k] ?? "") })), TABLE_MAX),
    [related]
  );
  const shown = related.rows.slice(0, 5);
  const open = useContext(OpenRecord);
  const file = !theme && /ContentDocument/.test(related.object);
  return (
    <div className="studio-ipad-rec-card related">
      <div className="studio-ipad-rec-rl-head">
        <span className="studio-ipad-rec-rl-icon" style={{ background: theme?.color ?? "#939393" }} aria-hidden="true">
          {file ? <FileIcon /> : /work_plan_selection_rule/.test(theme?.iconUrl ?? "") ? <CustomIcon /> : theme?.iconUrl && !broken ? <img src={theme.iconUrl} alt="" onError={() => setBroken(true)} /> : related.label.slice(0, 1)}
        </span>
        <span className="studio-ipad-rec-rl-title">
          {related.label} ({related.count})
        </span>
        {related.api === "AccountAffiliations" ? (
          <>
            <span className="studio-ipad-rec-new">New</span>
            <span className="studio-ipad-rec-new">Filters</span>
            <span className="studio-ipad-rec-new">Switch View</span>
          </>
        ) : (
          editable && related.canCreate && <span className="studio-ipad-rec-new">New</span>
        )}
      </div>
      {shown.length > 0 && (
        <div className="studio-ipad-rec-table" style={{ width: TABLE_W }}>
          <div className="studio-ipad-rec-tr head">
            {related.columns.map((c, k) => (
              <span key={k} className="studio-ipad-rec-th" style={{ width: widths[k] }}>
                {c.label}
                {k === 0 && (
                  <svg className="studio-ipad-rec-sort" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M7 2v10M3 8l4 4 4-4" fill="none" stroke="#5c5c5c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            ))}
          </div>
          {shown.map((r) => (
            <div key={r.id} className="studio-ipad-rec-tr" style={open && snapshot.records?.byId[r.id] ? { cursor: "pointer" } : undefined} onClick={open && snapshot.records?.byId[r.id] ? () => open(r.id) : undefined}>
              {related.columns.map((c, k) => (
                <span key={k} className={`studio-ipad-rec-td${r.cells[k] && LINK_COLUMNS.has(c.type) ? " link" : ""}`} style={{ width: widths[k] }}>
                  {r.cells[k]}
                </span>
              ))}
            </div>
          ))}
          {editable && (
            <div className="studio-ipad-rec-rl-actions">
              <div className="studio-ipad-rec-rl-actions-head" />
              {shown.map((r) => (
                <div key={r.id} className="studio-ipad-rec-rl-actions-row">
                  <svg width="24" height="24" viewBox="0 0 24 24" aria-label="More Options">
                    <circle cx="5" cy="12" r="1.6" fill="#5c5c5c" />
                    <circle cx="12" cy="12" r="1.6" fill="#5c5c5c" />
                    <circle cx="19" cy="12" r="1.6" fill="#5c5c5c" />
                  </svg>
                </div>
              ))}
            </div>
          )}
          <div className="studio-ipad-rec-table-border" />
        </div>
      )}
      {related.count > 5 && <div className="studio-ipad-rec-viewall">View All</div>}
    </div>
  );
}

/** Customer Ratings (module/CustomerRatings): General / Product / Territory segments over a grid of rating cards. Edit and Clear are inert. */
function RatingsCard({ ratings }: { ratings: NonNullable<PublishedRecordData["ratings"]> }) {
  const tabs = (["General", "Product", "Territory"] as const).filter((t) => ratings.cards?.some((c) => c.tab === t));
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0] ?? "General");
  if (!ratings.cards) {
    return (
      <div className="studio-ipad-rec-card placeholder">
        <div className="studio-ipad-rec-ph-title">Ratings</div>
        <div className="studio-ipad-rec-ph-note">
          The rating layout &ldquo;{ratings.layout}&rdquo; is synced to the iPad but this org does not expose its entities to the API, so Studio cannot draw its cards.
        </div>
      </div>
    );
  }
  const shown = ratings.cards.filter((c) => c.tab === tab);
  return (
    <div className="studio-ipad-rec-card ratings">
      <div className="studio-ipad-rec-rt-seg" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" className={t === tab ? "current" : undefined} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {shown.some((c) => !c.live) && <div className="studio-ipad-rec-ph-note">Values for this segment are not read by the preview; the iPad draws them from its local tables.</div>}
      <div className="studio-ipad-rec-rt-grid">
        {shown.map((c, k) => (
          <div key={k} className="studio-ipad-rec-rt-card">
            <div className="studio-ipad-rec-rt-head">
              <span className="title">{c.title}</span>
              <span className="info" aria-hidden="true">i</span>
              {c.editable && <span className="studio-ipad-rec-rt-pill edit">Edit</span>}
            </div>
            <div className={`studio-ipad-rec-rt-value${c.value ? " set" : ""}`}>{c.value || "--"}</div>
            {!c.value && <div className="studio-ipad-rec-rt-cleared">Value was cleared.</div>}
            <div className="studio-ipad-rec-rt-foot">
              <span>{c.updated ? `Last updated on ${c.updated}` : ""}</span>
              {c.editable && <span className="clear">Clear</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A flexipage component the preview cannot draw from data: its title on an empty card. */
function PlaceholderCard({ title, check, reason }: { title: string; check?: InlineLwcCheck; reason?: string }) {
  return (
    <div className="studio-ipad-rec-card placeholder">
      <div className="studio-ipad-rec-ph-title">{title}</div>
      <div className="studio-ipad-rec-ph-note">On the iPad this card is drawn live from the org; this preview does not draw it.</div>
      {reason && <LiveFailed reason={reason} />}
      {check && <OfflineNote check={check} />}
    </div>
  );
}

// ── Expenses and inline components ────────────────────────────────────────────

function ExpensesCard({ rec }: { rec: PublishedRecordData }) {
  const e = rec.expenses ?? { count: 0, total: "USD 0.00" };
  return (
    <div className="studio-ipad-rec-card expenses">
      <div className="studio-ipad-rec-exp-title">Expenses ({e.count})</div>
      {e.count === 0 && (
        <div className="studio-ipad-rec-exp-empty">
          <EmptyArt height={190} />
          <div className="studio-ipad-rec-exp-none">No data available</div>
        </div>
      )}
      <div className="studio-ipad-rec-exp-total">
        <span className="studio-ipad-rec-exp-total-label">Total:</span>
        <span className="studio-ipad-rec-exp-total-value">{e.total}</span>
      </div>
    </div>
  );
}

const generations = new WeakMap<PublishedIpad, string>();
let generationSeq = 0;

/** A key per loaded snapshot, so reloading the preview recompiles inline components from the org. */
function generationOf(snapshot: PublishedIpad): string {
  let g = generations.get(snapshot);
  if (!g) generations.set(snapshot, (g = String(++generationSeq)));
  return g;
}

/**
 * An org inline LWC: run live when the org has it (inlineChecks lists the
 * bundles read), otherwise — or when it can't run here — the card read from
 * its template, or a placeholder.
 */
function InlineSlot({ snapshot, rec, name, height }: { snapshot: PublishedIpad; rec: PublishedRecordData; name: string; height: number }) {
  const check = snapshot.records?.inlineChecks?.[name];
  const offline = (reason?: string) =>
    snapshot.records?.inline[name] ? <InlineCard snapshot={snapshot} rec={rec} name={name} reason={reason} /> : <PlaceholderCard title={PLACEHOLDER_TITLES[name] ?? name.replace(/^lscMobileInline_/, "")} check={check} reason={reason} />;
  // A snapshot cached before inline checks existed has none: try it live anyway.
  if (check && !check.bundles.includes(name)) return offline();
  const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
  return (
    <LiveInlineLwc
      name={name}
      context={{ recordId: rec.id, objectApiName: rec.object, userId: snapshot.viewer?.userId, locale, timeZone }}
      height={height}
      generation={generationOf(snapshot)}
      fallback={(reason) => offline(reason)}
      footer={check && <OfflineNote check={check} />}
    />
  );
}

/** An org-defined inline LWC (lscMobileInline_*) read from its template. */
function InlineCard({ snapshot, rec, name, reason }: { snapshot: PublishedIpad; rec: PublishedRecordData; name: string; reason?: string }) {
  const card = snapshot.records?.inline[name];
  if (!card) return null;
  const rows: (typeof card.cells)[] = [];
  for (const c of card.cells) {
    const last = rows[rows.length - 1];
    if (c.half && last && last.length === 1 && last[0].half) last.push(c);
    else rows.push([c]);
  }
  const value = (field: string) => rec.values[card.object]?.[field.toLowerCase()] ?? "";
  return (
    <div className="studio-ipad-rec-card inline">
      <div className="studio-ipad-rec-inline-title">{card.title}</div>
      <div className="studio-ipad-rec-inline-body">
        {rows.map((row, k) => (
          <div key={k} className="studio-ipad-rec-inline-row">
            {row.map((c) => (
              <div key={c.field} className={`studio-ipad-rec-inline-cell${c.half ? " half" : ""}`}>
                <p className="field-label">{c.label}</p>
                <p className="field-value">{value(c.field)}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
      {reason && <LiveFailed reason={reason} />}
      {snapshot.records?.inlineChecks?.[name] && <OfflineNote check={snapshot.records.inlineChecks[name]} />}
    </div>
  );
}

function LiveFailed({ reason }: { reason: string }) {
  return <div className="studio-ipad-rec-live-failed">Studio couldn't run this component live: {reason}</div>;
}

const ISSUE_TEXT: Record<InlineLwcCheck["issues"][number]["kind"], (detail: string) => string> = {
  apex: (d) => `Apex ${d}`,
  adapter: (d) => d,
  graphql: () => "GraphQL",
  network: (d) => d,
  component: (d) => `<${d}>`,
};

/** What an inline LWC needs the network for on the iPad (Studio's note, not drawn by the app). */
function OfflineNote({ check }: { check: InlineLwcCheck }) {
  const text = (i: InlineLwcCheck["issues"][number]) => ISSUE_TEXT[i.kind](i.detail) + (i.bundle ? ` (in c/${i.bundle})` : "");
  const online = check.issues.filter((i) => i.severity === "online");
  const gated = check.issues.filter((i) => i.severity === "gated");
  if (!online.length && !gated.length) return null;
  return (
    <div className={`studio-ipad-rec-offline${online.length ? "" : " gated"}`}>
      {online.length > 0 && (
        <p>
          <strong>Needs a connection on the iPad:</strong> {online.map(text).join(", ")}.
        </p>
      )}
      {gated.length > 0 && <p>{gated.map(text).join(", ")} works offline only when the org has offline GraphQL for LSC Mobile turned on.</p>}
    </div>
  );
}
