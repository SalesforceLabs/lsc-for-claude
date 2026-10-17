import React, { useMemo, useState } from "react";
import type {
  PublishedComponent,
  PublishedIpad,
  PublishedLayout,
  PublishedObject,
  PublishedRecordData,
  PublishedRelated,
  RecordFieldSpec,
} from "./published-types";
import { AstroIcon, EmptyArt } from "./IpadHome";
import "./record.css";

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
export function highlightWidths(cells: { label: string; value: string }[], measure: (t: string, bold: boolean) => number = (t, b) => textWidth(t, b ? 16 : 14, 400)): number[] {
  const widths = cells.map((c) => Math.max(measure(c.value, true), measure(c.label, false)) + CELL_PADDING);
  const total = widths.reduce((a, b) => a + b, 0);
  const room = SCREEN_W - 2 * 15;
  return room > total && widths.length ? widths.map((w) => w + (room - total) / widths.length) : widths;
}

/**
 * GenericRelatedListViewController.GridLayout.calculateWidths: each column fits its longest string
 * plus padding; spare room up to `max` is shared evenly.
 */
export function gridWidths(columns: { title: string; cells: string[] }[], max: number, measure: (t: string, header: boolean) => number = (t, h) => textWidth(t, 17, h ? 600 : 400)): number[] {
  const widths = columns.map((c) => Math.max(measure(c.title, true), ...c.cells.map((x) => measure(x, false))) + 50);
  const total = widths.reduce((a, b) => a + b, 0);
  return total < max && widths.length ? widths.map((w) => w + (max - total) / widths.length) : widths;
}

