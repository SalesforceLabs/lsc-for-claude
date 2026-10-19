import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Info, Sparkles, X } from "lucide-react";
import { useAssistantName } from "../../../hooks/useAssistantName";
import Segmented from "../../ui/Segmented";
import StateView from "../../ui/StateView";
import StatusIcon from "../../ui/StatusIcon";
import type { CodeEditorHandle } from "../../ui/CodeEditor";
import { analyzeScript, type ScriptDetail, type ScriptDiagnostic, type ScriptLibrary, type ScriptTestResult } from "./script-model";
import ScriptDetails from "./ScriptDetails";
import ScriptTestPanel from "./ScriptTestPanel";
import { SCRIPT_API } from "./script-api";
import { draftIsDirty, draftProblems, type ScriptDraft } from "./script-drafts";
import { TYPE_LABEL, type LibraryRow } from "./script-library-logic";
import { countProblems, fixProblemText, lineColumn, nextOfSeverity, problemLabel, sortProblems } from "./script-problems";
import { describeDiff, diffStats, summaryLine } from "./script-assist-logic";
import { shortcutLabel } from "./script-keys";

// CodeMirror is a few hundred KB: load it when the first script opens.
const CodeEditor = React.lazy(() => import("../../ui/CodeEditor"));

export type EditorTab = "code" | "details" | "test";

export interface Proposal {
  code: string;
  summary: string;
}

interface ScriptEditorPaneProps {
  draft: ScriptDraft;
  detail: ScriptDetail | null;
  library: ScriptLibrary;
  row: LibraryRow | null;
  takenComponentNames: readonly string[];
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  /** Something for this script is waiting in the tray. */
  queued: boolean;
  deleteQueued: boolean;
  proposal: Proposal | null;
  askOpen: boolean;
  isMac: boolean;
  editorRef: React.MutableRefObject<CodeEditorHandle | null>;
  onToggleAsk: () => void;
  onChange: (next: ScriptDraft) => void;
  onDiagnostics: (diags: ScriptDiagnostic[]) => void;
  onAccept: () => void;
  onReject: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onLoadLwc: () => void;
  onQueueDelete: (deleteBundle: boolean) => void;
  onUndoDelete: () => void;
  onResult: (result: ScriptTestResult | undefined) => void;
  onAskRoz: (result: ScriptTestResult) => void;
  /** Puts a request about a problem in Ask Roz's message box (opening the panel), without sending it. */
  onAskFix: (text: string) => void;
  /** The last test ran against code that has since changed. */
  testStale: boolean;
}

