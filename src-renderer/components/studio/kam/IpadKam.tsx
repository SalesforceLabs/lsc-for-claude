import React, { useState } from "react";
import { useLazyStudio } from "../useLazyStudio";
import { IpadFail, IpadWait } from "../IpadLazyState";
import { Kebab, KamMenu, KamSheets, StatusMenu, type KamSheet } from "./IpadKamActions";
import type { PublishedIpad, PublishedRecordData } from "../published-types";
import type {
  KamActionPlan,
  KamStatusKind,
  KamObjective,
  KamPlan,
  KamTask,
  KamNomenclature,
  PublishedKam,
} from "../screens/kam/kam-types";
import {
  NO_FILTER,
  type KebabItem,
  actionPlanChips,
  addItems,
  completion,
  dueLabel,
  emptyObjectives,
  filterObjectives,
  kamPart,
  kebabItems,
  objectiveChips,
  objectivesTitle,
  importSourcePlans,
  objectiveFor,
  planFor,
  planObjectOf,
  stakeholderColumns,
  stakeholderMatches,
  statusButtonTitle,
  statusOptions,
  type ObjectiveFilter,
  taskCompletion,
  type Chip,
  type Completion,
} from "./ipad-kam-logic";
import "./ipad-kam.css";

/** True for the flexipage components Key Account Management draws on a plan page (KAMModule.getComponent). */
export function isKamComponent(name: string, properties: Record<string, string>): boolean {
  return !!kamPart(name, properties.relatedListApiName);
}

/** Whether the snapshot can draw this component for this record; false lets the record page fall back to its placeholder. */
export function hasKam(snapshot: PublishedIpad, rec: PublishedRecordData): boolean {
  const kam = snapshot.screens?.kam;
  // A plan outside the list is read on demand (studio_kam_plan), so any plan record draws.
  return (
    !!kam && (!!planFor(kam, rec.id) || !!objectiveFor(kam, rec.id) || !!planObjectOf(rec.object))
  );
}

export function KamCard({
  snapshot,
  rec,
  name,
  properties,
}: {
  snapshot: PublishedIpad;
  rec: PublishedRecordData;
  name: string;
  properties: Record<string, string>;
}) {
  const kam = snapshot.screens?.kam;
  const hit = kamPart(name, properties.relatedListApiName);
  const plan = planFor(kam, rec.id);
  if (!kam || !hit) return null;
  const locale = "en-US";
  const actions = { kam, snapshot, plan: plan ?? undefined, rec } satisfies Ctx;
  if (hit.part === "actionPlans") {
    const objective = objectiveFor(kam, rec.id);
    return objective ? (
      <Sheeted ctx={{ ...actions, plan: undefined }}>
        {(on) => <ActionPlans plans={objective.actionPlans} kam={kam} locale={locale} on={on} />}
      </Sheeted>
    ) : (
      <NotRead what="Action plans" />
    );
  }
  if (!plan) return <OnDemand snapshot={snapshot} rec={rec} kam={kam} part={hit} />;
  return <PlanPart snapshot={snapshot} rec={rec} kam={kam} plan={plan} part={hit} />;
}

type Part = NonNullable<ReturnType<typeof kamPart>>;
interface Ctx {
  kam: PublishedKam;
  snapshot: PublishedIpad;
  plan?: KamPlan;
  rec: PublishedRecordData;
}
/** What the rows can ask the page to do: open a sheet (a form, a confirmation). */
interface On {
  sheet: (s: KamSheet) => void;
  filter: ObjectiveFilter;
  setFilter: (f: ObjectiveFilter) => void;
}

