import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Backdrop, linkBtn, Magnifier, NavBar, Note, type SheetContext } from "../../ipad-sheet-ui";
import { EmptyArt } from "../../IpadHome";
import { useLazyStudio } from "../../useLazyStudio";
import {
  actionLabel,
  formatDate,
  progress,
  toggleChoice,
  unansweredRequired,
  visibleSurveys,
  type ListTab,
} from "./logic";
import type { Answers, PublishedSurveys, SurveyForm, SurveyListRow, SurveyQuestion } from "./types";
import "./surveys.css";

/**
 * Surveys from the ••• menu. iOS: OCEDemo/Tabs/Survey — SurveyHeaderView (title, Open / Completed, search),
 * SurveyRelatedListView (Open cards with a Launch button; Completed table) and the question form
 * (SurveyViewModel, SurveysQuestionViewModel, SurveyComponentFactory). Answers live in this sheet only; Submit
 * is inert.
 */
export default function SurveySheet({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const accountId = ctx.record?.object === "Account" ? ctx.record.id : "";
  const [open, setOpen] = useState<SurveyListRow | null>(null);
  if (open)
    return <SurveyForm ctx={ctx} row={open} onBack={() => setOpen(null)} onClose={onClose} />;
  return (
    <Backdrop onClose={onClose} className="survey">
      <NavBar left={linkBtn("Close", onClose)} title="Surveys" />
      <SurveyList snapshot={ctx.snapshot} accountId={accountId} onOpen={setOpen} />
    </Backdrop>
  );
}

/**
 * The Surveys tab of an account's record page: `surveyListView` (SFComponentSurveysVC.swift) embeds the same
 * SurveyRelatedListCoordinator the ••• menu presents, not modally. Launch opens the question form over the screen.
 */
export function SurveysCard({ ctx }: { ctx: SheetContext }) {
  const accountId = ctx.record?.object === "Account" ? ctx.record.id : "";
  const [open, setOpen] = useState<SurveyListRow | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setScreen((ref.current?.closest(".studio-ipad-screen") as HTMLElement | null) ?? null);
  }, []);
  return (
    <div ref={ref} className="studio-ipad-rec-card studio-ipad-sv-inline">
      {accountId ? (
        <SurveyList snapshot={ctx.snapshot} accountId={accountId} onOpen={setOpen} />
      ) : (
        <Note>Not in the preview: surveys of a visit&rsquo;s account. Open the account to see them.</Note>
      )}
      {open &&
        screen &&
        createPortal(
          <SurveyForm ctx={ctx} row={open} onBack={() => setOpen(null)} onClose={() => setOpen(null)} />,
          screen
        )}
    </div>
  );
}