/** One script: header, Code / Details / Test, and the footer that queues its changes for review. */
export default function ScriptEditorPane(props: ScriptEditorPaneProps) {
  const { draft, detail, library, row, tab, onTab, queued, proposal, askOpen, isMac, editorRef, onChange } = props;
  const assistant = useAssistantName();
  const stageObjects = library.stageObjects;
  const dirty = draftIsDirty(draft, stageObjects);
  const blockers = useMemo(() => draftProblems(draft, props.takenComponentNames), [draft, props.takenComponentNames]);
  const status = row?.status ?? { tone: "info" as const, label: "New", detail: "Not in the org yet." };
  const typeLabel = TYPE_LABEL[draft.fields.type];

  // Problems come from the shared checks, a moment after typing stops.
  const [diagnostics, setDiagnostics] = useState<ScriptDiagnostic[]>(() => analyzeScript(draft.code, draft.fields));
  const { onDiagnostics } = props;
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = analyzeScript(draft.code, draft.fields);
      setDiagnostics(next);
      onDiagnostics(next);
    }, 250);
    return () => window.clearTimeout(id);
  }, [draft.code, draft.fields, onDiagnostics]);

  const counts = countProblems(diagnostics);
  const [listOpen, setListOpen] = useState(false);
  const lastJump = useRef<number | null>(null);
  const jump = (d: ScriptDiagnostic) => {
    lastJump.current = d.from;
    editorRef.current?.jumpToOffset(d.from);
  };
  const sorted = useMemo(() => sortProblems(diagnostics), [diagnostics]);
  const stats = useMemo(() => (proposal ? diffStats(draft.code, proposal.code) : null), [proposal, draft.code]);

  // A line from the Test tab's error: show the code, then go there once the editor is up.
  const jumpFromTest = (line: number, column: number) => {
    onTab("code");
    let frames = 0;
    const attempt = () => {
      if (editorRef.current) editorRef.current.jumpTo(line, column);
      else if (frames++ < 60) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  };

  return (
    <div className="scripts-editor" role="region" aria-label={draft.fields.name || "New script"}>
      <header className="studio-header">
        <div className="studio-heading">
          <h1 className="studio-title">{draft.fields.name || "Untitled script"}</h1>
          <div className="studio-subtitle scripts-status" title={`${status.label}. ${status.detail}`}>
            <StatusIcon tone={status.tone} size={14} />
            <span>
              {status.label}
              {status.detail ? ` — ${status.detail}` : ""}
            </span>
          </div>
        </div>
        <div className="studio-header-actions">
          <span className="ui-pill scripts-type-pill">{typeLabel}</span>
          <button
            className={`studio-btn collapsible${askOpen ? " active" : ""}`}
            aria-pressed={askOpen}
            onClick={props.onToggleAsk}
            title={`Ask ${assistant} to write or fix this script (${shortcutLabel("K", isMac)})`}
          >
            <Sparkles aria-hidden="true" />
            <span className="studio-btn-label">Ask {assistant}</span>
          </button>
        </div>
      </header>

      <div className="studio-subbar">
        <Segmented
          aria-label="Script view"
          value={tab}
          onChange={onTab}
          options={[
            { value: "code", label: "Code", count: counts.error + counts.warning > 0 ? counts.error + counts.warning : undefined },
            { value: "details", label: "Details" },
            { value: "test", label: "Test", title: `Test the script against a real record (${isMac ? "⇧⌘↵" : "Ctrl+Shift+Enter"})` },
          ]}
        />
      </div>

      <div className="scripts-body">
        {tab === "code" && (
          <div className="scripts-code">
            {proposal && (
              <div className="scripts-proposal" role="status">
                <Sparkles size={16} aria-hidden="true" />
                <div className="scripts-proposal-text">
                  <strong>
                    {assistant}'s proposal{stats ? ` · ${describeDiff(stats)}` : ""}
                  </strong>
                  <span title={proposal.summary}>{summaryLine(proposal.summary)}</span>
                </div>
                <button className="studio-btn" onClick={props.onReject} title="Keep the code as it is (Esc)">
                  <X size={14} aria-hidden="true" />
                  Reject
                  <kbd className="scripts-kbd">Esc</kbd>
                </button>
                <button className="studio-btn primary" onClick={props.onAccept} title={`Use the proposal; one undo brings the old code back (${shortcutLabel("↵", isMac)})`}>
                  <Check size={14} aria-hidden="true" />
                  Accept
                  <kbd className="scripts-kbd">{shortcutLabel("↵", isMac)}</kbd>
                </button>
              </div>
            )}
            <div className="scripts-editor-box">
              <Suspense fallback={<StateView kind="loading" title="Loading the editor…" layout="fill" />}>
                <CodeEditor
                  ref={editorRef}
                  aria-label={`Code of ${draft.fields.name || "the script"}`}
                  value={draft.code}
                  onChange={(code) => onChange({ ...draft, code })}
                  diagnostics={diagnostics}
                  completions={SCRIPT_API}
                  proposal={proposal ? proposal.code : null}
                  readOnly={!!detail && !detail.lwc.editable && detail.lwc.exists}
                />
              </Suspense>
            </div>
            <div className="scripts-problems">
              <div className="scripts-problems-bar">
                {counts.error + counts.warning + counts.info === 0 ? (
                  <span className="scripts-problems-none">
                    <StatusIcon tone="pass" size={14} /> No problems found
                  </span>
                ) : (
                  <>
                    <button className="scripts-problems-toggle ui-icon-btn" aria-expanded={listOpen} aria-label={listOpen ? "Hide problems" : "Show problems"} onClick={() => setListOpen(!listOpen)}>
                      {listOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    </button>
                    {(["error", "warning", "info"] as const).map(
                      (sev) =>
                        counts[sev] > 0 && (
                          <button
                            key={sev}
                            className={`scripts-chip ${sev}`}
                            title="Go to the next one"
                            onClick={() => {
                              const next = nextOfSeverity(diagnostics, sev, lastJump.current);
                              if (next) jump(next);
                            }}
                          >
                            <StatusIcon tone={sev === "error" ? "error" : sev === "warning" ? "warning" : "info"} size={14} />
                            {problemLabel(sev, counts[sev])}
                          </button>
                        )
                    )}
                  </>
                )}
              </div>
              {listOpen && sorted.length > 0 && (
                <ul className="scripts-problems-list">
                  {sorted.map((d, i) => {
                    const at = lineColumn(draft.code, d.from);
                    return (
                      <li key={`${d.id}:${d.from}:${i}`} className="scripts-problem-row">
                        <button className="scripts-problem" onClick={() => jump(d)}>
                          <StatusIcon tone={d.severity === "info" ? "info" : d.severity} size={14} />
                          <span className="scripts-problem-text">
                            <span>{d.message}</span>
                            {d.detail && <span className="scripts-problem-detail">{d.detail}</span>}
                          </span>
                          <span className="scripts-problem-at">{d.from === 0 && d.to === 0 ? "Whole script" : `Line ${at.line}`}</span>
                        </button>
                        <button
                          className="studio-btn sm ghost scripts-problem-ask"
                          title={`Put this in the ${assistant} message box so you can add context before sending`}
                          onClick={() => props.onAskFix(fixProblemText(d, at.line))}
                        >
                          <Sparkles size={14} aria-hidden="true" />
                          Ask {assistant} to fix
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === "details" && (
          <div className="scripts-scroll">
            <ScriptDetails
              draft={draft}
              detail={detail}
              library={library}
              takenComponentNames={props.takenComponentNames}
              deleteQueued={props.deleteQueued}
              onChange={onChange}
              onLoadLwc={props.onLoadLwc}
              onQueueDelete={props.onQueueDelete}
              onUndoDelete={props.onUndoDelete}
            />
          </div>
        )}

        {tab === "test" && (
          <div className="scripts-test">
            {props.testStale && (
              <p className="scripts-test-stale" role="status">
                <Info size={14} aria-hidden="true" />
                <span>
                  <strong>From an earlier version.</strong> The code has changed since this ran. Run it again to test the current code.
                </span>
              </p>
            )}
            <ScriptTestPanel
              onJumpTo={jumpFromTest}
              script={{ key: draft.key, name: draft.fields.name, type: draft.fields.type, objectName: draft.fields.objectName, operationEventType: draft.fields.operationEventType }}
              code={draft.code}
              onResult={props.onResult}
              onAskRoz={props.onAskRoz}
            />
          </div>
        )}
      </div>

      <footer className="scripts-footer">
        <span className={`scripts-footer-state${dirty ? " dirty" : ""}`} role="status">
          {dirty && !queued && blockers.length === 0 && <span className="scripts-dirty" aria-hidden="true" />}
          {blockers.length > 0 && dirty ? (
            <span className="scripts-footer-problem">{blockers[0]}</span>
          ) : (
            <span className="scripts-footer-text">
              {queued ? "Queued — Review & save applies it" : dirty ? (draft.isNew ? "Not saved yet" : "Unsaved changes") : "No changes"}
            </span>
          )}
        </span>
        <button className="studio-btn ghost" onClick={props.onDiscard} disabled={!dirty && !queued}>
          {draft.isNew ? "Discard draft" : "Discard"}
        </button>
        <button
          className="studio-btn primary"
          onClick={props.onSave}
          disabled={(!dirty && !queued) || blockers.length > 0 || !!proposal}
          title={proposal ? "Accept or reject the suggestion first" : `Queue the changes for review (${shortcutLabel("S", isMac)})`}
        >
          Review & save
        </button>
      </footer>
    </div>
  );
}