/** Owns the open sheet for the rows below it. */
function Sheeted({ ctx, children }: { ctx: Ctx; children: (on: On) => React.ReactNode }) {
  const [sheet, setSheet] = useState<KamSheet | null>(null);
  const [filter, setFilter] = useState<ObjectiveFilter>(NO_FILTER);
  const { kam, snapshot, rec } = ctx;
  const plan = ctx.plan ?? { object: "AccountPlan" as const, objectives: [] };
  const on: On = { sheet: setSheet, filter, setFilter };
  return (
    <>
      {children(on)}
      <KamSheets
        sheet={sheet}
        onClose={() => setSheet(null)}
        snapshot={snapshot}
        kam={kam}
        plan={plan}
        record={{ id: rec.id, object: rec.object, title: rec.title ?? "" }}
        filter={filter}
        onFilter={setFilter}
        onSheet={setSheet}
      />
    </>
  );
}

/** A kebab pick turned into a sheet: Add and Edit draw the object's layout; the rest say what the app does. */
function pick(item: KebabItem, on: On, rowTitle: string) {
  if (item.kind === "add" || item.kind === "edit")
    on.sheet({ kind: "form", object: item.object ?? "", label: item.title });
  else if (item.kind === "assignSprint")
    on.sheet({
      kind: "info",
      title: item.title,
      note: "the app lists the account’s sprints to pick one. Studio doesn’t read sprints yet.",
    });
  else if (item.kind === "markIncomplete")
    on.sheet({
      kind: "info",
      title: `${item.title}: ${rowTitle}`,
      note: "the app sets the tactic back to open without a form. Studio never writes.",
    });
  else
    on.sheet({
      kind: "info",
      title: `${item.title}: ${rowTitle}`,
      note: "the app asks you to confirm, then deletes the record. Studio never deletes.",
    });
}

function OnDemand({
  snapshot,
  rec,
  kam,
  part,
}: {
  snapshot: PublishedIpad;
  rec: PublishedRecordData;
  kam: PublishedKam;
  part: Part;
}) {
  const object = planObjectOf(rec.object);
  const { state, retry } = useLazyStudio(
    `kam-plan:${rec.id}`,
    () => window.lscApi.studioKamPlan(object ?? "AccountPlan", rec.id, kam.sync ?? []),
    (d) =>
      d as {
        plan: KamPlan | null;
        mode: PublishedKam["mode"];
        nomenclature: KamNomenclature;
        notes: string[];
      }
  );
  if (state.status === "loading") return <IpadWait label="Reading this plan" />;
  if (state.status === "error")
    return <IpadFail title="Couldn’t read this plan" message={state.message} onRetry={retry} />;
  const { plan, mode, nomenclature, notes } = state.data;
  if (!plan) return <NotRead what="This plan" />;
  return (
    <>
      <PlanPart
        snapshot={snapshot}
        rec={rec}
        kam={{ ...kam, mode, nomenclature, plans: { ...kam.plans, [rec.id]: plan } }}
        plan={plan}
        part={part}
      />
      <div className="studio-ipad-kam-note">
        Not in the preview: this plan wasn&rsquo;t among the most recently changed, so it was read
        as the connected admin without the rep&rsquo;s sync filters.
        {notes.map((n) => ` ${n}`).join("")}
      </div>
    </>
  );
}

function PlanPart({
  snapshot,
  rec,
  kam,
  plan,
  part,
}: {
  snapshot: PublishedIpad;
  rec: PublishedRecordData;
  kam: PublishedKam;
  plan: KamPlan;
  part: Part;
}) {
  const locale = "en-US";
  return (
    <Sheeted ctx={{ kam, snapshot, plan, rec }}>
      {(on) =>
        part.part === "stakeholders" ? (
          <Stakeholders plan={plan} on={on} />
        ) : part.part === "participants" ? (
          <Participants plan={plan} />
        ) : (
          <div className="studio-ipad-kam">
            {part.legacy && (
              <div className="studio-ipad-kam-note">
                The iPad draws this component as its older objectives list. Studio shows the newer
                accordion.
              </div>
            )}
            <Objectives plan={plan} kam={kam} locale={locale} on={on} />
          </div>
        )
      }
    </Sheeted>
  );
}

