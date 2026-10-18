import React, { useCallback, useEffect, useRef, useState } from "react";
import type { MobileLoginInfo, PerfSimRecord } from "../../types";
import {
  asSimSummary,
  connectionLabel,
  connectionRef,
  deltaOf,
  describeNetwork,
  mobileLoginId,
  mobileRef,
  formatBytes,
  formatSeconds,
  MAX_SIM_RUNS,
  multiRuns,
  newConnections,
  parseSObjectList,
  rankTables,
  SIM_NETWORK_LIMITATION,
  SIM_NETWORK_PROFILES,
  simSummary,
  type SfConnection,
  type SimContent,
  type SimContentKind,
  type SimFlow,
  type SimJobStatus,
  type SimNetworkProfile,
  type SimRunOptions,
  type SimulationResult,
} from "./sim-types";
import { formatNumber, planFileName } from "./perf-plan";
import { Download, FileText, LogIn, Play, RefreshCw, Terminal, X } from "lucide-react";
import StatusIcon from "../ui/StatusIcon";
import Segmented from "../ui/Segmented";
import Spinner from "../ui/Spinner";
import { Bar, Callout, Disclosure, Metric } from "./PerfParts";
import TestUserChip from "./TestUserChip";
import { useOrgs } from "../../hooks/useOrgs";
import { useMobileLogins } from "../../hooks/useMobileLogins";
import { testUserName, testUsersFor } from "../../test-users";
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
  return <Metric label={label} value={value} hint={detail} />;
}