/** The ••• menu: the page's dynamic actions minus Edit (the section pencil), Unlock, and ChangeOwner*. */
export function menuActions(names: string[]): { name: string; label: string }[] {
  return names
    .filter((a) => !/^(?:\w+\.)?edit$/i.test(a) && !/unlock$/i.test(a) && !/^ChangeOwner/i.test(a))
    .map((a) => ({ name: a, label: (a.split(".").pop() ?? a).replace(/^\w+__/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ") }));
}

/** Only plain lookups are tappable links; master-detail and record type references print as text. */
const LOOKUP = new Set(["lookup", "hierarchy"]);

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

function highlightsActions(page: ReturnType<typeof pageOf>["page"]): string[] {
  const walk = (cs: PublishedComponent[]): string[] => cs.flatMap((c) => (bare(c.name) === "highlightsPanel" ? (c.actions ?? []) : walk((c.tabs ?? []).flatMap((t) => t.components))));
  return walk(mainComponents(page));
}

/** The ••• menu for a record, as LSC Mobile decides it. */
export function recordMenu(snapshot: PublishedIpad, recordId: string): { name: string; label: string }[] {
  const rec = snapshot.records?.byId[recordId];
  return rec ? menuActions(highlightsActions(pageOf(snapshot, rec).page)) : [];
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function RecordScreen({ snapshot, recordId }: { snapshot: PublishedIpad; recordId: string }) {
  const rec = snapshot.records?.byId[recordId];
  if (!rec) return null;
  return <RecordBody snapshot={snapshot} rec={rec} />;
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
        <div className="studio-ipad-rec-tabs">
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
  if (name === "multiEntityRecordView" || name === "detailPanel" || name === "ExpensesListView" || name === "relatedListContainer") return true;
  if (/^lscMobileInline_/.test(name)) return !!snapshot.records?.inline[name];
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
          if (name === "ExpensesListView") return <ExpensesCard key={k} rec={rec} />;
          if (/^lscMobileInline_/.test(name)) return <InlineCard key={k} snapshot={snapshot} rec={rec} name={name} />;
          if (name === "relatedListContainer")
            return (
              <React.Fragment key={k}>
                {Object.values(rec.related).map((r) => (
                  <RelatedCard key={r.key} snapshot={snapshot} related={r} />
                ))}
              </React.Fragment>
            );
          const r = findRelated(rec, c.properties.relatedListApiName);
          return r ? <RelatedCard key={k} snapshot={snapshot} related={r} /> : null;
        })}
    </>
  );
}

// ── Header and highlights ─────────────────────────────────────────────────────

function Header({ snapshot, rec, object, compact }: { snapshot: PublishedIpad; rec: PublishedRecordData; object?: PublishedObject; compact: string | null }) {
  const [broken, setBroken] = useState(false);
  const specs = (compact ? snapshot.compactFields?.[`${rec.object}.${compact}`] : undefined) ?? [];
  const cells = specs.map((s) => ({ spec: s, label: s.label, value: valueOf(rec, rec.object, s) }));
  const widths = useMemo(() => highlightWidths(cells.map((c) => ({ label: c.label, value: c.value }))), [cells]);
  const theme = object?.theme;
  return (
    <>
      <div className="studio-ipad-rec-head">
        <span className="studio-ipad-rec-icon" style={theme ? { background: theme.color } : undefined} aria-hidden="true">
          {theme && !broken ? <img src={theme.iconUrl} alt="" onError={() => setBroken(true)} /> : (object?.label ?? rec.object).slice(0, 1)}
        </span>
        <div className="studio-ipad-rec-eyebrow">{object?.label ?? rec.object}</div>
        <div className="studio-ipad-rec-title">{rec.title || rec.id}</div>
      </div>
      <div className="studio-ipad-rec-hl">
        {cells.map((c, k) => (
          <div key={k} className="studio-ipad-rec-hl-cell" style={{ width: widths[k] }}>
            <div className="studio-ipad-rec-hl-label">{c.label}</div>
            <div className={`studio-ipad-rec-hl-value${c.value && LOOKUP.has(c.spec.type) ? " link" : ""}`}>{c.value}</div>
          </div>
        ))}
      </div>
    </>
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

const layoutObject = (name: string) => name.slice(0, Math.max(0, name.indexOf("-")));

function DetailsCard({ snapshot, rec }: { snapshot: PublishedIpad; rec: PublishedRecordData }) {
  const layouts = detailLayouts(snapshot, rec);
  return (
    <div className="studio-ipad-rec-card details">
      {rec.editable && (
        <span className="studio-ipad-rec-pencil" title="Edit" aria-label="Edit">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <path d="M3 19l1-4L15 4l3 3L7 18z M13 6l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      {layouts.map((layout, li) =>
        layout.sections.map((s, si) => {
          const object = layoutObject(layout.name);
          const first = li === 0 && si === 0;
          const cls = s.label ? (si === 0 ? " layout-gap" : " section-gap") : "";
          return (
            <div key={`${li}.${si}`} className={`studio-ipad-rec-section${first ? " first" : ""}${cls}`}>
              {s.label && <div className="studio-ipad-rec-section-title">{s.label}</div>}
              <div className="studio-ipad-rec-cols">
                {(s.fields ?? s.columns.map((col) => col.map((label) => ({ name: label, label, type: "" })))).map((col, ci) => (
                  <div key={ci} className="studio-ipad-rec-col">
                    {col.map((f, fi) => {
                      const v = valueOf(rec, object, f);
                      return (
                        <div key={fi} className={`studio-ipad-rec-field${f.type === "textarea" ? " tall" : ""}`}>
                          <div className="studio-ipad-rec-label">{f.label}</div>
                          <div className={`studio-ipad-rec-value${v && LOOKUP.has(f.type) ? " link" : ""}`}>{v}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Related lists ─────────────────────────────────────────────────────────────

const TABLE_MAX = 1080;

function RelatedCard({ snapshot, related }: { snapshot: PublishedIpad; related: PublishedRelated }) {
  const theme = snapshot.records?.themes[related.object];
  const [broken, setBroken] = useState(false);
  const widths = useMemo(
    () => gridWidths(related.columns.map((c, k) => ({ title: c.label, cells: related.rows.map((r) => r.cells[k] ?? "") })), TABLE_MAX),
    [related]
  );
  const shown = related.rows.slice(0, 5);
  return (
    <div className="studio-ipad-rec-card related">
      <div className="studio-ipad-rec-rl-head">
        <span className="studio-ipad-rec-rl-icon" style={{ background: theme?.color ?? "#939393" }} aria-hidden="true">
          {theme?.iconUrl && !broken ? <img src={theme.iconUrl} alt="" onError={() => setBroken(true)} /> : related.label.slice(0, 1)}
        </span>
        <span className="studio-ipad-rec-rl-title">
          {related.label} ({related.count})
        </span>
      </div>
      {shown.length > 0 && (
        <div className="studio-ipad-rec-table" style={{ width: TABLE_MAX }}>
          <div className="studio-ipad-rec-tr head">
            {related.columns.map((c, k) => (
              <span key={k} className="studio-ipad-rec-th" style={{ width: widths[k] }}>
                {c.label}
              </span>
            ))}
          </div>
          {shown.map((r) => (
            <div key={r.id} className="studio-ipad-rec-tr">
              {related.columns.map((_, k) => (
                <span key={k} className="studio-ipad-rec-td" style={{ width: widths[k] }}>
                  {r.cells[k]}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {related.count > 5 && <div className="studio-ipad-rec-viewall">View All</div>}
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
          <EmptyArt height={156} />
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

/** An org-defined inline LWC (lscMobileInline_*) read from its template. */
function InlineCard({ snapshot, rec, name }: { snapshot: PublishedIpad; rec: PublishedRecordData; name: string }) {
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
    </div>
  );
}

// ── Floating buttons ──────────────────────────────────────────────────────────

/** The Agentforce button and the ••• button; ••• opens the action menu over a dimmed screen. */
export function RecordFabs({ actions }: { actions: { name: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && <div className="studio-ipad-rec-dim" onClick={() => setOpen(false)} />}
      <div className={`studio-ipad-h-fabs studio-ipad-rec-fabs${open ? " open" : ""}`}>
        {open && actions.length > 0 && (
          <div className="studio-ipad-rec-menu">
            {actions.map((a) => (
              <span key={a.name} className="studio-ipad-rec-menu-item" title={a.name}>
                {a.label}
              </span>
            ))}
          </div>
        )}
        <span className="studio-ipad-h-fab astro">
          <AstroIcon size={30} />
        </span>
        <button type="button" className={`studio-ipad-h-fab more studio-ipad-rec-more${open ? " open" : ""}`} onClick={() => setOpen(!open)} aria-label={open ? "Close actions" : "More actions"}>
          {open ? (
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <path d="M4 4l18 18M22 4L4 22" stroke="#0250d9" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="30" height="8" viewBox="0 0 30 8" aria-hidden="true">
              <circle cx="4" cy="4" r="3.6" fill="#fff" />
              <circle cx="15" cy="4" r="3.6" fill="#fff" />
              <circle cx="26" cy="4" r="3.6" fill="#fff" />
            </svg>
          )}
        </button>
      </div>
    </>
  );
}