function NotRead({ what }: { what: string }) {
  return (
    <div className="studio-ipad-rec-card placeholder">
      <div className="studio-ipad-rec-ph-title">{what}</div>
      <div className="studio-ipad-rec-ph-note">
        Not in the preview: Studio reads the most recently changed plans, and this one wasn&rsquo;t
        among them.
      </div>
    </div>
  );
}

function Objectives({
  plan,
  kam,
  locale,
  on,
}: {
  plan: KamPlan;
  kam: PublishedKam;
  locale: string;
  on: On;
}) {
  const n = kam.nomenclature;
  const f = on.filter;
  const shown = filterObjectives(plan.objectives, f);
  const add = addItems(
    plan.object,
    importSourcePlans(kam).length > 0 || plan.object === "AccountPlan",
    n
  );
  return (
    <div className="studio-ipad-kam-list">
      <div className="studio-ipad-kam-bar" data-edit-through>
        <div className="studio-ipad-kam-bar-title">{objectivesTitle(n)}</div>
        <input
          className="studio-ipad-kam-search"
          placeholder="Search"
          aria-label="Search"
          value={f.search}
          onChange={(e) => on.setFilter({ ...f, search: e.target.value })}
        />
        <button
          type="button"
          className="studio-ipad-kam-menubtn"
          onClick={() => on.sheet({ kind: "filter" })}
        >
          Filter{f.products.length ? ` (${f.products.length})` : ""}
        </button>
        <StatusMenu
          title={statusButtonTitle(f.statuses)}
          options={statusOptions(plan.objectives, f)}
          selected={f.statuses.length === 1 ? f.statuses[0] : "all"}
          onPick={(id) =>
            on.setFilter({ ...f, statuses: id === "all" ? [] : [id as KamStatusKind] })
          }
        />
        {add.length === 1 ? (
          <button
            type="button"
            className="studio-ipad-kam-menubtn primary"
            onClick={() =>
              on.sheet({ kind: "form", object: "AccountPlanObjective", label: add[0].title })
            }
          >
            {add[0].title}
          </button>
        ) : (
          <KamMenu
            label="Add ▾"
            className="primary"
            items={add}
            onPick={(id) =>
              id === "new"
                ? on.sheet({ kind: "form", object: "AccountPlanObjective", label: add[0].title })
                : on.sheet({ kind: "importObjectives" })
            }
          />
        )}
      </div>
      {!plan.objectives.length ? (
        <div className="studio-ipad-kam-empty">{emptyObjectives(n)}</div>
      ) : !shown.length ? (
        <div className="studio-ipad-kam-empty">
          No {(n.objective ?? "Objective").toLowerCase()}s match
        </div>
      ) : (
        shown.map((o) => (
          <ObjectiveCard
            key={o.id}
            objective={o}
            kam={kam}
            locale={locale}
            on={on}
            planObject={plan.object}
          />
        ))
      )}
      <Gaps kam={kam} />
    </div>
  );
}

function Gaps({ kam }: { kam: PublishedKam }) {
  return (
    <div className="studio-ipad-kam-note">
      Not in the preview: the imported markers, template Deactivate, and Sync Updates.
      {!kam.configRead &&
        " The org’s KAM settings weren’t read, so status badges and standard names are shown."}
    </div>
  );
}

function ObjectiveCard({
  objective,
  kam,
  locale,
  on,
  planObject,
}: {
  objective: KamObjective;
  kam: PublishedKam;
  locale: string;
  on: On;
  planObject: KamPlan["object"];
}) {
  const [open, setOpen] = useState(false);
  const can = objective.actionPlans.length > 0;
  return (
    <div className="studio-ipad-kam-card">
      <CardHeader
        icon="target"
        title={objective.title}
        chips={objectiveChips(objective, kam.nomenclature)}
        done={completion(objective.kind, objective.percent, objective.status, kam.mode)}
        open={open}
        expandable={can}
        onToggle={() => setOpen(!open)}
        kebab={kebabItems("objective", objective.kind, planObject, kam.nomenclature)}
        onKebab={(i) => pick(i, on, objective.title)}
      />
      {open && can && (
        <div className="studio-ipad-kam-nested">
          <ActionPlans
            plans={objective.actionPlans}
            kam={kam}
            locale={locale}
            on={on}
            planObject={planObject}
          />
        </div>
      )}
    </div>
  );
}

