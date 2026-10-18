import React, { createContext, useContext, useMemo, useState } from "react";
import { Anchor, Mark, slotAttrs, useDragFamily } from "./EditLayer";
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
import type { DraftState } from "./edit-draft";
import { addedRelated, draftRelated } from "./layout-draft";
import { draftComponents, draftRecordTabs, sourceKey, type DrawnBlock, type PageDraft } from "./flexipage-draft";
import type { CompactEntry, LayoutEntry, ListViewEntry, PageEntry } from "./usePreviewEdit";

/** Edit mode's page layouts, compact layouts and Lightning pages, read from the org: Draft draws them as the tray would leave them. */
export const LayoutEdits = createContext<{
  draft: boolean;
  layouts: Record<string, LayoutEntry>;
  compacts?: Record<string, CompactEntry>;
  listViews?: Record<string, ListViewEntry>;
  pages?: Record<string, PageEntry>;
} | null>(null);

/**
 * The record tab each open record is on (Details, Related…), kept by whoever draws the preview so
 * the published and Draft sides, and the modes between them, show the same one. Keyed by the tab's
 * place in the page (`sourceKey`), else its title.
 */
export const RecordTabs = createContext<{ selected: Record<string, string>; select: (record: string, tab: string) => void } | null>(null);
const tabKeyOf = (t: { title: string; source?: Parameters<typeof sourceKey>[0] }) => (t.source ? sourceKey(t.source) : t.title);

/** The Lightning page Draft draws, when it's read from the org and lines up with the published one. */
export function usePageDraft(page: string | undefined): PageDraft | null {
  const edits = useContext(LayoutEdits);
  const entry = page && edits?.draft ? edits.pages?.[page] : undefined;
  return entry?.status === "ready" ? entry.draft : null;
}

/** Published blocks as they are, for drawing outside Draft. */
export const asDrawn = <T,>(values: T[]): DrawnBlock<T>[] => values.map((value) => ({ value, key: "", state: "same" }));

/** A Lightning page component's edit-mode identity: its place in the page's XML, or the item Draft inserted. */
export const blockIdentity = (c: PublishedComponent, d: DrawnBlock<PublishedComponent>) =>
  d.state === "added" ? { item: d.key, added: true } : c.source ? { source: sourceKey(c.source) } : {};

export const draftClass = (state: DraftState | undefined) => (state === "removed" ? " ghost" : state === "added" || state === "moved" ? " pending" : "");

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
      <RecordBody key={recordId} recordId={recordId} snapshot={snapshot} rec={rec} />
    </OpenRecord.Provider>
  );
}