/** Open / Completed, search and the rows (SurveyHeaderView + SurveyRelatedListView). */
function SurveyList({
  snapshot,
  accountId,
  onOpen,
}: {
  snapshot: SheetContext["snapshot"];
  accountId: string;
  onOpen: (row: SurveyListRow) => void;
}) {
  const [tab, setTab] = useState<ListTab>("Open");
  const [search, setSearch] = useState("");
  const { state, retry } = useLazyStudio<PublishedSurveys>(
    accountId,
    () =>
      accountId
        ? window.lscApi.studioSurveyData({ accountId, viewerUserId: snapshot.viewer?.userId })
        : Promise.resolve({ error: "No account is open." }),
    (answer) => {
      const d = answer as PublishedSurveys | undefined;
      if (!d?.surveys) throw new Error("No survey data came back.");
      return d;
    }
  );

  const rows = state.status === "ready" ? visibleSurveys(state.data.surveys, tab, search) : [];
  return (
    <>
      <div className="studio-ipad-act-seg">
        {(["Open", "Completed"] as const).map((t) => (
          <span
            key={t}
            data-edit-through
            className={t === tab ? "on" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="studio-ipad-act-search">
        <Magnifier />
        <input
          data-edit-through
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="studio-ipad-sv-body">
        {state.status === "loading" && <div className="studio-ipad-sv-empty">Loading…</div>}
        {state.status === "error" && (
          <div className="studio-ipad-sv-empty">
            {state.message} {linkBtn("Try again", retry)}
          </div>
        )}
        {state.status === "ready" && rows.length === 0 && (
          <div className="studio-ipad-act-empty">
            <EmptyArt height={188} />
            <div className="studio-ipad-act-emptyt">No data available</div>
          </div>
        )}
        {tab === "Open" &&
          rows.map((r) => (
            <div key={r.id} className="studio-ipad-sv-card">
              <div className="studio-ipad-sv-card-main">
                <div className="studio-ipad-sv-name">{r.name}</div>
                {r.version != null && <div className="studio-ipad-sv-sub">Version {r.version}</div>}
                <div className="studio-ipad-sv-bar">
                  <i style={{ width: `${r.percent}%` }} />
                </div>
                <div className="studio-ipad-sv-sub">{r.percent}% Completed</div>
              </div>
              <button
                type="button"
                data-edit-through
                className="studio-ipad-sv-btn on"
                onClick={() => onOpen(r)}
              >
                {actionLabel(r)}
              </button>
            </div>
          ))}
        {tab === "Completed" && rows.length > 0 && (
          <table className="studio-ipad-sv-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Completed By</th>
                <th>Completion Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.completedBy ?? ""}</td>
                  <td>{formatDate(r.completedOn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Note>
        {[
          ...(state.status === "ready" ? state.data.notes : []),
          "Not in the preview: surveys shared by territory or visit, linked products and the Products filter, estimated completion time, and answers of completed surveys.",
        ].join(" ")}
      </Note>
    </>
  );
}

function SurveyForm({
  ctx,
  row,
  onBack,
  onClose,
}: {
  ctx: SheetContext;
  row: SurveyListRow;
  onBack: () => void;
  onClose: () => void;
}) {
  const cacheRecordId = ctx.snapshot.cache?.recordId ?? "";
  const { state, retry } = useLazyStudio<SurveyForm>(
    `${cacheRecordId}:${row.developerName}:${row.version}`,
    () =>
      window.lscApi.studioSurveyData({
        developerName: row.developerName,
        version: row.version,
        cacheRecordId,
      }),
    (answer) => {
      const f = (answer as { form?: SurveyForm } | undefined)?.form;
      if (!f) throw new Error("No survey came back.");
      return f;
    }
  );
  const [answers, setAnswers] = useState<Answers>({});
  const [page, setPage] = useState(0);
  const [tried, setTried] = useState(false);
  const set = (id: string, v: string | string[]) => setAnswers((a) => ({ ...a, [id]: v }));

  const form = state.status === "ready" ? state.data : null;
  const cur = form?.pages[page];
  const missing = cur ? unansweredRequired(cur, answers) : [];
  const last = form ? page >= form.pages.length - 1 : true;
  const p = form ? progress(form.pages, answers) : { answered: 0, total: 0 };

  return (
    <Backdrop onClose={onClose} className="survey">
      <NavBar
        left={linkBtn("Cancel", onBack)}
        title={form?.title || row.name}
        right={linkBtn("Submit")}
      />
      <div className="studio-ipad-sv-body">
        {state.status === "loading" && <div className="studio-ipad-sv-empty">Loading…</div>}
        {state.status === "error" && (
          <div className="studio-ipad-sv-empty">
            {state.message} {linkBtn("Try again", retry)}
          </div>
        )}
        {cur && (
          <>
            <div className="studio-ipad-sv-page">{cur.label}</div>
            {cur.questions.map((q) => (
              <Question
                key={q.id}
                q={q}
                value={answers[q.id]}
                set={set}
                flag={tried && missing.includes(q)}
                toggle={(c) => setAnswers((a) => toggleChoice(a, q.id, c))}
              />
            ))}
          </>
        )}
      </div>
      {form && (
        <div className="studio-ipad-sv-foot">
          <button
            type="button"
            data-edit-through
            className="studio-ipad-sv-btn"
            disabled={page === 0}
            onClick={() => {
              setPage(page - 1);
              setTried(false);
            }}
          >
            Back
          </button>
          <span className={tried && missing.length ? "studio-ipad-sv-warn" : ""}>
            {tried && missing.length
              ? "Please answer required questions"
              : `${p.answered} of ${p.total} answered · page ${page + 1} of ${form.pages.length}`}
          </span>
          {last ? (
            <button type="button" className="studio-ipad-sv-btn on" disabled>
              Submit
            </button>
          ) : (
            <button
              type="button"
              data-edit-through
              className="studio-ipad-sv-btn on"
              onClick={() => {
                if (missing.length) setTried(true);
                else {
                  setPage(page + 1);
                  setTried(false);
                }
              }}
            >
              Next
            </button>
          )}
        </div>
      )}
      <Note>
        Not in the preview: branching between pages, conditional questions, saving and submitting.
        The welcome page shows as text.
      </Note>
    </Backdrop>
  );
}

/** One question drawn as the device's control for its type (SurveyComponentFactory). */
function Question({
  q,
  value,
  set,
  toggle,
  flag,
}: {
  q: SurveyQuestion;
  value: string | string[] | undefined;
  set: (id: string, v: string | string[]) => void;
  toggle: (choice: string) => void;
  flag: boolean;
}) {
  const str = typeof value === "string" ? value : "";
  const list = Array.isArray(value) ? value : [];
  return (
    <div className="studio-ipad-sv-q">
      <div className="studio-ipad-sv-qt">
        {q.text}
        {q.required && <span className="studio-ipad-sv-req"> *</span>}
      </div>
      {q.help && <div className="studio-ipad-sv-help">{q.help}</div>}
      {flag && <div className="studio-ipad-sv-warn">Required</div>}
      {(q.kind === "single" || q.kind === "picklist") && (
        <div className="studio-ipad-sv-choices">
          {q.choices.map((c) => (
            <div
              key={c.id}
              data-edit-through
              className={`studio-ipad-sv-choice${str === c.id ? " on" : ""}`}
              onClick={() => set(q.id, c.id)}
            >
              <i />
              {c.label}
            </div>
          ))}
        </div>
      )}
      {q.kind === "multi" && (
        <div className="studio-ipad-sv-choices">
          {q.choices.map((c) => (
            <div
              key={c.id}
              data-edit-through
              className={`studio-ipad-sv-choice box${list.includes(c.id) ? " on" : ""}`}
              onClick={() => toggle(c.id)}
            >
              <i />
              {c.label}
            </div>
          ))}
        </div>
      )}
      {q.kind === "rating" && (
        <div className="studio-ipad-sv-scale">
          {q.choices.map((c) => (
            <span
              key={c.id}
              data-edit-through
              className={str === c.id ? "on" : ""}
              onClick={() => set(q.id, c.id)}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}
      {q.kind === "slider" && (
        <input
          data-edit-through
          className="studio-ipad-sv-input"
          type="range"
          min={q.min ?? 0}
          max={q.max ?? 10}
          value={str || String(q.min ?? 0)}
          onChange={(e) => set(q.id, e.target.value)}
        />
      )}
      {q.kind === "date" && (
        <input
          data-edit-through
          className="studio-ipad-sv-input"
          type="date"
          value={str}
          onChange={(e) => set(q.id, e.target.value)}
        />
      )}
      {q.kind === "short" && (
        <input
          data-edit-through
          className="studio-ipad-sv-input"
          value={str}
          onChange={(e) => set(q.id, e.target.value)}
        />
      )}
      {q.kind === "text" && (
        <textarea
          data-edit-through
          className="studio-ipad-sv-input"
          rows={3}
          value={str}
          onChange={(e) => set(q.id, e.target.value)}
        />
      )}
    </div>
  );
}
