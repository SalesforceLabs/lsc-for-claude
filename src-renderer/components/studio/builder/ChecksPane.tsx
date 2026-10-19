import React, { useEffect, useState } from "react";
import { ChevronRight, CircleCheck, Database, ListChecks, LogIn, UserRound, WifiOff } from "lucide-react";
import Spinner from "../../ui/Spinner";
import StatusIcon from "../../ui/StatusIcon";
import StateView from "../../ui/StateView";
import { fileName } from "./logic";
import { builderApi } from "./api";
import { useSignIn, type RunAsState } from "./RunAs";
import type { AppIssue, AppObjectInfo, AppVersion } from "./types";

interface OfflineIssue {
  severity: "online" | "gated";
  kind: string;
  detail: string;
  bundle?: string;
}

const GROUPS: { severity: AppIssue["severity"]; title: string; tone: "error" | "warning" | "info" }[] = [
  { severity: "error", title: "Errors", tone: "error" },
  { severity: "warning", title: "Warnings", tone: "warning" },
  { severity: "info", title: "Notes", tone: "info" },
];

interface ChecksPaneProps {
  version: AppVersion | undefined;
  building: boolean;
  /** Open the Code view at a file and line. */
  onOpenIssue: (path: string, line?: number) => void;
  /** Ask Roz to fix an issue. */
  onAskFix?: (issue: AppIssue) => void;
  /** The project, and whose login the preview runs as: when it's a test user, Checks also says what they can read. */
  projectId?: string;
  runAs?: RunAsState;
}

type Access = { status: "loading" } | { status: "ready"; objects: AppObjectInfo[] } | { status: "error"; error: string; expired: boolean };

