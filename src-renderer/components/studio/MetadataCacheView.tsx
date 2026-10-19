import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ChevronRight,
  CloudUpload,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Tablet,
} from "lucide-react";
import StateView from "../ui/StateView";
import Spinner from "../ui/Spinner";
import Segmented from "../ui/Segmented";
import Menu from "../ui/Menu";
import UpdatedAgo from "../ui/UpdatedAgo";
import { Limited } from "../ui/Limited";
import { AssistantName } from "../../hooks/useAssistantName";
import { Callout } from "./PerfParts";
import CacheContentsView from "./CacheContentsView";
import { formatBytes } from "./sim-types";
import type { PublishJob } from "./usePublishJob";
import {
  JOB_STATE,
  PROFILE_STATE,
  formatDay,
  formatDuration,
  failedPublishPrompt,
  formatWhen,
  jobProfiles,
  pillClass,
  type CacheJob,
  type CacheRecordInfo,
  type MetadataCacheOverview,
  type ProfileCacheRow,
} from "./metadata-cache-types";
import "./readiness.css";
import "./metadata-cache.css";

interface Props {
  /** Bumped after every apply and finished publish, to read the caches again. */
  version: number;
  job: PublishJob;
  onPublish: (profiles: string[] | null) => void;
  onPreview: (profile: string) => void;
  onAskClaude: (prompt: string) => void;
}

/** A failed publish to ask Roz about. */
interface FailedPublish {
  /** The job's parent record, or the profile's own record when the job isn't listed. */
  id: string;
  profiles: string[];
  startedAt: string;
  startedBy: string | null;
  error: string | null;
}

type AskWhy = (f: FailedPublish) => void;

type Load =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: MetadataCacheOverview; cachedAt: string | null };

/** What a cache is opened from, for the breadcrumb. */
interface Opened {
  recordId: string;
  label: string;
}

/**
 * Metadata cache — each profile's LSC Mobile metadata cache (what its iPads download), the
 * generation jobs that built them, and what's inside one. Reads only; publishing is the
 * shared Publish to iPad job. Data: `studio_metadata_cache*` (src/studio/metadata-cache.ts).
 */
