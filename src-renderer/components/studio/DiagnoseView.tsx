import React, { useMemo, useRef, useState } from "react";
import { RefreshCw, SearchCheck, Sparkles } from "lucide-react";
import StateView from "../ui/StateView";
import { CheckRow, VerdictCard } from "./ReadinessView";
import { diagnosisPrompt, diagnosisVerdict, toCheck, type DiagnosisResult } from "./diagnose-logic";
import type { PendingChange } from "./changes";
import type { ProfileOption } from "./types";
import "./readiness.css";
import "./diagnose.css";
import { AssistantName } from "../../hooks/useAssistantName";

export interface DiagnoseViewProps {
  profiles: ProfileOption[];
  pending: PendingChange[];
  onPendingChange: (pending: PendingChange[]) => void;
  onAskClaude: (prompt: string) => void;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; text: string; result: DiagnosisResult };

/** Paste an error: match it against known misconfigurations and check which are in the org. */
export default function DiagnoseView({ profiles, pending, onPendingChange, onAskClaude }: DiagnoseViewProps) {
  const [text, setText] = useState("");
  const [checkOrg, setCheckOrg] = useState(true);
  const [state, setState] = useState<State>({ status: "idle" });
  const [open, setOpen] = useState<string | null>(null);
  const request = useRef(0);

  const run = async () => {
    const input = text.trim();
    if (!input) return;
    const token = ++request.current;
    setState({ status: "loading" });
    const res = await window.lscApi.studioDiagnose(input, checkOrg);
    if (token !== request.current) return;
    const error = res.error || res.data?.error;
    if (error) return setState({ status: "error", error });
    const result = res.data as DiagnosisResult;
    setState({ status: "ready", text: input, result });
    setOpen(result.items.find((i) => i.status === "found")?.id ?? null);
  };

  const ready = state.status === "ready" ? state : null;
  const connected = Boolean(ready?.result.checkedOrg);
  const checks = useMemo(() => ready?.result.items.map((i) => toCheck(i, connected)) ?? [], [ready, connected]);
  const verdict = ready && ready.result.items.length > 0 ? diagnosisVerdict(ready.result) : null;

  return (
    <div className="studio-page studio-diagnose ui-enter">
      <header className="studio-page-head">
        <div>
          <h2>Paste an error</h2>
          <p>Matches an error or symptom against setup mistakes seen in real LSC orgs, then checks which are in this one.</p>
        </div>
      </header>

      <div className="studio-diagnose-form">
        <label className="ui-label">
          Error message or what's going wrong
          <textarea
            className="ui-field"
            rows={5}
            value={text}
            placeholder="e.g. a sync error from the iPad, a failed publish, or “reps can't see the Samples tab”"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                run();
              }
            }}
          />
        </label>
        <div className="studio-diagnose-actions">
          <label className="ui-check">
            <input type="checkbox" checked={checkOrg} onChange={(e) => setCheckOrg(e.target.checked)} />
            Check the org (read-only)
          </label>
          <button className="studio-btn primary" disabled={!text.trim() || state.status === "loading"} onClick={run} aria-keyshortcuts="Meta+Enter">
            <SearchCheck aria-hidden="true" /> Find the cause
          </button>
        </div>
      </div>

      {state.status === "idle" && (
        <StateView
          kind="empty"
          layout="inline"
          icon={SearchCheck}
          title="Paste the exact text"
          detail="Object and field names, error codes and the screen it happened on all help."
        />
      )}
      {state.status === "loading" && (
        <StateView
          kind="loading"
          layout="inline"
          title={checkOrg ? "Matching and checking the org…" : "Matching known causes…"}
          detail={checkOrg ? "Every query is read-only." : undefined}
        />
      )}
      {state.status === "error" && (
        <StateView
          kind="error"
          layout="inline"
          title="Couldn't check this"
          detail={state.error}
          actions={
            <button className="studio-btn" onClick={run}>
              <RefreshCw aria-hidden="true" /> Try again
            </button>
          }
        />
      )}

      {ready && ready.result.items.length === 0 && (
        <StateView
          kind="empty"
          layout="inline"
          icon={SearchCheck}
          title="No known cause matches this"
          detail={
            <>
              Try the exact error text with object and field names, or ask <AssistantName /> to look at the org.
            </>
          }
          actions={
            <button className="studio-btn" onClick={() => onAskClaude(diagnosisPrompt(ready.text, ready.result))}>
              <Sparkles aria-hidden="true" /> Ask <AssistantName />
            </button>
          }
        />
      )}

      {ready && verdict && (
        <>
          <VerdictCard tone={verdict.tone} title={verdict.title} meta={ready.result.orgNote ?? (connected ? "Checked just now" : undefined)}>
            <div className="studio-verdict-actions">
              <button type="button" className="studio-link-btn" onClick={() => onAskClaude(diagnosisPrompt(ready.text, ready.result))}>
                <Sparkles size={12} aria-hidden="true" /> Ask <AssistantName /> about this error
              </button>
              <button type="button" className="studio-link-btn" onClick={run}>
                <RefreshCw size={12} aria-hidden="true" /> Check again
              </button>
            </div>
          </VerdictCard>

          <ol className="studio-checklist-rows">
            {checks.map((check, i) => (
              <CheckRow
                key={check.id}
                check={check}
                expanded={open === check.id}
                onToggle={() => setOpen(open === check.id ? null : check.id)}
                onShowSurface={() => {}}
                onAsk={() => onAskClaude(diagnosisPrompt(ready.text, ready.result, ready.result.items[i]))}
                fixProps={{ pending, onPendingChange, profiles }}
              />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