function ActionPlans({
  plans,
  kam,
  locale,
  on,
  planObject = "AccountPlan",
}: {
  plans: KamActionPlan[];
  kam: PublishedKam;
  locale: string;
  on: On;
  planObject?: KamPlan["object"];
}) {
  return (
    <div className="studio-ipad-kam-list">
      {plans.map((a) => (
        <ActionPlanCard
          key={a.id}
          plan={a}
          kam={kam}
          locale={locale}
          on={on}
          planObject={planObject}
        />
      ))}
    </div>
  );
}

function ActionPlanCard({
  plan,
  kam,
  locale,
  on,
  planObject,
}: {
  plan: KamActionPlan;
  kam: PublishedKam;
  locale: string;
  on: On;
  planObject: KamPlan["object"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="studio-ipad-kam-card inner">
      <CardHeader
        icon="plan"
        title={plan.title}
        chips={actionPlanChips(plan, kam.nomenclature)}
        done={completion(plan.kind, plan.percent, plan.status, kam.mode)}
        open={open}
        expandable={plan.tasks.length > 0}
        onToggle={() => setOpen(!open)}
        kebab={kebabItems("actionPlan", plan.kind, planObject, kam.nomenclature)}
        onKebab={(i) => pick(i, on, plan.title)}
      />
      {open && plan.tasks.length > 0 && (
        <TaskTable tasks={plan.tasks} locale={locale} kam={kam} on={on} planObject={planObject} />
      )}
    </div>
  );
}

function TaskTable({
  tasks,
  locale,
  kam,
  on,
  planObject,
}: {
  tasks: KamTask[];
  locale: string;
  kam: PublishedKam;
  on: On;
  planObject: KamPlan["object"];
}) {
  return (
    <table className="studio-ipad-kam-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Owner</th>
          <th>Assigned To</th>
          <th>Due Date</th>
          <th aria-label="Status" />
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td className="title">{t.name}</td>
            <td>{t.owner ?? "—"}</td>
            <td>{t.assignedTo ?? "—"}</td>
            <td>{dueLabel(t.dueDate, locale)}</td>
            <td className="done">
              <Done done={taskCompletion(t)} />
            </td>
            <td className="kebab-cell">
              <Kebab
                items={kebabItems("tactic", t.kind, planObject, kam.nomenclature)}
                onPick={(i) => pick(i, on, t.name)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CardHeader({
  icon,
  title,
  chips,
  done,
  open,
  expandable,
  onToggle,
  kebab,
  onKebab,
}: {
  kebab: KebabItem[];
  onKebab: (i: KebabItem) => void;
  icon: "target" | "plan";
  title: string;
  chips: Chip[];
  done: Completion;
  open: boolean;
  expandable: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="studio-ipad-kam-head">
      <span className={`studio-ipad-kam-icon ${icon}`} aria-hidden="true" />
      <div className="studio-ipad-kam-main">
        <div className="studio-ipad-kam-title">{title}</div>
        <div className="studio-ipad-kam-chips">
          {chips.map((c, i) => (
            <span key={i} className={`studio-ipad-kam-chip${c.emphasis ? " em" : ""}`}>
              {c.label && <span className="label">{c.label} </span>}
              {c.value}
            </span>
          ))}
        </div>
      </div>
      <Done done={done} />
      <Kebab items={kebab} onPick={onKebab} />
      {expandable ? (
        <button
          type="button"
          className={`studio-ipad-kam-chevron${open ? " open" : ""}`}
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={onToggle}
          data-edit-through
        />
      ) : (
        <span className="studio-ipad-kam-chevron none" />
      )}
    </div>
  );
}

function Done({ done }: { done: Completion | ReturnType<typeof taskCompletion> }) {
  if (done.type === "markComplete")
    return <span className="studio-ipad-kam-mark">{done.title}</span>;
  if (done.type === "progress") {
    return (
      <span
        className="studio-ipad-kam-progress"
        role="progressbar"
        aria-valuenow={Math.round(done.percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className="bar">
          <span style={{ width: `${Math.round(done.percent)}%` }} />
        </span>
        <span className="pct">{Math.round(done.percent)}%</span>
      </span>
    );
  }
  return <span className={`studio-ipad-kam-badge ${done.variant}`}>{done.text}</span>;
}

function Stakeholders({ plan, on }: { plan: KamPlan; on: On }) {
  const [search, setSearch] = useState("");
  const rows = plan.stakeholders;
  const shown = rows?.filter((s) => stakeholderMatches(s, search));
  return (
    <div className="studio-ipad-rec-card studio-ipad-kam-tab">
      <div className="studio-ipad-kam-bar" data-edit-through>
        <div className="studio-ipad-kam-bar-title">Stakeholders</div>
        <input
          className="studio-ipad-kam-search"
          placeholder="Search Stakeholder"
          aria-label="Search Stakeholder"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="studio-ipad-kam-menubtn primary"
          onClick={() => on.sheet({ kind: "addStakeholder" })}
        >
          Add Stakeholder
        </button>
      </div>
      {!shown?.length ? (
        <div className="studio-ipad-kam-empty">
          {rows ? "No stakeholders" : "The iPad doesn’t sync stakeholders for this profile."}
        </div>
      ) : (
        shown.map((s) => (
          <div key={s.id} className="studio-ipad-kam-row">
            <div className="studio-ipad-kam-who">
              <div className="studio-ipad-kam-title">{s.title}</div>
              {s.nonProfiled && <div className="studio-ipad-kam-sub">Non-Profiled</div>}
            </div>
            {stakeholderColumns(s).map((c) => (
              <div key={c.label} className="studio-ipad-kam-col">
                <div className="studio-ipad-kam-sub">{c.label}</div>
                <div>{c.value}</div>
              </div>
            ))}
            <div className="studio-ipad-kam-col wide">
              <div className="studio-ipad-kam-sub">Team Members</div>
              <div>{s.members?.length ? s.members.join(", ") : "—"}</div>
            </div>
            <Kebab
              items={[
                { kind: "edit", title: "Edit Stakeholder", object: "AccountPlanStakeholder" },
                { kind: "edit", title: "Assign Participants", object: "AcctPlanPtcpStakeholder" },
                { kind: "delete", title: "Delete Stakeholder", destructive: true },
              ]}
              onPick={(i) => pick(i, on, s.title)}
            />
          </div>
        ))
      )}
      <div className="studio-ipad-kam-note">
        Not in the preview: specialty (the org has no Account field for it) and the columns set in
        the related list.
      </div>
    </div>
  );
}

function Participants({ plan }: { plan: KamPlan }) {
  const rows = plan.participants;
  return (
    <div className="studio-ipad-rec-card studio-ipad-kam-tab">
      {!rows?.length ? (
        <div className="studio-ipad-kam-empty">
          {rows ? "No participants" : "The iPad doesn’t sync participants for this profile."}
        </div>
      ) : (
        rows.map((p) => (
          <div key={p.id} className="studio-ipad-kam-row">
            <div className="studio-ipad-kam-who">
              <div className="studio-ipad-kam-title">{p.name}</div>
            </div>
            <div className="studio-ipad-kam-col">
              <div className="studio-ipad-kam-sub">Role</div>
              <div>{p.role ?? "—"}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
