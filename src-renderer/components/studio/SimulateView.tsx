import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PerfSimRecord } from "../../types";
import {
  asSimSummary,
  connectionLabel,
  connectionRef,
  formatBytes,
  formatSeconds,
  newConnections,
  parseSObjectList,
  rankTables,
  simSummary,
  type SfConnection,
  type SimFlow,
  type SimJobStatus,
  type SimRunOptions,
  type SimulationResult,
} from "./sim-types";
import { formatNumber, planFileName } from "./perf-plan";
import "./perf-editor.css";

/** The simulation in flight, kept so polling resumes if the view is left and reopened. */
const ACTIVE_JOB_KEY = "lsc.studio.simJob";
const POLL_MS = 2000;
const MAX_POLL_FAILURES = 5;
/** How long to watch for a new sf CLI connection after opening the browser to sign in. */
const LOGIN_WAIT_MS = 5 * 60_000;
const LOGIN_POLL_MS = 3000;
const DEFAULT_MINUTES = 15;
const TOP_TABLES = 15;

type Response = { data?: unknown & { error?: string }; error?: string };
const responseError = (res: Response) => res.error || res.data?.error;

const LOGIN_URLS = [
  { label: "Production", url: "https://login.salesforce.com" },
  { label: "Sandbox", url: "https://test.salesforce.com" },
];

const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

function elapsed(from: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** A positive whole number from a text field, or undefined when blank or invalid. */
function wholeNumber(text: string): number | undefined {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n > 0 ? n : undefined;
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="studio-perf-card studio-sim-stat">
      <span className="studio-perf-field-label">{label}</span>
      <span className="studio-sim-stat-value">{value}</span>
      {detail && <span className="studio-perf-hint">{detail}</span>}
    </div>
  );
}