/** What the run-as test user can do with each object the app reads. */
function RunAsAccess({ projectId, runAs, names }: { projectId: string; runAs: Extract<RunAsState, { kind: "user" | "expired" | "missing" }>; names: string[] }) {
  const [access, setAccess] = useState<Access>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const { busy, signIn, canSignIn } = useSignIn(() => setNonce((n) => n + 1));
  const key = names.join(",");
  useEffect(() => {
    let live = true;
    setAccess({ status: "loading" });
    builderApi()
      .appDescribe(names, projectId)
      .then(
        (r) => live && setAccess(r.objects ? { status: "ready", objects: r.objects } : { status: "error", error: r.error ?? "Couldn't check their access.", expired: /expired|sign in/i.test(r.error ?? "") }),
        (e: unknown) => live && setAccess({ status: "error", error: e instanceof Error ? e.message : String(e), expired: false })
      );
    return () => {
      live = false;
    };
  }, [projectId, key, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = runAs.name;

  return (
    <section className="bld-check-group" aria-label={`What ${name} can read`}>
      <h3 className="bld-check-title">
        <UserRound size={14} aria-hidden="true" /> What {name} can read
      </h3>
      {access.status === "loading" && (
        <div className="bld-check-ok" role="status">
          <Spinner size={12} /> Checking {name}'s access…
        </div>
      )}
      {access.status === "error" && (
        <div className="bld-check-note" role="alert">
          {access.error}{" "}
          {access.expired && (
            <button type="button" className="studio-btn sm" disabled={busy || !canSignIn} onClick={() => void signIn(runAs.kind === "expired" ? runAs.login : undefined)}>
              {busy ? <Spinner size={12} /> : <LogIn size={14} aria-hidden="true" />}
              {busy ? "Waiting for sign-in…" : "Sign in again"}
            </button>
          )}
          {!access.expired && (
            <button type="button" className="studio-btn sm" onClick={() => setNonce((n) => n + 1)}>
              Retry
            </button>
          )}
        </div>
      )}
      {access.status === "ready" && access.objects.every((o) => !o.access) && <div className="bld-check-note">No access details came back for these objects.</div>}
      {access.status === "ready" && access.objects.some((o) => o.access) && (
        <ul className="bld-issues">
          {access.objects
            .filter((o) => o.access)
            .map((o) => {
              const hidden = o.hiddenFields ?? [];
              return (
                <li key={o.name} className="bld-issue">
                  <StatusIcon tone={o.access === "none" ? "error" : hidden.length ? "warning" : "pass"} size={18} />
                  <div className="bld-issue-body">
                    <div className="bld-issue-msg">
                      {o.access === "none" ? (
                        <>
                          {name} can't read <code>{o.name}</code>
                        </>
                      ) : (
                        <>
                          {name} can {o.access === "edit" ? "read and edit" : "read"} <code>{o.name}</code>
                          {hidden.length > 0 && `, but can't see ${hidden.length} ${hidden.length === 1 ? "field" : "fields"}`}
                        </>
                      )}
                    </div>
                    {o.note && <div className="bld-issue-fix">{o.note}</div>}
                    {hidden.length > 0 && (
                      <details className="bld-hidden">
                        <summary>
                          <ChevronRight size={12} aria-hidden="true" /> Hidden fields
                        </summary>
                        <div>{hidden.map((f) => <code key={f}>{f}</code>)}</div>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}

export default function ChecksPane({ version, building, onOpenIssue, onAskFix, projectId, runAs }: ChecksPaneProps) {
  if (!version) {
    return building ? (
      <StateView kind="loading" layout="inline" title="Checks run after the first version" />
    ) : (
      <StateView kind="empty" layout="inline" icon={ListChecks} title="Nothing to check yet" detail="Checks appear once Roz has written the app." />
    );
  }
  const { check } = version;
  const offline = ((check.offline as { issues?: OfflineIssue[] } | undefined)?.issues ?? []) as OfflineIssue[];
  const objects = check.objects ?? [];
  const unsynced = objects.filter((o) => o.synced === false);
  const none = check.issues.length === 0;

  return (
    <div className="bld-checks">
      <div className={`bld-verdict ${check.ok ? "ok" : "bad"}`} role="status">
        <StatusIcon tone={check.ok ? "pass" : "error"} size={22} />
        <div>
          <div className="bld-verdict-title">{check.ok ? (none ? "All checks pass" : "No blocking problems") : "This version has problems"}</div>
          <div className="bld-verdict-detail">
            {check.ok ? "It compiles and can be deployed." : "Fix the errors below before deploying; Roz can do it if you ask."}
          </div>
        </div>
      </div>

      {GROUPS.map((g) => {
        const items = check.issues.filter((i) => i.severity === g.severity);
        if (!items.length) return null;
        return (
          <section key={g.severity} className="bld-check-group" aria-label={g.title}>
            <h3 className="bld-check-title">
              {g.title} <span className="bld-check-count">{items.length}</span>
            </h3>
            <ul className="bld-issues">
              {items.map((i, n) => (
                <li key={`${i.rule}:${n}`} className="bld-issue">
                  <StatusIcon tone={g.tone} size={18} />
                  <div className="bld-issue-body">
                    <div className="bld-issue-msg">{i.message}</div>
                    <div className="bld-issue-meta">
                      <code>{i.rule}</code>
                      {i.path && (
                        <button type="button" className="bld-link" onClick={() => onOpenIssue(i.path!, i.line)}>
                          {fileName(i.path)}
                          {i.line ? `:${i.line}` : ""}
                        </button>
                      )}
                      {onAskFix && g.severity !== "info" && (
                        <button type="button" className="bld-link" onClick={() => onAskFix(i)}>
                          Ask Roz to fix
                        </button>
                      )}
                    </div>
                    {i.fix && <div className="bld-issue-fix">{i.fix}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="bld-check-group" aria-label="Offline on the iPad">
        <h3 className="bld-check-title">
          <WifiOff size={14} aria-hidden="true" /> Offline on the iPad
        </h3>
        {offline.length === 0 ? (
          <div className="bld-check-ok">
            <CircleCheck size={14} aria-hidden="true" /> Everything this app reads is available offline.
          </div>
        ) : (
          <ul className="bld-issues">
            {offline.map((o, n) => (
              <li key={n} className="bld-issue">
                <StatusIcon tone="warning" size={18} />
                <div className="bld-issue-body">
                  <div className="bld-issue-msg">
                    <code>{o.detail}</code> {o.severity === "gated" ? "works offline only when the org has offline GraphQL" : "needs a network connection"}
                  </div>
                  <div className="bld-issue-meta">
                    <span>{o.kind}</span>
                    {o.bundle && <span>in {o.bundle}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {objects.length > 0 && (
        <section className="bld-check-group" aria-label="Objects it reads">
          <h3 className="bld-check-title">
            <Database size={14} aria-hidden="true" /> Objects it reads
          </h3>
          <ul className="bld-issues">
            {objects.map((o) => (
              <li key={o.name} className="bld-issue">
                <StatusIcon tone={o.synced === true ? "pass" : o.synced === false ? "warning" : "unknown"} size={18} />
                <div className="bld-issue-body">
                  <div className="bld-issue-msg">
                    <code>{o.name}</code>{" "}
                    {o.synced === true ? "is synced to the iPad" : o.synced === false ? "is not synced to the iPad. Offline it will show nothing." : "could not be checked"}
                  </div>
                  {o.synced === false && <div className="bld-issue-fix">Add it to the iPad sync from Mobile Sync in Setup, then publish.</div>}
                </div>
              </li>
            ))}
          </ul>
          {unsynced.length > 0 && <div className="bld-check-note">{unsynced.length === 1 ? "One object isn't" : `${unsynced.length} objects aren't`} synced, so the app will look empty on a rep's iPad.</div>}
        </section>
      )}

      {projectId && runAs && runAs.kind !== "admin" && objects.length > 0 && <RunAsAccess projectId={projectId} runAs={runAs} names={objects.map((o) => o.name)} />}
    </div>
  );
}
