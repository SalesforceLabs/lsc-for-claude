import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FlaskConical, Play, Search, Sparkles, TextCursorInput } from "lucide-react";
import Segmented from "../../ui/Segmented";
import SearchPicker from "../../ui/SearchPicker";
import Spinner from "../../ui/Spinner";
import StateView from "../../ui/StateView";
import StatusIcon from "../../ui/StatusIcon";
import type { ScriptTestResult, ScriptType } from "./script-model";
import {
  canRun,
  cleanEnv,
  envFields,
  formatLocation,
  formatMs,
  headline,
  needsObject,
  recordOption,
  shouldOfferFix,
  statusTone,
  type TestEnv,
  type TestPlatform,
  type TestRecord,
  type TestRunResult,
} from "./script-test-logic";
import "./script-test.css";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export interface ScriptTestPanelProps {
  script: { key: string; name: string; type: ScriptType; objectName: string | null; operationEventType: string | null };
  code: string;
  onResult?: (result: ScriptTestResult | undefined) => void;
  onAskRoz?: (result: ScriptTestResult) => void;
  /** Move the editor to a position in the code (1-based). */
  onJumpTo?: (line: number, column: number) => void;
}

interface Remembered {
  record: TestRecord | null;
  platform: TestPlatform;
  env: TestEnv;
  result: TestRunResult | null;
  ranEnv: TestEnv;
}
/** Last record, inputs and result per script, kept for the session. */
const memory = new Map<string, Remembered>();

const SEARCH_DEBOUNCE_MS = 300;

const PLATFORMS = [
  { value: "web" as const, label: "Web" },
  { value: "ipad" as const, label: "iPad" },
];

const failure = (res: { error?: string; data?: unknown }): string | undefined =>
  res.error || (res.data as { error?: string } | undefined)?.error || undefined;