function SimResult({ result, status, onExport, onExportReport }: {
  result: SimulationResult;
  status: PerfSimRecord["status"];
  onExport: () => void;
  onExportReport: () => void;
}) {
  const [all, setAll] = useState(false);
  const { downloaded, flagged } = rankTables(result.tables);
  const shown = all ? downloaded : downloaded.slice(0, TOP_TABLES);
  const t = result.totals;
  const partial = status === "cancelled" || result.tables.some((x) => x.truncated);
  return (
    <div className="studio-perf-report">
      <div className={`studio-finding ${partial ? "warning" : "info"} studio-perf-banner`}>
        <div>
          <div className="studio-finding-title">
            {result.user.username}
            {result.user.profile ? ` · ${result.user.profile}` : ""}
            {result.user.territory ? ` · ${result.user.territory}` : ""}
          </div>
          <div className="studio-finding-detail">
            {host(result.org.instanceUrl)} · {result.flow} flow · API {result.org.apiVersion} ·{" "}
            {new Date(result.startedAt).toLocaleString()}
            {status === "cancelled" ? " · cancelled, so this covers what was downloaded before it stopped" : ""}
          </div>
        </div>
        <div className="studio-header-actions">
          <button className="studio-btn" onClick={onExportReport} title="Save a Markdown report to share">
            Export report
          </button>
          <button className="studio-btn" onClick={onExport}>
            Export JSON
          </button>
        </div>
      </div>

      <div className="studio-sim-stats">
        <Stat label="Total network time" value={formatSeconds(result.metadata.seconds + t.seconds)} detail="Metadata plus data download" />
        <Stat
          label="Metadata download"
          value={formatSeconds(result.metadata.seconds)}
          detail={`${formatBytes(result.metadata.bytes)} · ${result.metadata.requests} requests · ${result.metadata.version}`}
        />
        <Stat label="Data download" value={formatSeconds(t.seconds)} detail={`${formatBytes(t.bytes)} · ${formatNumber(t.requests)} requests`} />
        <Stat
          label="Records"
          value={formatNumber(t.records)}
          detail={`${t.tablesDownloaded} tables${t.tablesSkipped ? ` · ${t.tablesSkipped} skipped` : ""}${t.tablesFailed ? ` · ${t.tablesFailed} failed` : ""}`}
        />
      </div>

      <section className="studio-perf-section">
        <div className="studio-perf-section-header">
          <h2 className="studio-perf-section-title">Tables</h2>
          <span className="studio-picker-meta">slowest first</span>
        </div>
        <table className="studio-change-table studio-perf-table">
          <thead>
            <tr>
              <th>Object</th>
              <th className="num">Records</th>
              <th className="num">Requests</th>
              <th className="num">Size</th>
              <th className="num">Seconds</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.developerName || x.sobject}>
                <td>
                  <div>{x.sobject}</div>
                  {x.truncated && <div className="studio-perf-metric-meta">Cut short: {x.truncated}</div>}
                </td>
                <td className="num">{formatNumber(x.records)}</td>
                <td className="num">{formatNumber(x.requests)}</td>
                <td className="num">{formatBytes(x.bytes)}</td>
                <td className="num">{x.seconds.toFixed(1)}</td>
              </tr>
            ))}
            {flagged.map((x) => (
              <tr key={x.developerName || x.sobject} className={`studio-perf-flagged ${x.error ? "error" : "not-estimated"}`}>
                <td>{x.sobject}</td>
                <td colSpan={4}>
                  <span className={`studio-chip ${x.error ? "error" : "muted"}`}>{x.error ? "Failed" : "Skipped"}</span> {x.error ?? x.skipped}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {downloaded.length > TOP_TABLES && (
          <button className="studio-perf-disclosure" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${downloaded.length} tables`}
          </button>
        )}
      </section>

      {result.notes.length > 0 && (
        <section className="studio-perf-section">
          <h2 className="studio-perf-section-title">Notes</h2>
          <ul className="studio-perf-issues">
            {result.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LoginPanel({ onStart, onClose }: { onStart: (alias: string, instanceUrl: string) => void; onClose: () => void }) {
  const [alias, setAlias] = useState("");
  const [choice, setChoice] = useState(LOGIN_URLS[0].url);
  const [custom, setCustom] = useState("");
  const url = choice === "custom" ? custom.trim() : choice;
  const validUrl = /^https:\/\/[^\s/]+\.[^\s/]+/.test(url);
  const validAlias = alias.trim() === "" || /^[A-Za-z0-9._-]+$/.test(alias.trim());
  return (
    <div className="studio-perf-card">
      <div className="studio-finding-title">Add an sf CLI connection</div>
      <div className="studio-perf-hint">
        Your browser opens the Salesforce login page. Sign in as the user to simulate — an end user's username and password, or an
        admin. If the browser is already signed in to that org, sign out first or use a private window, or the new connection
        will be for whoever is signed in.
      </div>
      <div className="studio-perf-grid">
        <label className="studio-perf-field">
          <span className="studio-perf-field-label">Login URL</span>
          <div className="studio-perf-row">
            <select className="studio-filter" value={choice} onChange={(e) => setChoice(e.target.value)}>
              {LOGIN_URLS.map((u) => (
                <option key={u.url} value={u.url}>
                  {u.label} ({host(u.url)})
                </option>
              ))}
              <option value="custom">My Domain…</option>
            </select>
            {choice === "custom" && (
              <input
                className="studio-filter"
                placeholder="https://mycompany.my.salesforce.com"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            )}
          </div>
        </label>
        <label className="studio-perf-field">
          <span className="studio-perf-field-label">Alias (optional)</span>
          <input className="studio-filter" placeholder="e.g. rep-east" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </label>
      </div>
      {!validAlias && <div className="studio-perf-hint studio-perf-warn-text">An alias can use letters, numbers, dots, dashes and underscores.</div>}
      <div className="studio-header-actions">
        <button className="studio-btn primary" disabled={!validUrl || !validAlias} onClick={() => onStart(alias.trim(), url)}>
          Open browser to sign in
        </button>
        <button className="studio-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function readActiveJob(): string | null {
  try {
    return localStorage.getItem(ACTIVE_JOB_KEY);
  } catch {
    return null;
  }
}

export default function SimulateView() {
  const [connections, setConnections] = useState<SfConnection[]>([]);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connection, setConnection] = useState("");
  const [territory, setTerritory] = useState("");
  const [flow, setFlow] = useState<"" | SimFlow>("");
  const [minutes, setMinutes] = useState(String(DEFAULT_MINUTES));
  const [maxPerTable, setMaxPerTable] = useState("");
  const [maxTotal, setMaxTotal] = useState("");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  // Watching `sf org list` for the connection a browser login is creating.
  const [waitingLogin, setWaitingLogin] = useState<{ before: SfConnection[]; since: number } | null>(null);

  const [sims, setSims] = useState<PerfSimRecord[]>([]);
  const [view, setView] = useState<PerfSimRecord | null>(null);
  const [tab, setTab] = useState<"setup" | "result">("setup");
  const [jobId, setJobId] = useState<string | null>(readActiveJob);
  const [job, setJob] = useState<SimJobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [lost, setLost] = useState(false);
  /** The last failed status poll, shown when contact is lost. */
  const [pollError, setPollError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [, tick] = useState(0);

  const running = !!jobId || starting;

  const loadConnections = useCallback(async () => {
    const res = await window.lscApi.listSfOrgs();
    setConnectionsError(res.error ?? null);
    setConnections(res.orgs);
    return res.orgs;
  }, []);

  const loadSims = useCallback(async () => {
    const list = await window.lscApi.perfListSims();
    setSims(list);
    return list;
  }, []);

  const openSim = useCallback(async (id: string) => {
    const record = await window.lscApi.perfGetSim(id);
    if (!record?.result) return;
    setView(record);
    setTab("result");
  }, []);

  useEffect(() => {
    loadConnections().then((list) => {
      const preferred = list.find((c) => c.isDefault) ?? list[0];
      setConnection((current) => current || (preferred ? connectionRef(preferred) : ""));
    });
    loadSims();
    if (!readActiveJob()) {
      window.lscApi.studioSimActive().then((res) => {
        const current = responseError(res) ? null : (res.data as { job?: SimJobStatus | null } | undefined)?.job;
        if (current?.state === "running") {
          localStorage.setItem(ACTIVE_JOB_KEY, current.jobId);
          setJob(current);
          setJobId(current.jobId);
        }
      });
    }
  }, [loadConnections, loadSims]);

  // After the browser opens, the new connection appears in `sf org list` once sign-in completes.
  useEffect(() => {
    if (!waitingLogin) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const list = await loadConnections();
      if (stopped) return;
      const added = newConnections(waitingLogin.before, list);
      if (added.length) {
        setWaitingLogin(null);
        setConnection(connectionRef(added[0]));
        setNotice({ kind: "info", text: `Connected as ${connectionLabel(added[0])}.` });
        return;
      }
      if (Date.now() - waitingLogin.since > LOGIN_WAIT_MS) {
        setWaitingLogin(null);
        setNotice({
          kind: "info",
          text: "No new connection appeared. If you signed in as a user that was already connected, it was refreshed — pick it from the list.",
        });
        return;
      }
      timer = setTimeout(poll, LOGIN_POLL_MS);
    };
    timer = setTimeout(poll, LOGIN_POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [waitingLogin, loadConnections]);

  const startLogin = async (alias: string, instanceUrl: string) => {
    setLoginOpen(false);
    setNotice(null);
    const before = connections;
    const res = await window.lscApi.loginSfOrg(alias || undefined, instanceUrl);
    if (!res.ok) {
      setNotice({ kind: "error", text: `Couldn't start the sign-in: ${res.error ?? "unknown error"}` });
      return;
    }
    setWaitingLogin({ before, since: Date.now() });
  };

  const finish = useCallback(
    async (status: SimJobStatus) => {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      setJobId(null);
      setLost(false);
      const result = status.result;
      if ((status.state === "done" || status.state === "cancelled") && result) {
        const saved = await window.lscApi.perfSaveSim({
          org: result.org.instanceUrl,
          connection: status.connection,
          status: status.state,
          startedAt: status.startedAt,
          finishedAt: status.finishedAt ?? new Date().toISOString(),
          summary: simSummary(result),
          result,
        });
        await loadSims();
        setNotice(status.state === "cancelled" ? { kind: "info", text: "Cancelled. The result covers what was downloaded before it stopped." } : null);
        await openSim(saved.id);
      } else if (status.state === "failed") {
        setNotice({ kind: "error", text: `Simulation failed: ${status.error ?? "unknown error"}` });
      } else if (status.state === "cancelled") {
        setNotice({ kind: "info", text: "Simulation cancelled." });
      }
    },
    [loadSims, openSim]
  );

  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (!jobId || lost) return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let res: Response;
      try {
        res = await window.lscApi.studioSimStatus(jobId);
      } catch (err) {
        res = { error: err instanceof Error ? err.message : String(err) };
      }
      if (stopped) return;
      const error = responseError(res);
      if (error) {
        if (/no longer available/i.test(error)) {
          localStorage.removeItem(ACTIVE_JOB_KEY);
          setJobId(null);
          setJob(null);
          setNotice({ kind: "error", text: error });
          return;
        }
        failures++;
        setPollError(error);
        if (failures >= MAX_POLL_FAILURES) {
          setLost(true);
          return;
        }
        timer = setTimeout(poll, Math.min(POLL_MS * 2 ** failures, 30_000));
        return;
      }
      failures = 0;
      const status = res.data as SimJobStatus;
      setJob(status);
      if (status.state === "running") timer = setTimeout(poll, POLL_MS);
      else await finishRef.current(status);
    };
    poll();
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(clock);
    };
  }, [jobId, lost]);

  const options = (): SimRunOptions => {
    const opts: SimRunOptions = {};
    if (territory.trim()) opts.territory = territory.trim();
    if (flow) opts.forceFlow = flow;
    const m = wholeNumber(minutes);
    if (m) opts.maxSeconds = Math.min(7200, Math.max(10, m * 60));
    const perTable = wholeNumber(maxPerTable);
    if (perTable) opts.maxRecordsPerTable = perTable;
    const total = wholeNumber(maxTotal);
    if (total) opts.maxTotalRecords = total;
    const inc = parseSObjectList(include);
    if (inc) opts.include = inc;
    const exc = parseSObjectList(exclude);
    if (exc) opts.exclude = exc;
    return opts;
  };

  const run = async () => {
    if (!connection) return;
    setNotice(null);
    setJob(null);
    setLost(false);
    setStarting(true);
    try {
      const res = await window.lscApi.studioSimStart(connection, options());
      const error = responseError(res);
      if (error) {
        setNotice({ kind: "error", text: error });
        return;
      }
      const status = res.data as SimJobStatus;
      localStorage.setItem(ACTIVE_JOB_KEY, status.jobId);
      setJob(status);
      setJobId(status.jobId);
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    const res = await window.lscApi.studioSimCancel(jobId);
    if (!responseError(res)) setJob(res.data as SimJobStatus);
  };

  const removeSim = async (id: string) => {
    await window.lscApi.perfDeleteSim(id);
    await loadSims();
    if (view?.id === id) {
      setView(null);
      setTab("setup");
    }
  };

  const fileName = (r: SimulationResult, ext: string) =>
    planFileName({ name: `first sync ${r.user.username} ${r.startedAt.slice(0, 10)}`, personas: [] }, ext);

  const exportJson = async () => {
    const r = view?.result as SimulationResult | undefined;
    if (!r) return;
    const res = await window.lscApi.perfSaveFile(fileName(r, "json"), JSON.stringify(r, null, 2), "json");
    if (!res.canceled && res.path) setNotice({ kind: "info", text: `Saved ${res.path}` });
  };

  const exportReport = async () => {
    const r = view?.result as SimulationResult | undefined;
    if (!r) return;
    const report = await window.lscApi.studioSimReport(r);
    const error = responseError(report);
    const markdown = (report.data as { markdown?: string } | undefined)?.markdown;
    if (error || !markdown) {
      setNotice({ kind: "error", text: `Couldn't build the report: ${error ?? "no report came back"}` });
      return;
    }
    const res = await window.lscApi.perfSaveFile(fileName(r, "md"), markdown, "md");
    if (!res.canceled && res.path) setNotice({ kind: "info", text: `Saved ${res.path}` });
  };

  const selected = connections.find((c) => connectionRef(c) === connection);
  const progress = job?.tables;
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;

  return (
    <div className="studio-perf">
      <aside className="studio-perf-sidebar">
        <div className="studio-perf-sidebar-header">
          <div className="studio-rail-title">Simulations</div>
        </div>
        {running && (
          <div className="studio-perf-run-item active" title={job?.step ?? "Starting"}>
            <span className="studio-perf-run-open studio-perf-run-live">
              <span className="studio-perf-run-line">
                {!lost && <span className="studio-spinner studio-perf-run-spinner" />}
                <span>
                  {lost ? "Lost contact" : "Running"} · {job ? elapsed(job.startedAt) : "starting"}
                </span>
              </span>
              <span className="studio-perf-run-meta">{job?.connection ?? connection}</span>
            </span>
          </div>
        )}
        {sims.length === 0 && !running && <div className="studio-perf-hint">No simulations yet.</div>}
        {sims.map((s) => {
          const summary = asSimSummary(s.summary);
          return (
            <div key={s.id} className={`studio-perf-run-item${view?.id === s.id ? " active" : ""}`}>
              <button className="studio-perf-run-open" onClick={() => openSim(s.id)}>
                <span className={`studio-sev-dot studio-perf-dot ${s.status === "cancelled" || summary?.failed ? "warn" : "pass"}`} />
                <span className="studio-perf-run-text">
                  <span>{summary?.username ?? s.connection}</span>
                  <span className="studio-perf-run-meta" title={s.org}>
                    {new Date(s.startedAt).toLocaleString()}
                    {summary ? ` · ${formatNumber(summary.records)} records · ${formatSeconds(summary.seconds)}` : ""}
                  </span>
                </span>
              </button>
              <button className="studio-chip-x" title="Delete simulation" aria-label="Delete simulation" onClick={() => removeSim(s.id)}>
                ×
              </button>
            </div>
          );
        })}
      </aside>

      <div className="studio-perf-main">
        <div className="studio-perf-toolbar">
          <div className="studio-ipad-mode" role="tablist">
            <button role="tab" className={`studio-btn${tab === "setup" ? " active" : ""}`} aria-selected={tab === "setup"} onClick={() => setTab("setup")}>
              Setup
            </button>
            <button
              role="tab"
              className={`studio-btn${tab === "result" ? " active" : ""}`}
              aria-selected={tab === "result"}
              disabled={!view}
              onClick={() => setTab("result")}
            >
              Result
            </button>
          </div>
          <div className="studio-header-actions">
            <button
              className="studio-btn primary"
              onClick={run}
              disabled={running || !connection}
              title={connection ? `Simulate a first sync as ${connection}` : "Choose a connection first"}
            >
              Run simulation
            </button>
          </div>
        </div>

        {running && (
          <div className={`studio-finding ${lost ? "warning" : "info"} studio-perf-progress`}>
            {!lost && <div className="studio-spinner" />}
            <div className="studio-perf-progress-text">
              <div className="studio-finding-title">
                {lost ? "Lost contact with the simulation" : `Simulating a first sync as ${job?.connection ?? connection}`}
              </div>
              <div className="studio-finding-detail">
                {lost
                  ? `Studio couldn't reach the simulation for a while. It may still be going.${pollError ? ` Last error: ${pollError}` : ""}`
                  : job
                    ? `${job.step} · ${elapsed(job.startedAt)}`
                    : "Connecting…"}
              </div>
              {!lost && progress && (
                <div className="studio-finding-detail">
                  {progress.done} of {progress.total} tables · {formatNumber(progress.records)} records
                </div>
              )}
              {!lost && pct !== null && (
                <div className="studio-perf-bar" role="progressbar" aria-valuenow={progress?.done} aria-valuemin={0} aria-valuemax={progress?.total} aria-label="Tables downloaded">
                  <div className="studio-perf-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
            {lost && (
              <button className="studio-btn" onClick={() => setLost(false)}>
                Reconnect
              </button>
            )}
            <button className="studio-btn" onClick={cancel} disabled={!jobId || job?.step === "Cancelling…"}>
              Cancel
            </button>
          </div>
        )}
        {notice && <div className={`studio-finding ${notice.kind === "error" ? "error" : "info"} studio-perf-notice`}>{notice.text}</div>}

        <div className="studio-perf-body">
          {tab === "result" && view?.result ? (
            <SimResult result={view.result as SimulationResult} status={view.status} onExport={exportJson} onExportReport={exportReport} />
          ) : (
            <div className="studio-perf-editor">
              <section className="studio-perf-section">
                <div className="studio-perf-section-header">
                  <h2 className="studio-perf-section-title">Run as</h2>
                </div>
                <div className="studio-perf-hint">
                  The simulation downloads what an iOS device would on its first sync, as the sf CLI connection you pick. Choose an
                  end user's connection for numbers that match their device; an admin's connection gets whatever the admin can
                  see. It only reads from the org, and it measures network time only — a device also spends time writing its
                  database.
                </div>
                <div className="studio-perf-row">
                  <select
                    className="studio-filter"
                    value={connection}
                    disabled={running}
                    onChange={(e) => setConnection(e.target.value)}
                    aria-label="sf CLI connection"
                  >
                    {connections.length === 0 && <option value="">No sf CLI connections</option>}
                    {connections.map((c) => (
                      <option key={c.username} value={connectionRef(c)}>
                        {connectionLabel(c)} — {host(c.instanceUrl)}
                      </option>
                    ))}
                  </select>
                  <button className="studio-btn" onClick={loadConnections} disabled={running} title="Re-read the sf CLI's connections">
                    Refresh
                  </button>
                  <button className="studio-btn" onClick={() => setLoginOpen(true)} disabled={running || !!waitingLogin || loginOpen}>
                    Add connection…
                  </button>
                </div>
                {connectionsError && <div className="studio-perf-hint studio-perf-warn-text">Couldn't list sf CLI connections: {connectionsError}</div>}
                {selected && <div className="studio-perf-hint">{selected.instanceUrl}</div>}
                {loginOpen && <LoginPanel onStart={startLogin} onClose={() => setLoginOpen(false)} />}
                {waitingLogin && (
                  <div className="studio-finding info studio-perf-progress">
                    <div className="studio-spinner" />
                    <div className="studio-perf-progress-text">
                      <div className="studio-finding-title">Waiting for you to sign in</div>
                      <div className="studio-finding-detail">Finish signing in in your browser. The new connection is picked here when it appears.</div>
                    </div>
                    <button className="studio-btn" onClick={() => setWaitingLogin(null)}>
                      Stop waiting
                    </button>
                  </div>
                )}
              </section>

              <section className="studio-perf-section">
                <div className="studio-perf-section-header">
                  <h2 className="studio-perf-section-title">Options</h2>
                </div>
                <div className="studio-perf-grid">
                  <label className="studio-perf-field">
                    <span className="studio-perf-field-label">Territory (optional)</span>
                    <input
                      className="studio-filter"
                      placeholder="Default: the user's first leaf territory"
                      value={territory}
                      disabled={running}
                      onChange={(e) => setTerritory(e.target.value)}
                    />
                  </label>
                  <label className="studio-perf-field">
                    <span className="studio-perf-field-label">Time limit (minutes)</span>
                    <input
                      className="studio-filter studio-perf-number"
                      type="number"
                      min={1}
                      max={120}
                      value={minutes}
                      disabled={running}
                      onChange={(e) => setMinutes(e.target.value)}
                    />
                  </label>
                </div>
                <button className="studio-perf-disclosure" onClick={() => setAdvanced(!advanced)}>
                  {advanced ? "▾" : "▸"} Advanced
                </button>
                {advanced && (
                  <>
                    <div className="studio-perf-grid">
                      <label className="studio-perf-field">
                        <span className="studio-perf-field-label">Sync flow</span>
                        <select className="studio-filter" value={flow} disabled={running} onChange={(e) => setFlow(e.target.value as "" | SimFlow)}>
                          <option value="">As the org is set up</option>
                          <option value="enhanced">Enhanced (Connect API)</option>
                          <option value="legacy">Legacy (REST query)</option>
                        </select>
                      </label>
                      <span />
                      <label className="studio-perf-field">
                        <span className="studio-perf-field-label">Stop each table after (records)</span>
                        <input
                          className="studio-filter studio-perf-number"
                          type="number"
                          min={1}
                          placeholder="No limit"
                          value={maxPerTable}
                          disabled={running}
                          onChange={(e) => setMaxPerTable(e.target.value)}
                        />
                      </label>
                      <label className="studio-perf-field">
                        <span className="studio-perf-field-label">Stop the run after (records)</span>
                        <input
                          className="studio-filter studio-perf-number"
                          type="number"
                          min={1}
                          placeholder="No limit"
                          value={maxTotal}
                          disabled={running}
                          onChange={(e) => setMaxTotal(e.target.value)}
                        />
                      </label>
                      <label className="studio-perf-field">
                        <span className="studio-perf-field-label">Only these objects</span>
                        <textarea
                          className="studio-filter"
                          rows={2}
                          placeholder="e.g. Account, Contact"
                          value={include}
                          disabled={running}
                          onChange={(e) => setInclude(e.target.value)}
                        />
                      </label>
                      <label className="studio-perf-field">
                        <span className="studio-perf-field-label">Skip these objects</span>
                        <textarea
                          className="studio-filter"
                          rows={2}
                          placeholder="e.g. ContentVersion"
                          value={exclude}
                          disabled={running}
                          onChange={(e) => setExclude(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="studio-perf-hint">Limits make a quicker check; tables cut short by them are marked, and their numbers are lower bounds.</div>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