function ContentSection({ content }: { content: SimContent }) {
  const kinds: Array<[string, SimContentKind | undefined]> = [
    ["Attachments", content.attachments],
    ["CLM content", content.clm],
  ];
  return (
    <section className="studio-perf-section">
      <div className="studio-perf-section-header">
        <h2 className="studio-perf-section-title">Content downloads</h2>
        <span className="studio-perf-meta">outside the sync window · not in the totals above</span>
      </div>
      <table className="studio-perf-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th className="num">Files</th>
            <th className="num">Size</th>
            <th className="num">Seconds</th>
            <th className="num">Failures</th>
          </tr>
        </thead>
        <tbody>
          {kinds.map(([label, k]) =>
            k ? (
              <tr key={label}>
                <td>
                  <div>{label}</div>
                  {k.truncated && <div className="studio-perf-metric-meta">Cut short: {k.truncated}; lower bounds</div>}
                  {k.largest?.slice(0, 3).map((f) => (
                    <div key={f.name} className="studio-perf-metric-meta">
                      {f.name}: {formatBytes(f.bytes)} in {f.seconds.toFixed(1)} s
                    </div>
                  ))}
                </td>
                <td className="num">
                  {k.truncated ? "≥ " : ""}
                  {formatNumber(k.files)} of {formatNumber(k.candidates)}
                </td>
                <td className="num">
                  {k.truncated ? "≥ " : ""}
                  {formatBytes(k.bytes)}
                </td>
                <td className="num">{k.seconds.toFixed(1)}</td>
                <td className="num">{k.failures}</td>
              </tr>
            ) : null
          )}
        </tbody>
      </table>
      {content.notes?.length > 0 && (
        <ul className="studio-perf-issues">
          {content.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Terms from the notes and tables, in plain words. */
const GLOSSARY: Array<[string, string]> = [
  ["Network time", "Time spent downloading. A real device also spends time saving the data to its database, so real first syncs take longer."],
  ["OT2A, Account and the rest", "The order the app downloads tables in: the first two groups come first, then everything else."],
  ["DSTR", "DeviceSyncTransactionRecord, a table the app downloads in several passes. Its passes are added up into one row."],
  ["SmartQueue", "The app's download scheduler. It runs a few tables at once and holds back heavy ones, so tables overlap in time."],
  ["Query locators", "Server-side cursors that page through big query results. The app keeps only a few open at a time, which limits how many tables run together."],
  ["Median across runs", "With several runs, each time shown is the middle value, so one slow run doesn't skew it. Record counts come from the run closest to the median."],
];

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
  const runs = multiRuns(result);
  const delta = deltaOf(result);
  const [allDelta, setAllDelta] = useState(false);
  const [details, setDetails] = useState(false);
  const deltaTables = delta?.tables ?? [];
  const deltaSkipped = deltaTables.filter((x) => x.skipped);
  const deltaRanked = deltaTables.filter((x) => !x.skipped).sort((a, b) => b.seconds - a.seconds || b.toDownload - a.toDownload);
  const deltaRows = allDelta ? deltaRanked : deltaRanked.slice(0, TOP_TABLES);
  const range = (s: { min: number; max: number }) => `${formatSeconds(s.min)} – ${formatSeconds(s.max)}`;
  return (
    <div className="studio-perf-report">
      <div className="studio-perf-summary">
        <div className="studio-perf-summary-main">
          <StatusIcon tone={partial ? "warning" : "info"} size={32} />
          <div>
            <div className="studio-perf-summary-title">
              {result.user.username}
              {result.user.profile ? ` · ${result.user.profile}` : ""}
              {result.user.territory ? ` · ${result.user.territory}` : ""}
            </div>
            <div className="studio-perf-summary-detail">
              {host(result.org.instanceUrl)} · {result.flow} flow · API {result.org.apiVersion}
              {result.network ? ` · network ${describeNetwork(result.network)}` : ""} ·{" "}
              {new Date(result.startedAt).toLocaleString()}
              {status === "cancelled" ? " · cancelled, so this covers what was downloaded before it stopped" : ""}
            </div>
          </div>
        </div>
        <div className="studio-perf-summary-actions">
          <button type="button" className="studio-btn" onClick={onExportReport} title="Save a Markdown report to share">
            <FileText size={14} aria-hidden="true" />
            Export report
          </button>
          <button type="button" className="studio-btn" onClick={onExport}>
            <Download size={14} aria-hidden="true" />
            Export JSON
          </button>
        </div>
      </div>

      <div className="studio-sim-stats">
        <Stat
          label={runs ? "Total network time (median)" : "Total network time"}
          value={formatSeconds(runs ? runs.total.median : result.metadata.seconds + t.seconds)}
          detail={runs ? `${runs.count} runs · ${range(runs.total)}` : "Metadata plus data download"}
        />
        <Stat
          label={runs ? "Metadata download (median)" : "Metadata download"}
          value={formatSeconds(result.metadata.seconds)}
          detail={`${runs ? `${range(runs.metadata)} · ` : ""}${formatBytes(result.metadata.bytes)} · ${result.metadata.requests} requests · ${result.metadata.version}`}
        />
        <Stat
          label={runs ? "Data download (median)" : "Data download"}
          value={formatSeconds(t.seconds)}
          detail={`${runs ? `${range(runs.data)} · ` : ""}${formatBytes(t.bytes)} · ${formatNumber(t.requests)} requests`}
        />
        <Stat
          label="Records"
          value={formatNumber(t.records)}
          detail={`${t.tablesDownloaded} tables${t.tablesSkipped ? ` · ${t.tablesSkipped} skipped` : ""}${t.tablesFailed ? ` · ${t.tablesFailed} failed` : ""}`}
        />
      </div>

      {runs && (
        <section className="studio-perf-section">
          <div className="studio-perf-section-header">
            <h2 className="studio-perf-section-title">Runs</h2>
            <span className="studio-perf-meta">
              {runs.count}
              {runs.requested > runs.count ? ` of ${runs.requested}` : ""} back to back
            </span>
          </div>
          <table className="studio-perf-table">
            <thead>
              <tr>
                <th>Run</th>
                <th className="num">Total</th>
                <th className="num">Metadata</th>
                <th className="num">Data</th>
              </tr>
            </thead>
            <tbody>
              {runs.perRun.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="num">{formatSeconds(r.totalSeconds)}</td>
                  <td className="num">{formatSeconds(r.metadataSeconds)}</td>
                  <td className="num">{formatSeconds(r.dataSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="studio-perf-section">
        <div className="studio-perf-section-header">
          <h2 className="studio-perf-section-title">Tables</h2>
          <span className="studio-perf-meta">{runs ? "slowest first · median seconds across runs" : "slowest first"}</span>
        </div>
        <table className="studio-perf-table">
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
                  <span className={`ui-pill${x.error ? " error" : ""}`}>{x.error ? "Failed" : "Skipped"}</span> {x.error ?? x.skipped}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {downloaded.length > TOP_TABLES && (
          <Disclosure open={all} onToggle={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${downloaded.length} tables`}
          </Disclosure>
        )}
      </section>

      {delta && (
        <section className="studio-perf-section">
          <div className="studio-perf-section-header">
            <h2 className="studio-perf-section-title">Delta sync (last synced {delta.sinceHours} h ago)</h2>
            <span className="studio-perf-meta">{runs ? "slowest first · median seconds across runs" : "slowest first"}</span>
          </div>
          <div className="studio-sim-stats">
            <Stat
              label="Delta network time"
              value={formatSeconds(delta.totals.seconds)}
              detail={`${formatNumber(delta.totals.requests)} requests · ${formatBytes(delta.totals.bytes)}`}
            />
            <Stat
              label="Record visibility"
              value={formatSeconds(delta.totals.visibilitySeconds)}
              detail={`${formatNumber(delta.totals.visibilityRequests)} requests`}
            />
            <Stat
              label="Changed-record download"
              value={formatSeconds(delta.totals.fetchSeconds)}
              detail={`${formatNumber(delta.totals.fetchRequests)} requests · ${formatNumber(delta.totals.recordsFetched)} records`}
            />
            <Stat
              label="To download"
              value={formatNumber(delta.totals.toDownload)}
              detail={`${formatNumber(delta.totals.toDelete)} to delete (informational)`}
            />
          </div>
          <table className="studio-perf-table">
            <thead>
              <tr>
                <th>Object</th>
                <th className="num">Local ids</th>
                <th className="num">Visibility requests</th>
                <th className="num">To download</th>
                <th className="num">To delete</th>
                <th className="num">Fetched</th>
                <th className="num">Fetch requests</th>
                <th className="num">Size</th>
                <th className="num">Seconds</th>
              </tr>
            </thead>
            <tbody>
              {deltaRows.map((x) => (
                <tr key={x.developerName || x.sobject}>
                  <td>
                    <div>{x.sobject}</div>
                    {x.error && <div className="studio-perf-metric-meta">Failed: {x.error}</div>}
                    {x.truncated && <div className="studio-perf-metric-meta">Cut short: {x.truncated}</div>}
                  </td>
                  <td className="num">{formatNumber(x.localIds)}</td>
                  <td className="num">{formatNumber(x.visibilityRequests)}</td>
                  <td className="num">{formatNumber(x.toDownload)}</td>
                  <td className="num">{formatNumber(x.toDelete)}</td>
                  <td className="num">{formatNumber(x.recordsFetched)}</td>
                  <td className="num">{formatNumber(x.fetchRequests)}</td>
                  <td className="num">{formatBytes(x.bytes)}</td>
                  <td className="num">{x.seconds.toFixed(1)}</td>
                </tr>
              ))}
              {deltaSkipped.map((x) => (
                <tr key={x.developerName || x.sobject} className="studio-perf-flagged not-estimated">
                  <td>{x.sobject}</td>
                  <td colSpan={8}>
                    <span className="ui-pill">Skipped</span> {x.skipped}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {deltaTables.length - deltaSkipped.length > TOP_TABLES && (
            <Disclosure open={allDelta} onToggle={() => setAllDelta(!allDelta)}>
              {allDelta ? "Show fewer" : `Show all ${deltaTables.length - deltaSkipped.length} tables`}
            </Disclosure>
          )}
        </section>
      )}
      {result.content && <ContentSection content={result.content} />}

      <section className="studio-perf-section">
        <Disclosure open={details} onToggle={() => setDetails(!details)}>
          Details
        </Disclosure>
        {details && (
          <>
            <div className="studio-perf-hint">Engineering notes and terms behind these numbers.</div>
            <ul className="studio-perf-issues">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {delta?.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {GLOSSARY.map(([term, meaning]) => (
                <li key={term}>
                  <strong>{term}:</strong> {meaning}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function LoginPanel({
  onStart,
  onClose,
}: {
  onStart: (alias: string, instanceUrl: string) => void;
  onClose: () => void;
}) {
  const [alias, setAlias] = useState("");
  const [choice, setChoice] = useState(LOGIN_URLS[0].url);
  const [custom, setCustom] = useState("");
  const url = choice === "custom" ? custom.trim() : choice;
  const validUrl = /^https:\/\/[^\s/]+\.[^\s/]+/.test(url);
  const validAlias = alias.trim() === "" || /^[A-Za-z0-9._-]+$/.test(alias.trim());
  return (
    <div className="studio-perf-card">
      <h3 className="studio-perf-section-title">Add an sf CLI connection</h3>
      <div className="studio-perf-hint">
        Your browser opens the Salesforce login page. Sign in as the user to simulate — an end user's username and password, or
        an admin. If the browser is already signed in to that org, sign out first or use a private window, or the new
        connection will be for whoever is signed in.
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
      {!validAlias && <div className="studio-perf-hint studio-perf-warn-text" role="alert">An alias can use letters, numbers, dots, dashes and underscores.</div>}
      <div className="studio-perf-summary-actions">
        <button type="button" className="studio-btn primary" disabled={!validUrl || !validAlias} onClick={() => onStart(alias.trim(), url)}>
          <LogIn size={14} aria-hidden="true" />
          Open browser to sign in
        </button>
        <button type="button" className="studio-btn" onClick={onClose}>
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
  const [runs, setRuns] = useState("1");
  const [deltaHours, setDeltaHours] = useState("");
  const [network, setNetwork] = useState<SimNetworkProfile>("none");
  const [customRtt, setCustomRtt] = useState("100");
  const [customDown, setCustomDown] = useState("20");
  const [customUp, setCustomUp] = useState("5");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [contentAttachments, setContentAttachments] = useState(false);
  const [contentClm, setContentClm] = useState(false);
  const [contentMaxFiles, setContentMaxFiles] = useState("");
  const [contentMaxMb, setContentMaxMb] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  // sf CLI connections are offered only on request: the org's mobile sync endpoints usually refuse them.
  const [cliOpen, setCliOpen] = useState(false);
  const { current: currentOrg } = useOrgs();
  const mobile = useMobileLogins();
  // The selected org's test users; signed-in first.
  const mobileLogins = testUsersFor(mobile.logins, currentOrg?.orgId);
  const [mobileLoggingIn, setMobileLoggingIn] = useState(false);
  // No consumer key in Settings (the LSC_MOBILE_CLIENT_ID env var isn't visible here), or a login said so.
  const [keyMissing, setKeyMissing] = useState(false);
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
    window.lscApi.getSettings().then((settings) => setKeyMissing(!settings.mobileClientId?.trim()));
    loadConnections();
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

  // Another org's test users aren't offered; start over when the org changes.
  useEffect(() => {
    setConnection((current) => (mobileLoginId(current) ? "" : current));
  }, [currentOrg?.orgId]);

  // Run as the org's first signed-in test user until one is picked.
  const firstTestUser = mobileLogins.find((l) => l.status === "signedIn");
  useEffect(() => {
    if (firstTestUser) setConnection((current) => current || mobileRef(firstTestUser));
  }, [firstTestUser]);

  const startMobileLogin = async (renew?: MobileLoginInfo) => {
    if (!currentOrg) return;
    setNotice(null);
    setMobileLoggingIn(true);
    try {
      const res = renew ? await window.lscApi.mobileLoginRenew(renew.id) : await window.lscApi.mobileLoginStart(currentOrg.instanceUrl);
      if (!res.login) {
        if (/consumer key/i.test(res.error ?? "")) setKeyMissing(true);
        else if (res.error !== "Login window closed.") setNotice({ kind: "error", text: res.error ?? "Login failed." });
        return;
      }
      setKeyMissing(false);
      setConnection(mobileRef(res.login));
      setNotice({ kind: "info", text: `Signed in as ${res.login.username} through the LSC mobile app.` });
    } finally {
      setMobileLoggingIn(false);
    }
  };

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
      // A failed job's status carries its own `error`; only a reply without a state is a failed call.
      const error = (res.data as SimJobStatus | undefined)?.state ? undefined : responseError(res);
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
    const r = wholeNumber(runs);
    if (r && r > 1) opts.runs = Math.min(MAX_SIM_RUNS, r);
    const hours = Number(deltaHours);
    if (deltaHours.trim() && Number.isFinite(hours) && hours > 0) opts.delta = { sinceHours: Math.min(8760, hours) };
    if (network === "custom") {
      opts.network = { profile: "custom", rttMs: Number(customRtt) || 0, downMbps: Number(customDown) || 1, upMbps: Number(customUp) || 1 };
    } else if (network !== "none") {
      opts.network = { profile: network };
    }
    const perTable = wholeNumber(maxPerTable);
    if (perTable) opts.maxRecordsPerTable = perTable;
    const total = wholeNumber(maxTotal);
    if (total) opts.maxTotalRecords = total;
    const inc = parseSObjectList(include);
    if (inc) opts.include = inc;
    const exc = parseSObjectList(exclude);
    if (exc) opts.exclude = exc;
    if (contentAttachments || contentClm) {
      const content: NonNullable<SimRunOptions["content"]> = { attachments: contentAttachments, clm: contentClm };
      const files = wholeNumber(contentMaxFiles);
      if (files) content.maxFiles = files;
      const mbCap = wholeNumber(contentMaxMb);
      if (mbCap) content.maxBytes = mbCap * 1024 * 1024;
      opts.content = content;
    }
    return opts;
  };

  const run = async () => {
    if (!connection) return;
    setNotice(null);
    setJob(null);
    setLost(false);
    setStarting(true);
    try {
      const mobileId = mobileLoginId(connection);
      const res = mobileId
        ? await window.lscApi.studioSimStartMobile(mobileId, options())
        : await window.lscApi.studioSimStart(connection, options());
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
    if ((res.data as SimJobStatus | undefined)?.state) setJob(res.data as SimJobStatus);
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

  const selectedLogin = mobileLogins.find((l) => mobileRef(l) === connection);
  const selected = selectedLogin ?? connections.find((c) => connectionRef(c) === connection);
  const isCli = !!connection && !selectedLogin && !mobileLoginId(connection);
  const runnable = selectedLogin?.status === "signedIn" || (isCli && !!selected);
  // Who the running simulation is for: the job reports a username; show the test user's name when it's one of theirs.
  const jobLogin = job && mobileLogins.find((l) => l.username.toLowerCase() === job.connection.toLowerCase());
  const selectedName = selectedLogin ? testUserName(selectedLogin) : selected ? connectionLabel(selected as SfConnection) : connection;
  const runningAs = jobLogin ? testUserName(jobLogin) : job?.connection ?? selectedName;
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
                {!lost && <Spinner size={12} />}
                <span>
                  {lost ? "Lost contact" : "Running"} · {job ? elapsed(job.startedAt) : "starting"}
                </span>
              </span>
              <span className="studio-perf-run-meta">{runningAs}</span>
            </span>
          </div>
        )}
        {sims.length === 0 && !running && <div className="studio-perf-hint">No simulations yet.</div>}
        {sims.map((s) => {
          const summary = asSimSummary(s.summary);
          return (
            <div key={s.id} className={`studio-perf-run-item${view?.id === s.id ? " active" : ""}`}>
              <button className="studio-perf-run-open" onClick={() => openSim(s.id)}>
                <span className={`studio-perf-dot ${s.status === "cancelled" || summary?.failed ? "warn" : "pass"}`} />
                <span className="studio-perf-run-text">
                  <span>{summary?.username ?? s.connection}</span>
                  <span className="studio-perf-run-meta" title={s.org}>
                    {new Date(s.startedAt).toLocaleString()}
                    {summary ? ` · ${formatNumber(summary.records)} records · ${formatSeconds(summary.seconds)}${summary.runs ? ` median of ${summary.runs}` : ""}${summary.network ? ` · ${summary.network}` : ""}` : ""}
                  </span>
                </span>
              </button>
              <button type="button" className="ui-icon-btn sm" title="Delete simulation" aria-label="Delete simulation" onClick={() => removeSim(s.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </aside>

      <div className="studio-perf-main">
        <div className="studio-perf-toolbar">
          <Segmented
            aria-label="Simulation"
            value={tab}
            onChange={setTab}
            options={[
              { value: "setup", label: "Setup" },
              { value: "result", label: "Result", disabled: !view },
            ]}
          />
          <div className="studio-perf-toolbar-actions">
            <button
              type="button"
              className="studio-btn primary"
              onClick={run}
              disabled={running || !runnable}
              title={
                runnable
                  ? `Simulate a first sync as ${selectedName}`
                  : selectedLogin
                  ? `${testUserName(selectedLogin)}'s login expired — sign in again first`
                  : "Choose a test user first"
              }
            >
              <Play size={14} aria-hidden="true" />
              Run simulation
            </button>
          </div>
        </div>

        {running && (
          <div className="studio-perf-body-pad">
            <Callout
              tone={lost ? "warning" : "info"}
              busy={!lost}
              className="studio-perf-progress"
              role="status"
              title={lost ? "Lost contact with the simulation" : `Simulating a first sync as ${runningAs}`}
              actions={
                <>
                  {lost && (
                    <button type="button" className="studio-btn" onClick={() => setLost(false)}>
                      Reconnect
                    </button>
                  )}
                  <button type="button" className="studio-btn" onClick={cancel} disabled={!jobId || job?.step === "Cancelling…"}>
                    Cancel
                  </button>
                </>
              }
            >
              <div className="studio-perf-hint studio-perf-callout-detail">
                {lost
                  ? `Studio couldn't reach the simulation for a while. It may still be going.${pollError ? ` Last error: ${pollError}` : ""}`
                  : job
                    ? `${job.step} · ${elapsed(job.startedAt)}`
                    : "Connecting…"}
              </div>
              {!lost && progress && (
                <div className="studio-perf-hint ui-num">
                  {progress.done} of {progress.total} tables · {formatNumber(progress.records)} records
                </div>
              )}
              {!lost && pct !== null && progress && <Bar value={progress.done} max={progress.total} label="Tables downloaded" />}
            </Callout>
          </div>
        )}
        {notice && (
          <div className="studio-perf-body-pad">
            <Callout tone={notice.kind === "error" ? "error" : "info"} className="studio-perf-notice" role={notice.kind === "error" ? "alert" : "status"}>
              {notice.text}
            </Callout>
          </div>
        )}

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
                  This signs in as one rep and downloads what their iPad would on its first sync, so you can see how long it takes.
                  It only reads from the org, and it measures network time only: a device also spends time saving the data.
                </div>
                {keyMissing && (
                  <Callout tone="info" title="Mobile login needs the LSC mobile app consumer key">
                    <div className="studio-perf-hint">
                      Salesforce answers the mobile sync requests only for logins made through the LSC mobile app, and sf CLI logins
                      get a 404 from them. Add the app's consumer key in Settings (LSC mobile app consumer key, the
                      remoteAccessConsumerKey in the iOS app's bootconfig.plist), then sign in a test user here. If you set
                      LSC_MOBILE_CLIENT_ID instead, you can ignore this and try the login.
                    </div>
                    <div className="studio-perf-hint">
                      Without a key you can still use an sf CLI connection (under “Use an sf CLI connection instead”). It works only if the org lets that login reach the mobile
                      sync endpoints, which it usually doesn't. If the run fails with a 404, that is the reason, not a problem with
                      the rep's setup.
                    </div>
                  </Callout>
                )}
                <div className="studio-perf-row">
                  <select
                    className="studio-filter"
                    value={connection}
                    disabled={running}
                    onChange={(e) => setConnection(e.target.value)}
                    aria-label="User to run as"
                  >
                    {!selected && <option value="">{mobileLogins.length ? "Choose a test user" : "No test users yet"}</option>}
                    {mobileLogins.length > 0 && (
                      <optgroup label="Test users">
                        {mobileLogins.map((l) => (
                          <option key={l.id} value={mobileRef(l)}>
                            {testUserName(l)} · {l.username}
                            {l.status === "expired" ? " — login expired" : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {(cliOpen || isCli) && connections.length > 0 && (
                      <optgroup label="sf CLI connections">
                        {connections.map((c) => (
                          <option key={c.username} value={connectionRef(c)}>
                            {connectionLabel(c)} — {host(c.instanceUrl)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    className="studio-btn primary"
                    onClick={() => startMobileLogin()}
                    disabled={running || mobileLoggingIn || !currentOrg?.connected}
                  >
                    {mobileLoggingIn ? <Spinner size={14} /> : <LogIn size={14} aria-hidden="true" />}
                    {mobileLoggingIn ? "Waiting for sign-in…" : "Sign in a test user…"}
                  </button>
                </div>
                {selectedLogin && (
                  <div className="studio-perf-row">
                    <TestUserChip
                      logins={mobileLogins}
                      userId={selectedLogin.userId ?? ""}
                      name={testUserName(selectedLogin)}
                      signedInTitle="The simulation signs in as this rep through the LSC mobile app, as their iPad would."
                      adminTitle="Sign in again to run as this rep."
                    />
                  </div>
                )}
                <div className="studio-perf-hint">
                  Test users sign in through the LSC mobile app, like an iPad, and are remembered until you forget them in Test users.
                </div>
                <Disclosure open={cliOpen || isCli} onToggle={() => setCliOpen(!(cliOpen || isCli))}>
                  Use an sf CLI connection instead
                </Disclosure>
                {(cliOpen || isCli) && (
                  <>
                    <div className="studio-perf-hint">
                      Orgs usually refuse the mobile sync requests from sf CLI logins (a 404), so use one only if this org allows it.
                    </div>
                    <div className="studio-perf-row">
                      <button type="button" className="studio-btn" onClick={loadConnections} disabled={running} title="Re-read the sf CLI's connections">
                        <RefreshCw size={14} aria-hidden="true" />
                        Refresh
                      </button>
                      <button type="button" className="studio-btn" onClick={() => setLoginOpen(true)} disabled={running || !!waitingLogin || loginOpen}>
                        <Terminal size={14} aria-hidden="true" />
                        Add sf CLI connection…
                      </button>
                    </div>
                    {connectionsError && <div className="studio-perf-hint studio-perf-warn-text">Couldn't list sf CLI connections: {connectionsError}</div>}
                    {selected && isCli && <div className="studio-perf-hint">{selected.instanceUrl}</div>}
                    {loginOpen && <LoginPanel onStart={startLogin} onClose={() => setLoginOpen(false)} />}
                  </>
                )}
                {waitingLogin && (
                  <Callout
                    tone="info"
                    busy
                    role="status"
                    title="Waiting for you to sign in"
                    actions={
                      <button type="button" className="studio-btn" onClick={() => setWaitingLogin(null)}>
                        Stop waiting
                      </button>
                    }
                  >
                    <div className="studio-perf-hint">Finish signing in in your browser. The new connection is picked here when it appears.</div>
                  </Callout>
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
                <Disclosure open={advanced} onToggle={() => setAdvanced(!advanced)}>
                  Advanced
                </Disclosure>
                {advanced && (
                  <>
                    <div className="studio-perf-hint">Engineering options. The defaults suit most sign-off checks.</div>
                    <div className="studio-perf-grid">
                      <label className="studio-perf-field">
                          <span className="studio-perf-field-label">Runs (1–{MAX_SIM_RUNS})</span>
                        <input
                          className="studio-filter studio-perf-number"
                          type="number"
                          min={1}
                          max={MAX_SIM_RUNS}
                          value={runs}
                          disabled={running}
                          onChange={(e) => setRuns(e.target.value)}
                          title="Run back to back as the same login and report the median and spread"
                        />
                    </label>
                    <label className="studio-perf-field">
                      <span className="studio-perf-field-label">Network (presets approximate)</span>
                      <select
                        className="studio-filter"
                        value={network}
                        disabled={running}
                        onChange={(e) => setNetwork(e.target.value as SimNetworkProfile)}
                        title={SIM_NETWORK_LIMITATION}
                      >
                        {SIM_NETWORK_PROFILES.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.id === "none" ? p.label : `${p.label} · ${p.rttMs} ms, ${p.downMbps}/${p.upMbps} Mbps`}
                          </option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    </div>
                    {network === "custom" && (
                      <div className="studio-perf-grid">
                        <label className="studio-perf-field">
                          <span className="studio-perf-field-label">Round trip (ms)</span>
                          <input className="studio-filter studio-perf-number" type="number" min={0} max={5000} value={customRtt} disabled={running} onChange={(e) => setCustomRtt(e.target.value)} />
                        </label>
                        <label className="studio-perf-field">
                          <span className="studio-perf-field-label">Down (Mbps)</span>
                          <input className="studio-filter studio-perf-number" type="number" min={0.05} step="any" value={customDown} disabled={running} onChange={(e) => setCustomDown(e.target.value)} />
                        </label>
                        <label className="studio-perf-field">
                          <span className="studio-perf-field-label">Up (Mbps)</span>
                          <input className="studio-filter studio-perf-number" type="number" min={0.05} step="any" value={customUp} disabled={running} onChange={(e) => setCustomUp(e.target.value)} />
                        </label>
                      </div>
                    )}
                    {network !== "none" && <div className="studio-perf-hint">{SIM_NETWORK_LIMITATION}</div>}

                    <div className="studio-perf-grid">
                      <label className="studio-perf-field">
                        <span className="studio-perf-field-label">Sync flow</span>
                        <select className="studio-filter" value={flow} disabled={running} onChange={(e) => setFlow(e.target.value as "" | SimFlow)}>
                          <option value="">As the org is set up</option>
                          <option value="enhanced">Enhanced (Connect API)</option>
                          <option value="legacy">Legacy (REST query)</option>
                        </select>
                      </label>
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
                    <label className="studio-perf-field">
                      <span className="studio-perf-field-label">Then simulate a delta sync as if last synced __ hours ago</span>
                      <input
                        className="studio-filter studio-perf-number"
                        type="number"
                        min={0.01}
                        max={8760}
                        placeholder="Off"
                        value={deltaHours}
                        disabled={running}
                        onChange={(e) => setDeltaHours(e.target.value)}
                        title="After the initial sync, run the record-visibility rounds and download the changed records, as the app does on its next sync (enhanced flow only)"
                      />
                    </label>
                    <div className="studio-perf-grid">
                      <div className="studio-perf-field" role="group" aria-label="Content downloads (after the sync)">
                        <span className="studio-perf-field-label">Content downloads (after the sync)</span>
                        <label className="ui-check">
                          <input type="checkbox" checked={contentAttachments} disabled={running} onChange={(e) => setContentAttachments(e.target.checked)} />
                          Attachments
                        </label>
                        <label className="ui-check">
                          <input type="checkbox" checked={contentClm} disabled={running} onChange={(e) => setContentClm(e.target.checked)} />
                          CLM presentations
                        </label>
                      </div>
                      <label className="studio-perf-field">
                        <span className="studio-perf-field-label">Content: most files per kind</span>
                        <input
                          className="studio-filter studio-perf-number"
                          type="number"
                          min={1}
                          placeholder="200"
                          value={contentMaxFiles}
                          disabled={running || !(contentAttachments || contentClm)}
                          onChange={(e) => setContentMaxFiles(e.target.value)}
                        />
                      </label>
                      <label className="studio-perf-field">
                        <span className="studio-perf-field-label">Content: most MB per kind</span>
                        <input
                          className="studio-filter studio-perf-number"
                          type="number"
                          min={1}
                          placeholder="2048"
                          value={contentMaxMb}
                          disabled={running || !(contentAttachments || contentClm)}
                          onChange={(e) => setContentMaxMb(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="studio-perf-hint">Content downloads read the files (nothing is saved), run after the sync window and are reported apart from it; they use the synced records, so a limit above can hide files. With several runs they happen once, in the last run.</div>
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