export default function MetadataCacheView({
  version,
  job,
  onPublish,
  onPreview,
  onAskClaude,
}: Props) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"profiles" | "history">("profiles");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Opened | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const ticket = useRef(0);

  // Roz gets the whole log, not just the one-line error; without it, the error alone.
  const askWhy: AskWhy = async (f) => {
    setAsking(f.id);
    const res = await window.lscApi.studioMetadataCacheLog(f.id);
    setAsking(null);
    const logs = res.error
      ? []
      : ((res.data as { logs?: { profile: string | null; log: string }[] } | null)?.logs ?? []);
    onAskClaude(failedPublishPrompt({ ...f, logs }));
  };

  const fetchOverview = useCallback(async () => {
    const mine = ++ticket.current;
    setRefreshing(true);
    const res = await window.lscApi.studioMetadataCache();
    if (ticket.current !== mine) return;
    setRefreshing(false);
    if (res.error || !res.data)
      setLoad((l) =>
        l.status === "ready"
          ? l
          : { status: "error", error: res.error || "Studio couldn't read the metadata caches." }
      );
    else
      setLoad({
        status: "ready",
        data: res.data as MetadataCacheOverview,
        cachedAt: res.cachedAt ?? new Date().toISOString(),
      });
    return res.error;
  }, []);

  // Read again after writes, and when a publish starts or ends, so its rows say so.
  const jobKey = `${job.status?.parentId ?? ""}:${job.status?.state ?? ""}`;
  useEffect(() => {
    fetchOverview();
  }, [fetchOverview, version, jobKey]);

  const retry = () => {
    setLoad({ status: "loading" });
    fetchOverview();
  };

  if (opened) {
    return (
      <CacheContentsView
        recordId={opened.recordId}
        label={opened.label}
        onBack={() => setOpened(null)}
      />
    );
  }

  const running =
    job.status?.state === "running" ? new Set(job.status.profiles) : new Set<string>();
  const data = load.status === "ready" ? load.data : null;
  const selectedNames = data
    ? data.profiles.filter((p) => selected.has(p.profileId)).map((p) => p.profile)
    : [];
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const open = (r: CacheRecordInfo, profile?: string | null) =>
    setOpened({
      recordId: r.id,
      label: `${profile ?? r.profile ?? "Cache"} · ${formatWhen(r.modifiedAt)}`,
    });

  let body: React.ReactNode;
  if (load.status === "loading") {
    body = <StateView kind="loading" layout="inline" title="Reading the metadata caches…" />;
  } else if (load.status === "error") {
    body = (
      <StateView
        kind="error"
        layout="inline"
        title="Couldn't read the metadata caches"
        detail={load.error}
        actions={
          <button type="button" className="studio-btn" onClick={retry}>
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </button>
        }
      />
    );
  } else if (data) {
    body = (
      <>
        <Segmented
          aria-label="Metadata cache view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "profiles", label: "Profiles", count: data.profiles.length },
            { value: "history", label: "History", count: data.jobsTotal },
          ]}
        />
        {tab === "profiles" ? (
          <>
            <ProfilesTable
              rows={data.profiles}
              running={running}
              selected={selected}
              onToggle={toggle}
              onOpen={open}
              onPreview={onPreview}
              onPublish={onPublish}
              jobs={data.jobs}
              asking={asking}
              onAskWhy={askWhy}
            />
            {data.notes.map((n) => (
              <p key={n} className="mc-footnote">
                {n}
              </p>
            ))}
          </>
        ) : (
          <JobHistory
            jobs={data.jobs}
            total={data.jobsTotal}
            onOpen={open}
            asking={asking}
            onAskWhy={askWhy}
          />
        )}
      </>
    );
  }

  return (
    <div className="studio-page mc-page ui-enter">
      <header className="studio-page-head">
        <div>
          <h2>Metadata cache</h2>
          <p>What each profile's iPads download when they sync, as it was at the last publish.</p>
        </div>
        <div className="studio-page-actions">
          <UpdatedAgo at={load.status === "ready" ? load.cachedAt : null} />
          <button
            type="button"
            className="ui-icon-btn"
            onClick={() => fetchOverview()}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
          >
            {refreshing && load.status === "ready" ? (
              <Spinner size={14} />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="studio-btn primary"
            onClick={() => onPublish(selectedNames.length ? selectedNames : null)}
            disabled={!data}
          >
            <CloudUpload size={14} aria-hidden="true" />
            {selectedNames.length
              ? `Publish to iPad (${selectedNames.length})…`
              : "Publish to iPad…"}
          </button>
        </div>
      </header>
      {job.status?.state === "running" && (
        <Callout tone="info" busy title={`Publishing ${job.status.profiles.join(", ")}`}>
          Salesforce is building the caches. This page updates when it's done.
        </Callout>
      )}
      {body}
    </div>
  );
}

function ProfilesTable({
  rows,
  running,
  selected,
  onToggle,
  onOpen,
  onPreview,
  onPublish,
  jobs,
  asking,
  onAskWhy,
}: {
  rows: ProfileCacheRow[];
  running: Set<string>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (r: CacheRecordInfo, profile: string) => void;
  onPreview: (profile: string) => void;
  onPublish: (profiles: string[]) => void;
  jobs: CacheJob[];
  asking: string | null;
  onAskWhy: AskWhy;
}) {
  if (rows.length === 0) {
    return (
      <StateView
        kind="empty"
        layout="inline"
        icon={Archive}
        title="No mobile profiles yet"
        detail="Profiles show here once an active user on them holds an LSC license, or once they have a metadata cache."
      />
    );
  }
  return (
    <table className="studio-perf-table mc-table">
      <thead>
        <tr>
          <th aria-label="Select" />
          <th>Profile</th>
          <th>Published</th>
          <th>Status</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const state = running.has(r.profile) ? "running" : r.state;
          const label = PROFILE_STATE[state];
          const detail = rowDetail(r, state);
          const failed = state === "failed" ? failedFor(r, jobs) : null;
          return (
            <tr key={r.profileId}>
              <td className="check">
                <input
                  type="checkbox"
                  aria-label={`Select ${r.profile}`}
                  checked={selected.has(r.profileId)}
                  onChange={() => onToggle(r.profileId)}
                />
              </td>
              <td className="mc-profile">
                <span className="mc-ellipsis mc-profile-name" title={r.profile}>
                  {r.profile}
                </span>
                <div className="studio-perf-meta">
                  {r.users
                    ? `${r.users.toLocaleString()} ${r.users === 1 ? "user" : "users"}`
                    : "No LSC users"}
                </div>
              </td>
              <td className="mc-published">
                {r.live ? (
                  <>
                    <span title={formatWhen(r.live.modifiedAt)}>
                      {formatDay(r.live.modifiedAt)}
                    </span>
                    <div
                      className="studio-perf-meta mc-ellipsis"
                      title={r.live.createdBy ? `by ${r.live.createdBy}` : undefined}
                    >
                      {[
                        r.live.sizeBytes != null ? formatBytes(r.live.sizeBytes) : null,
                        r.live.createdBy,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </>
                ) : (
                  <span className="mc-none">Not yet</span>
                )}
              </td>
              <td className="mc-status">
                <span className={pillClass(label.tone)}>{label.label}</span>
                {detail && (
                  <div className="mc-detail-row">
                    <span
                      className="studio-perf-meta mc-detail"
                      title={
                        state === "behind"
                          ? `${detail}. Layout and Lightning page changes aren't counted here; the iPad preview's Next publish shows them.`
                          : detail
                      }
                    >
                      {detail}
                    </span>
                    {failed && (
                      <AskWhyButton
                        busy={asking === failed.id}
                        disabled={asking !== null}
                        onClick={() => onAskWhy(failed)}
                        link
                      />
                    )}
                  </div>
                )}
              </td>
              <td className="mc-actions">
                {state !== "running" && state !== "current" && (
                  <button
                    type="button"
                    className="studio-btn sm"
                    onClick={() => onPublish([r.profile])}
                    title={`Publish ${r.profile} to iPad`}
                  >
                    {state === "failed" ? (
                      <RotateCcw size={14} aria-hidden="true" />
                    ) : (
                      <CloudUpload size={14} aria-hidden="true" />
                    )}
                    {state === "failed" ? "Retry" : "Publish"}
                  </button>
                )}
                {r.live || state === "current" ? (
                  <Menu
                    label={`More for ${r.profile}`}
                    items={[
                      ...(r.live
                        ? [
                            {
                              label: "View contents",
                              icon: FolderOpen,
                              onSelect: () => onOpen(r.live as CacheRecordInfo, r.profile),
                            },
                            {
                              label: "Preview on iPad",
                              icon: Tablet,
                              onSelect: () => onPreview(r.profile),
                            },
                          ]
                        : []),
                      ...(state === "current"
                        ? [
                            {
                              label: "Publish again",
                              icon: CloudUpload,
                              onSelect: () => onPublish([r.profile]),
                            },
                          ]
                        : []),
                    ]}
                  />
                ) : (
                  <span className="mc-menu-slot" aria-hidden="true" />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The publish a failed row's last attempt belongs to. */
function failedFor(r: ProfileCacheRow, jobs: CacheJob[]): FailedPublish | null {
  if (!r.attempt) return null;
  const attempt = r.attempt;
  const job = jobs.find((j) => j.records.some((x) => x.id === attempt.id));
  return job
    ? asFailed(job)
    : {
        id: attempt.id,
        profiles: [r.profile],
        startedAt: attempt.createdAt,
        startedBy: attempt.createdBy,
        error: r.attemptError,
      };
}

const asFailed = (job: CacheJob): FailedPublish => ({
  id: job.id,
  profiles: jobProfiles(job),
  startedAt: job.startedAt,
  startedBy: job.startedBy,
  error: job.error ?? job.records.find((x) => x.error)?.error ?? null,
});

function AskWhyButton({
  busy,
  disabled,
  onClick,
  link,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  link?: boolean;
}) {
  return (
    <button
      type="button"
      className={link ? "studio-link-btn mc-ask" : "studio-btn sm"}
      onClick={onClick}
      disabled={disabled}
    >
      {busy ? <Spinner size={12} /> : <Sparkles size={link ? 12 : 14} aria-hidden="true" />}
      {link ? (
        <>
          Ask <AssistantName /> why
        </>
      ) : (
        <>
          Ask <AssistantName /> why it failed
        </>
      )}
    </button>
  );
}

/** The line under a row's status: what's behind, or why it failed. */
function rowDetail(r: ProfileCacheRow, state: ProfileCacheRow["state"]): string | null {
  if (state === "running") return r.attempt ? `Started ${formatWhen(r.attempt.createdAt)}` : null;
  if (state === "failed") return r.attemptError ?? null;
  if (state === "never") return "Its reps can't sync until it's published.";
  if (r.unpublished == null) return null;
  if (r.unpublished > 0)
    return `${r.unpublished} Admin Console ${r.unpublished === 1 ? "change" : "changes"} not on iPads`;
  return null;
}

function JobHistory({
  jobs,
  total,
  onOpen,
  asking,
  onAskWhy,
}: {
  jobs: CacheJob[];
  total: number;
  onOpen: (r: CacheRecordInfo) => void;
  asking: string | null;
  onAskWhy: AskWhy;
}) {
  if (jobs.length === 0) {
    return (
      <StateView
        kind="empty"
        layout="inline"
        icon={Archive}
        title="Nothing has been published yet"
        detail="Each Publish to iPad, from Studio or from Salesforce Setup, shows here with the profiles it built."
      />
    );
  }
  return (
    <section>
      <h3 className="ui-section-title">
        Publishes
        <span className="count">
          {total > jobs.length ? `newest ${jobs.length} of ${total}` : jobs.length}
        </span>
      </h3>
      <ul className="mc-jobs">
        <Limited
          as="li"
          items={jobs}
          render={(j) => (
            <JobRow key={j.id} job={j} onOpen={onOpen} asking={asking} onAskWhy={onAskWhy} />
          )}
        />
      </ul>
    </section>
  );
}

type LogLoad =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; logs: { id: string; profile: string | null; log: string }[] };

function JobRow({
  job,
  onOpen,
  asking,
  onAskWhy,
}: {
  job: CacheJob;
  onOpen: (r: CacheRecordInfo) => void;
  asking: string | null;
  onAskWhy: AskWhy;
}) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<LogLoad | null>(null);
  const state = JOB_STATE[job.state];
  const profiles = jobProfiles(job);

  const readLog = async () => {
    setLog({ status: "loading" });
    const res = await window.lscApi.studioMetadataCacheLog(job.id);
    if (res.error || !res.data)
      setLog({ status: "error", error: res.error || "Couldn't read the log." });
    else
      setLog({
        status: "ready",
        logs: (res.data as { logs: { id: string; profile: string | null; log: string }[] }).logs,
      });
  };

  return (
    <li className="mc-job">
      <button
        type="button"
        className="mc-job-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`mc-job-chevron${open ? " open" : ""}`}
        />
        <span className="mc-job-title mc-ellipsis">{formatWhen(job.startedAt)}</span>
        <span className="mc-job-sub mc-ellipsis" title={profiles.join(", ")}>
          {profiles.length ? profiles.join(", ") : "No profiles"}
          {job.startedBy && ` · ${job.startedBy}`}
        </span>
        <span className="mc-job-time">
          {job.state === "running" ? "—" : formatDuration(job.startedAt, job.updatedAt)}
        </span>
        <span className={pillClass(state.tone)}>{state.label}</span>
      </button>
      {open && (
        <div className="mc-job-body">
          {job.error && <div className="mc-job-error">{job.error}</div>}
          {job.records.length > 0 && (
            <table className="studio-perf-table mc-table">
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Status</th>
                  <th className="num">Size</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {job.records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.profile ?? "—"}</td>
                    <td>
                      {r.status}
                      {r.error && (
                        <div className="studio-perf-meta mc-detail" title={r.error}>
                          {r.error}
                        </div>
                      )}
                    </td>
                    <td className="num">{r.sizeBytes != null ? formatBytes(r.sizeBytes) : "—"}</td>
                    <td className="mc-actions">
                      {r.hasDocument && (
                        <button type="button" className="studio-btn sm" onClick={() => onOpen(r)}>
                          <FolderOpen size={14} aria-hidden="true" />
                          Contents
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(log === null || job.state === "failed") && (
            <div className="mc-job-actions">
              {job.state === "failed" && (
                <AskWhyButton
                  busy={asking === job.id}
                  disabled={asking !== null}
                  onClick={() => onAskWhy(asFailed(job))}
                />
              )}
              {log === null && (
                <button type="button" className="studio-link-btn" onClick={readLog}>
                  Show log
                </button>
              )}
            </div>
          )}
          {log?.status === "loading" && (
            <StateView kind="loading" layout="inline" title="Reading the log…" />
          )}
          {log?.status === "error" && (
            <StateView
              kind="error"
              layout="inline"
              title="Couldn't read the log"
              detail={log.error}
              actions={
                <button type="button" className="studio-btn" onClick={readLog}>
                  <RefreshCw size={14} aria-hidden="true" />
                  Retry
                </button>
              }
            />
          )}
          {log?.status === "ready" &&
            (log.logs.length === 0 ? (
              <div className="studio-perf-hint">This publish logged nothing.</div>
            ) : (
              log.logs.map((l) => (
                <div key={l.id} className="mc-log">
                  <div className="mc-log-title">
                    {l.id === job.id ? "Whole publish" : (l.profile ?? l.id)}
                  </div>
                  <pre>{l.log}</pre>
                </div>
              ))
            ))}
        </div>
      )}
    </li>
  );
}