/** Runs the code in the editor against a real record, read-only, and shows what the rep would see. */
export default function ScriptTestPanel({ script, code, onResult, onAskRoz, onJumpTo }: ScriptTestPanelProps) {
  const memoryKey = `${script.key}|${script.type}|${script.objectName ?? ""}`;
  const [records, setRecords] = useState<TestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [record, setRecord] = useState<TestRecord | null>(null);
  const [picking, setPicking] = useState(false);
  const [platform, setPlatform] = useState<TestPlatform>("ipad");
  const [env, setEnv] = useState<TestEnv>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | undefined>();
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [ranEnv, setRanEnv] = useState<TestEnv>({});
  const latestSearch = useRef(0);
  const latestRun = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const search = useCallback(
    async (q: string, selectFirst: boolean) => {
      const request = ++latestSearch.current;
      setLoading(true);
      try {
        const res = await window.lscApi.studioScriptTestRecords({ type: script.type, objectName: script.objectName, search: q.trim() || undefined });
        if (request !== latestSearch.current) return;
        const err = failure(res);
        setLoadError(err);
        const list = err ? [] : (((res.data as { records?: TestRecord[] })?.records) ?? []);
        setRecords(list);
        if (selectFirst && list.length) setRecord((cur) => cur ?? list[0]);
      } catch (e) {
        if (request === latestSearch.current) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (request === latestSearch.current) setLoading(false);
      }
    },
    [script.type, script.objectName],
  );

  // A different script (or object) has its own records and its own last result.
  useEffect(() => {
    // Coming back to a script (the Test tab is unmounted while hidden) restores its record, inputs and last result.
    const saved = memory.get(memoryKey);
    setRecord(saved?.record ?? null);
    setResult(saved?.result ?? null);
    setRanEnv(saved?.ranEnv ?? {});
    if (saved) {
      setPlatform(saved.platform);
      setEnv(saved.env);
    }
    setRunError(undefined);
    onResultRef.current?.((saved?.result as ScriptTestResult | null) ?? undefined);
    if (needsObject(script.type, script.objectName)) {
      setLoading(false);
      setRecords([]);
      return;
    }
    void search("", true);
    return () => {
      latestSearch.current++;
      latestRun.current++;
      clearTimeout(timer.current);
    };
  }, [memoryKey, script.type, script.objectName, search]);

  useEffect(() => {
    if (record || result) memory.set(memoryKey, { record, platform, env, result, ranEnv });
  }, [memoryKey, record, platform, env, result, ranEnv]);

  const run = useCallback(async () => {
    if (!record || running) return;
    const request = ++latestRun.current;
    const sent = cleanEnv(script.type, env);
    setRunning(true);
    setRunError(undefined);
    try {
      const res = await window.lscApi.studioScriptTest({
        code,
        type: script.type,
        recordId: record.id,
        objectName: script.objectName,
        operationEventType: script.operationEventType,
        platform,
        env: sent,
      });
      if (request !== latestRun.current) return;
      const err = failure(res);
      if (err) {
        setRunError(err);
        return;
      }
      const r = res.data as TestRunResult;
      setResult(r);
      setRanEnv(sent);
      onResultRef.current?.(r as ScriptTestResult);
    } catch (e) {
      if (request === latestRun.current) setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === latestRun.current) setRunning(false);
    }
  }, [code, env, platform, record, running, script.objectName, script.operationEventType, script.type]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRun(script.type, script.objectName, code, record?.id ?? null)) {
      e.preventDefault();
      void run();
    }
  };

  const options = useMemo(() => records.map(recordOption), [records]);
  const fields = envFields(script.type);
  const runnable = canRun(script.type, script.objectName, code, record?.id ?? null) && !running;

  const body = () => {
    if (needsObject(script.type, script.objectName)) {
      return <StateView kind="empty" icon={TextCursorInput} title="Choose an object first" detail="Set the script's object to pick a record to test against." layout="fill" />;
    }
    if (loadError && !records.length) {
      return (
        <StateView
          kind="error"
          title="Couldn't load records"
          detail={loadError}
          layout="fill"
          actions={
            <button type="button" className="studio-btn" onClick={() => void search("", true)}>
              Retry
            </button>
          }
        />
      );
    }
    if (loading && !records.length) return <StateView kind="loading" title="Loading records" layout="fill" />;
    if (!records.length && !record) {
      return (
        <StateView
          kind="empty"
          icon={FlaskConical}
          title={script.type === "VisitActionValidation" ? "No visits to test against" : `No ${script.objectName} records`}
          detail="The script runs against a real record in the connected org, read-only. Create one and try again."
          layout="fill"
          actions={
            <button type="button" className="studio-btn" onClick={() => void search("", true)}>
              Refresh
            </button>
          }
        />
      );
    }
    if (runError && !result) {
      return (
        <StateView
          kind="error"
          title="The test didn't run"
          detail={runError}
          layout="fill"
          actions={
            <button type="button" className="studio-btn" onClick={() => void run()} disabled={!runnable}>
              Retry
            </button>
          }
        />
      );
    }
    if (running && !result) return <StateView kind="loading" title="Running against the org" detail="Reading the record and anything the script queries." layout="fill" />;
    if (!result) {
      return (
        <StateView
          kind="empty"
          icon={FlaskConical}
          title="Run the script to see what a rep would"
          detail="It runs against the chosen record in a simulation, read-only. Nothing is saved to the org."
          layout="fill"
        />
      );
    }
    return <Result result={result} env={ranEnv} script={script} busy={running} runError={runError} onJumpTo={onJumpTo} onAskRoz={onAskRoz} />;
  };

  return (
    <div className="stest" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="stest-setup">
        <div className="stest-row">
          <span className="stest-label">Record</span>
          <button
            type="button"
            className="studio-btn stest-record"
            onClick={() => setPicking(true)}
            disabled={needsObject(script.type, script.objectName)}
            title={record ? record.name : "Choose a record"}
          >
            <Search aria-hidden="true" />
            <span>{record ? recordOption(record).label : "Choose a record"}</span>
          </button>
          <Segmented options={PLATFORMS} value={platform} onChange={setPlatform} size="sm" aria-label="Platform" />
        </div>
        {record && <div className="stest-kbd">{recordOption(record).detail}</div>}
        <div className="stest-row">
          {fields.map((f) => (
            <label key={f.key} className="stest-env">
              <span className="stest-label">{f.label}</span>
              <input
                className="studio-input"
                value={env[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setEnv((cur) => ({ ...cur, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="stest-row">
          <button type="button" className="studio-btn primary" onClick={() => void run()} disabled={!runnable}>
            {running ? <Spinner size={14} /> : <Play aria-hidden="true" />}
            {running ? "Running" : "Run test"}
          </button>
          <span className="stest-kbd">{IS_MAC ? "⌘↵" : "Ctrl+Enter"} to run</span>
        </div>
      </div>
      <div className="stest-body-wrap">{body()}</div>
      {picking && (
        <SearchPicker
          eyebrow="Test record"
          title={script.type === "VisitActionValidation" ? "Pick a visit" : `Pick a ${script.objectName}`}
          description="The script runs against this record as it is saved in the org."
          options={options}
          placeholder="Search by name or account"
          emptyTitle="No matching records"
          emptyIcon={Search}
          searching={loading}
          error={loadError}
          onQueryChange={(q) => {
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void search(q, false), SEARCH_DEBOUNCE_MS);
          }}
          onPick={(id) => {
            setRecord(records.find((r) => r.id === id) ?? null);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function Result({
  result,
  env,
  script,
  busy,
  runError,
  onJumpTo,
  onAskRoz,
}: {
  result: TestRunResult;
  env: TestEnv;
  script: ScriptTestPanelProps["script"];
  busy: boolean;
  runError?: string;
  onJumpTo?: ScriptTestPanelProps["onJumpTo"];
  onAskRoz?: ScriptTestPanelProps["onAskRoz"];
}) {
  const head = headline(result, script.type, env);
  const where = formatLocation(result.error);
  return (
    <div className={`stest-body${busy ? " busy" : ""}`}>
      {runError && (
        <div className="stest-error" role="alert">
          <div className="stest-error-message">{runError}</div>
        </div>
      )}
      <div className="stest-dialog">
        <div className="stest-dialog-head">
          <StatusIcon tone={head.tone} size={24} />
          <div>
            <h3 className="stest-dialog-title">{head.title}</h3>
            {head.detail && <div className="stest-dialog-detail">{head.detail}</div>}
          </div>
          <span className="stest-dialog-meta">{formatMs(result.durationMs)}</span>
        </div>
        {result.results.length > 0 ? (
          <ul className="stest-results">
            {result.results.map((r, i) => (
              <li key={i} className="stest-result">
                <StatusIcon tone={statusTone(r.status)} size={18} />
                <span>{r.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          !result.error && <div className="stest-result-empty">The script returned no results.</div>
        )}
      </div>

      {result.error && (
        <div className="stest-error" role="alert">
          <div className="stest-error-head">
            {where && <span className="ui-pill error">{where}</span>}
            {where && onJumpTo && (
              <button type="button" className="studio-btn sm ghost" onClick={() => onJumpTo(result.error!.line!, result.error!.column ?? 1)}>
                Jump to line
              </button>
            )}
          </div>
          <div className="stest-error-message">{result.error.message}</div>
        </div>
      )}

      {result.contract.length > 0 && (
        <ul className="stest-contract">
          {result.contract.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}

      {onAskRoz && shouldOfferFix(result) && (
        <div className="stest-actions">
          <button type="button" className="studio-btn" onClick={() => onAskRoz(result as ScriptTestResult)}>
            <Sparkles aria-hidden="true" />
            Ask Roz to fix
          </button>
        </div>
      )}

      <Section title="Logs" count={result.logs.length} empty="The script wrote nothing to the log.">
        <pre className="stest-log">
          {result.logs.map((l, i) => (
            <div key={i} className={l.level}>
              {l.text}
            </div>
          ))}
        </pre>
      </Section>
      <Section title="Queries" count={result.queries.length} empty="The script made no db queries.">
        {result.queries.map((q, i) => (
          <div key={i} className="stest-query">
            <code>{q.soql}</code>
            <div className="stest-query-meta">
              <span>
                {q.rows.toLocaleString("en-US")} {q.rows === 1 ? "row" : "rows"}
              </span>
              <span>{formatMs(q.ms)}</span>
              {q.error && <span className="ui-pill error">{q.error}</span>}
            </div>
          </div>
        ))}
      </Section>
      {result.recorded && result.recorded.length > 0 && (
        <Section title="Writes not applied" count={result.recorded.length} empty="">
          <pre className="stest-log">{result.recorded.map((w) => JSON.stringify(w)).join("\n")}</pre>
        </Section>
      )}

      {result.notes.length > 0 && (
        <ul className="stest-notes">
          {result.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <details className="stest-section">
      <summary>
        <ChevronRight className="chev" size={14} aria-hidden="true" />
        <span>{title}</span>
        <span className="ui-pill">{count}</span>
      </summary>
      <div className="stest-section-body">{count > 0 ? children : <div className="stest-result-empty">{empty}</div>}</div>
    </details>
  );
}