function RecordBody({ recordId, snapshot, rec }: { recordId: string; snapshot: PublishedIpad; rec: PublishedRecordData }) {
  const { object, rt, page } = pageOf(snapshot, rec);
  const components = mainComponents(page);
  const tabset = components.find((c) => c.tabs);
  const pd = usePageDraft(page?.name);
  const tabs = useMemo(() => {
    const drawn =
      pd && tabset?.tabs
        ? draftRecordTabs(pd, tabset.tabs)
        : asDrawn(tabset?.tabs ?? [{ title: "Details", active: true, components: components.filter((c) => !c.tabs && bare(c.name) !== "highlightsPanel") }]);
    return drawn.filter((t) => t.value.components.some((c) => renderable(c, snapshot, rec)));
  }, [pd, tabset, components, snapshot, rec]);
  const shared = useContext(RecordTabs);
  const [own, setOwn] = useState<string | null>(null);
  const chosen = shared ? shared.selected[recordId] : own;
  const wanted = chosen === undefined || chosen === null ? -1 : tabs.findIndex((t) => tabKeyOf(t.value) === chosen);
  const setI = (j: number) => {
    const key = tabKeyOf(tabs[j].value);
    if (shared) shared.select(recordId, key);
    else setOwn(key);
  };
  const at = Math.min(wanted >= 0 ? wanted : Math.max(0, tabs.findIndex((t) => t.value.active)), tabs.length - 1);
  const tab = tabs[at]?.value;
  return (
    <div className="studio-ipad-rec">
      <Header snapshot={snapshot} rec={rec} object={object} compact={rt?.compactLayout ?? object?.defaultCompactLayout ?? null} />
      {tabs.length > 1 && (
        <div className={`studio-ipad-rec-tabs${tabs.length > 5 ? " scroll" : ""}`}>
          {tabs.map(({ value: t, state, key }, j) => {
            const button = (
              <button key={j} type="button" className={`studio-ipad-rec-tab${j === at ? " current" : ""}${draftClass(state)}`} onClick={() => setI(j)}>
                {t.title}
              </button>
            );
            return page && tabset ? (
              <Mark
                key={j}
                target={{
                  kind: "recordTab",
                  page: page.name,
                  pageLabel: page.label,
                  title: t.title,
                  index: j,
                  count: tabs.length,
                  active: t.active,
                  ...(t.source ? { source: sourceKey(t.source) } : {}),
                }}
                drag={pd ? { family: `recordTabs:${page.name}`, list: "tabs", id: key, ghost: state === "removed", horizontal: true } : undefined}
              >
                {button}
              </Mark>
            ) : (
              button
            );
          })}
        </div>
      )}
      <div className="studio-ipad-rec-body">{tab && <TabContent components={tab.components} snapshot={snapshot} rec={rec} page={page} region={tabs.length > 1 ? `${tab.title} tab` : "main"} layout={rt?.layout ?? undefined} />}</div>
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

function TabContent({
  components,
  snapshot,
  rec,
  page,
  region,
  layout,
}: {
  components: PublishedComponent[];
  snapshot: PublishedIpad;
  rec: PublishedRecordData;
  page?: ReturnType<typeof pageOf>["page"];
  region: string;
  layout?: string;
}) {
  const details = components.filter((c) => c.visibility !== "hidden" && /^(multiEntityRecordView|detailPanel)$/.test(bare(c.name)));
  // In Draft the tray's arrangement, with removed blocks as ghosts and inserted ones drawn as placeholders.
  const pd = usePageDraft(page?.name);
  const drawn = (pd ? draftComponents(pd, components) : asDrawn(components)).filter((d) => d.state === "added" || renderable(d.value, snapshot, rec));
  const shown = drawn.map((d) => d.value);
  // Details and the layout's related lists are marked part by part; any other component, a single related list included, is one block of its Lightning page.
  const marked = (c: PublishedComponent, k: number, node: React.ReactNode) => {
    const name = bare(c.name);
    const d = drawn[k];
    if (d.state === "added") node = <PlaceholderCard title={c.label} />;
    if (!page || !node) return node;
    const target = {
      kind: "component" as const,
      page: page.name,
      pageLabel: page.label,
      region,
      index: k,
      count: shown.length,
      name: c.name,
      label: c.properties.label || PLACEHOLDER_TITLES[name] || c.label || name,
      home: false,
      visibility: c.visibility === "conditional" ? ("conditional" as const) : ("shown" as const),
      ...(c.visibilityNote ? { visibilityNote: c.visibilityNote } : {}),
      ...blockIdentity(c, d),
    };
    // In Draft the blocks drag within their region or tab; the parts-marked ones still hold their place in the order.
    const drag = pd ? { family: `page:${page.name}`, list: region, id: d.key, ghost: d.state === "removed" } : undefined;
    if (d.state !== "added" && (details.includes(c) || name === "relatedListContainer"))
      return drag ? <Anchor target={target} drag={drag}>{node}</Anchor> : node;
    return (
      <Mark target={target} drag={drag}>
        {d.state === "same" ? node : <div className={`studio-ipad-draft-block${draftClass(d.state)}`}>{node}</div>}
      </Mark>
    );
  };
  const edits = useContext(LayoutEdits);
  const entry = layout ? edits?.layouts[layout] : undefined;
  const lists = entry?.status === "ready" ? entry.draft : null;
  const related = (r: PublishedRelated, key: React.Key, state?: DraftState, mark = true) => {
    if (!mark) return <RelatedCard key={key} snapshot={snapshot} related={r} editable={rec.editable} draft={state} />;
    const listed = !!lists && (lists.base.relatedLists.includes(r.api) || lists.target.relatedLists.includes(r.api));
    return (
      <Mark
        key={key}
        target={{
          kind: "related",
          object: r.object,
          label: r.label,
          parent: rec.object,
          ...(layout ? { layout } : {}),
          ...(listed ? { relatedList: r.api } : {}),
        }}
        drag={listed && state !== undefined ? { family: `related:${layout}`, id: r.api, ghost: state === "removed" } : undefined}
      >
        <RelatedCard snapshot={snapshot} related={r} editable={rec.editable} draft={state} />
      </Mark>
    );
  };
  const allRelated = (): React.ReactNode => {
    const drafted: { related: PublishedRelated; state?: DraftState }[] =
      lists && edits?.draft
        ? draftRelated(
            [...Object.values(rec.related), ...addedRelated(lists, Object.values(rec.related), (o) => snapshot.objects[o]?.label ?? o)],
            lists.base,
            lists.target
          )
        : Object.values(rec.related).map((r) => ({ related: r }));
    const cards = drafted.map((d) => related(d.related, d.related.key, d.state));
    if (!edits?.draft || !layout || drafted.some((d) => d.state !== "removed")) return cards;
    // With no related list to select, Draft draws a placeholder where "Add related list…" starts.
    return (
      <>
        {cards}
        <Mark target={{ kind: "related", object: "", label: "Related lists", parent: rec.object, layout }}>
          <div className="studio-ipad-rec-card related studio-ipad-rec-rl-placeholder">
            <div className="studio-ipad-rec-rl-head">
              <span className="studio-ipad-rec-rl-title">No related lists</span>
            </div>
            <div className="studio-ipad-rec-rl-hint">Select this card to add a related list to the layout.</div>
          </div>
        </Mark>
      </>
    );
  };
  return (
    <>
      {shown.map((c, k) => (
        <React.Fragment key={k}>{marked(c, k, card(c, k))}</React.Fragment>
      ))}
    </>
  );

  function card(c: PublishedComponent, k: number): React.ReactNode {
    const name = bare(c.name);
    if (details.includes(c)) return <DetailsCard key={k} snapshot={snapshot} rec={rec} />;
    if (name === "AccountTerritoryFields") return null;
    if (name === "ExpensesListView") return <ExpensesCard rec={rec} />;
    if (/^lscMobileInline_/.test(name)) return <InlineSlot snapshot={snapshot} rec={rec} name={name} height={Number(c.properties.mobileHeight) || 400} />;
    if (name === "relatedListContainer") return <React.Fragment key={k}>{allRelated()}</React.Fragment>;
    if (name === "relatedListSingleContainer") {
      const r = findRelated(rec, c.properties.relatedListApiName);
      return r ? related(r, k, undefined, !page) : null;
    }
    if (name === "LSCGenericRelatedList") {
      const r = Object.values(rec.related).find((x) => x.api === "LSCGenericRelatedList" && x.label === c.properties.label);
      return r ? related(r, k, undefined, !page) : null;
    }
    if (name === "ActivityHistory") {
      const r = findRelated(rec, "ActivityHistory");
      return r ? <ActivityHistoryCard rows={r.rows} /> : null;
    }
    if (name === "AccountAffiliations") {
      const r = findRelated(rec, "AccountAffiliations");
      return r ? related(r, k, undefined, !page) : null;
    }
    if (name === "Ratings" && rec.ratings) return <RatingsCard ratings={rec.ratings} />;
    if (rec.dashboard) {
      if (name === "accountSummary") return <SummaryCard data={rec.dashboard} />;
      if (name === "accountManagementDashboard") return <OverviewCard data={rec.dashboard} />;
      if (name === "nextBestActions") return <NextBestActionsCard data={rec.dashboard} />;
      if (name === "accountMapDisplay") return <MapCard data={rec.dashboard} />;
    }
    return <PlaceholderCard title={PLACEHOLDER_TITLES[name] ?? c.properties.label ?? c.label ?? name} />;
  }
}

// ── Header and highlights ─────────────────────────────────────────────────────

function Header({ snapshot, rec, object, compact }: { snapshot: PublishedIpad; rec: PublishedRecordData; object?: PublishedObject; compact: string | null }) {
  const [broken, setBroken] = useState(false);
  const fullName = compact ? `${rec.object}.${compact}` : null;
  const edits = useContext(LayoutEdits);
  const entry = fullName ? edits?.compacts?.[fullName] : undefined;
  const specs = (fullName ? snapshot.compactFields?.[fullName] : undefined) ?? [];
  // Draft draws the header as the tray leaves it: removed fields as ghosts, added ones pending.
  const drags = !!edits?.draft && entry?.status === "ready";
  const drafted = drags && entry ? entry.fields : specs.map((spec) => ({ spec, state: "same" as DraftState }));
  const cells = drafted
    .map((d) => ({ ...d, meta: metaOf(snapshot, rec.object, d.spec) }))
    .filter((c) => !c.meta.hidden)
    .map((c) => ({ spec: c.spec, state: c.state, label: c.spec.label, value: valueOf(rec, rec.object, c.spec) }))
    // SFComponentHighlightPanelView.filterCompactLayoutFields: outside Account, a field showing the title isn't repeated.
    .filter((c) => rec.object === "Account" || !c.value || c.value !== rec.title);
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
      <Mark target={{ kind: "highlights", object: rec.object, compactLayout: compact, fields: cells.map((c) => c.label) }}>
        <div className="studio-ipad-rec-hl">
          {cells.map((c, k) => {
            const cell = (
              <div className={`studio-ipad-rec-hl-cell${draftClass(c.state)}`} style={{ width: widths[k] }}>
                <div className="studio-ipad-rec-hl-label">{c.label}</div>
                <div className={`studio-ipad-rec-hl-value${c.value && (LOOKUP.has(c.spec.type) || c.spec.type === "masterdetail") ? " link" : ""}`}>{c.value}</div>
              </div>
            );
            return fullName ? (
              <Mark
                key={c.spec.name}
                target={{
                  kind: "headerField",
                  object: rec.object,
                  compactLayout: fullName,
                  field: c.spec.name,
                  label: c.label,
                  ...(c.state === "added" ? { added: true } : {}),
                }}
                drag={drags ? { family: `header:${fullName}`, id: c.spec.name, ghost: c.state === "removed", horizontal: true } : undefined}
              >
                {cell}
              </Mark>
            ) : (
              <React.Fragment key={k}>{cell}</React.Fragment>
            );
          })}
        </div>
      </Mark>
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

/** A details section as drawn: from the published layout, or from a Draft layout. */
interface DrawnSection {
  key: string;
  layout: string;
  /** Its place among the layout's drawn sections. */
  index: number;
  label: string | null;
  orgKey?: number;
  state?: DraftState;
  /** Org columns with nothing to draw, which a dragged field can still be dropped in (Draft). */
  emptyColumns?: number[];
  /** `col`: the field's column in the org's layout section, in Draft (drawn columns skip empty ones). */
  columns: { spec: RecordFieldSpec; item?: string; required?: boolean; readOnly?: boolean; state?: DraftState; col?: number }[][];
}

function drawnSections(snapshot: PublishedIpad, layout: PublishedLayout, entry: LayoutEntry | undefined, draft: boolean): DrawnSection[] {
  const object = layoutObject(layout.name);
  const shown = (spec: RecordFieldSpec) => !metaOf(snapshot, object, spec).hidden;
  if (draft && entry?.status === "ready") {
    return entry.sections
      .map((d, index) => ({
        key: `k${d.key}`,
        layout: layout.name,
        index,
        label: d.label,
        orgKey: d.key,
        state: d.state,
        emptyColumns: d.emptyColumns,
        columns: d.columns
          .map((col) =>
            col
              .filter((f) => shown(f.spec))
              .map((f) => ({ spec: f.spec, item: f.item, required: f.behavior === "Required", readOnly: f.behavior === "Readonly", state: f.state, col: f.col }))
          )
          .filter((c) => c.length),
      }))
      .filter((d) => d.columns.length);
  }
  const ready = entry?.status === "ready" ? entry : null;
  return layout.sections.flatMap((s, i): DrawnSection[] => {
    // Compound-field components and addresses are not drawn; a section left with no field disappears.
    const fields = s.fields ?? s.columns.map((col) => col.map((label): RecordFieldSpec => ({ name: label, label, type: "" })));
    const columns = fields.map((col, ci) =>
      col.flatMap((spec, fi) => (shown(spec) ? [{ spec, item: s.source?.fields[ci]?.[fi], required: spec.required, readOnly: spec.readOnly }] : []))
    );
    if (!columns.some((c) => c.length)) return [];
    const orgKey = ready?.sections.find((d) => d.ref.label === s.source?.label && d.ref.nth === s.source?.nth)?.key;
    return [{ key: String(i), layout: layout.name, index: i, label: s.label, ...(orgKey !== undefined ? { orgKey } : {}), columns }];
  });
}

function DetailsCard({ snapshot, rec }: { snapshot: PublishedIpad; rec: PublishedRecordData }) {
  const layouts = detailLayouts(snapshot, rec);
  const [editing, setEditing] = useState(false);
  const edits = useContext(LayoutEdits);
  const dragging = useDragFamily();
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
        const sections = drawnSections(snapshot, layout, edits?.layouts[layout.name], !!edits?.draft);
        // In Draft, sections and fields drag within this layout; fields across columns and sections.
        const drags = !!edits?.draft && edits.layouts[layout.name]?.status === "ready";
        return sections.map((s, si) => {
          const first = li === 0 && si === 0;
          const cls = s.label ? (si === 0 ? " layout-gap" : " section-gap") : "";
          const draggable = drags && s.orgKey !== undefined;
          // Columns by their place in the org's layout; while a field of this layout is dragged, the empty ones show too, to drop it in.
          const fieldFamily = `fields:${layout.name}`;
          const columns = (draggable && s.state !== "removed" ? s.columns.map((col, ci) => ({ column: col[0]?.col ?? ci, col })) : s.columns.map((col, ci) => ({ column: ci, col })))
            .concat(draggable && dragging === fieldFamily ? (s.emptyColumns ?? []).map((column) => ({ column, col: [] })) : [])
            .sort((a, b) => a.column - b.column);
          return (
            <Mark
              key={`${li}.${s.key}`}
              target={{ kind: "section", layout: layout.name, index: s.index, count: sections.length, label: s.label, ...(s.orgKey !== undefined ? { key: s.orgKey } : {}) }}
              drag={draggable ? { family: `sections:${layout.name}`, id: String(s.orgKey), ghost: s.state === "removed" } : undefined}
            >
            <div className={`studio-ipad-rec-section${first ? " first" : ""}${cls}${first && s.label ? " labeled" : ""}${draftClass(s.state)}`}>
              {s.label && (
                <div className="studio-ipad-rec-section-head">
                  <div className="studio-ipad-rec-section-title">{s.label}</div>
                  {rec.editable && !isVisit(rec) && si === 0 && <span className="studio-ipad-rec-edit" onClick={() => setEditing(true)}>Edit</span>}
                </div>
              )}
              <div className="studio-ipad-rec-cols">
                {columns.map(({ col, column: orgColumn }) => (
                  <div
                    key={orgColumn}
                    className={`studio-ipad-rec-col${col.length ? "" : " empty"}`}
                    {...slotAttrs(draggable && s.state !== "removed", { family: fieldFamily, list: { section: s.orgKey, column: orgColumn } })}
                  >
                    {col.map(({ spec: f, item, required, readOnly, state, col: column }, fi) => {
                      const v = valueOf(rec, object, f);
                      const meta = metaOf(snapshot, object, f);
                      return (
                        <Mark
                          key={`${f.name}.${fi}`}
                          target={{ kind: "field", layout: layout.name, section: s.label, field: f.name, label: meta.label, required, readOnly, ...(item ? { item } : {}) }}
                          drag={
                            draggable && item && column !== undefined && s.state !== "removed"
                              ? { family: fieldFamily, list: { section: s.orgKey, column }, id: item, ghost: state === "removed" }
                              : undefined
                          }
                        >
                          <div className={`studio-ipad-rec-field${f.type === "textarea" ? " tall" : ""}${draftClass(state)}`}>
                            <div className="studio-ipad-rec-label">
                              {meta.label}
                              {meta.help && <span className="studio-ipad-rec-help" aria-hidden="true">i</span>}
                            </div>
                            <div className={`studio-ipad-rec-value${v && LOOKUP.has(f.type) ? " link" : ""}`}>{v}</div>
                          </div>
                        </Mark>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            </Mark>
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

function RelatedCard({ snapshot, related, editable = false, draft }: { snapshot: PublishedIpad; related: PublishedRelated; editable?: boolean; draft?: DraftState }) {
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
    <div className={`studio-ipad-rec-card related${draftClass(draft)}`}>
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
