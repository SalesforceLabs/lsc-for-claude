import React, { useEffect, useRef, useState } from "react";
import { Rocket, X } from "lucide-react";
import StateView from "../../ui/StateView";
import Spinner from "../../ui/Spinner";
import StatusIcon from "../../ui/StatusIcon";
import { builderApi } from "./api";
import { targetLabel } from "./logic";
import type { AppDeployPlan, AppDeployResult, AppProject } from "./types";

interface DeployDialogProps {
  project: AppProject;
  orgLabel: string;
  production: boolean;
  /** Bundles that go: the app and the `c/` components it uses. */
  bundles: string[];
  /** The app's parent bundle in the version being deployed. */
  parent: string;
  onClose: () => void;
  onDeployed: (result: AppDeployResult) => void;
  onAddToIpad: () => void;
}

interface TabProfile {
  label: string;
  name: string;
  reps?: number;
}

/** Profiles a tab app can be shown to, and the apps it can also join, from the server's tab options. */
async function loadTabProfiles(): Promise<{ profiles: TabProfile[]; apps: { fullName: string; label: string }[] }> {
  const r = await window.lscApi.studioAppTabOptions();
  const d = r.data as { profiles?: { label: string; name: string; lscUsers?: number }[]; apps?: { fullName: string; label: string }[] } | undefined;
  if (!d?.profiles) throw new Error(r.error ?? "Couldn't read the profiles.");
  return { profiles: d.profiles.map((p) => ({ label: p.label, name: p.name, reps: p.lscUsers })), apps: d.apps ?? [] };
}

const COMPONENT_LABELS: Record<string, string> = {
  LightningComponentBundle: "Lightning web component",
  QuickAction: "Quick action",
  FlexiPage: "Lightning page",
  CustomTab: "Custom tab",
  Profile: "Profile tab visibility",
  CustomApplication: "App tab",
};

/** The server lists components as "Type:Name"; the dialog wants them split and labelled. */
function normalizePlan(raw: unknown): AppDeployPlan {
  const p = raw as { components?: unknown[]; existing?: string[]; production?: boolean; warnings?: string[] };
  const components = (p.components ?? []).map((c) => {
    if (typeof c !== "string") return c as AppDeployPlan["components"][number];
    const i = c.indexOf(":");
    const type = i < 0 ? "" : c.slice(0, i);
    return { type, name: i < 0 ? c : c.slice(i + 1), detail: COMPONENT_LABELS[type] ?? type };
  });
  return { components, existing: p.existing ?? [], production: !!p.production, warnings: p.warnings ?? [] };
}

type Phase = { step: "confirm" } | { step: "deploying" } | { step: "done"; result: AppDeployResult } | { step: "failed"; error: string };

export default function DeployDialog({ project, orgLabel, production: hostProduction, bundles, parent, onClose, onDeployed, onAddToIpad }: DeployDialogProps) {
  const [phase, setPhase] = useState<Phase>({ step: "confirm" });
  const [ok, setOk] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  // What the deploy would write, from the server; until the backend has it the list is built from the files.
  const [plan, setPlan] = useState<{ status: "loading" } | { status: "ready"; plan: AppDeployPlan } | { status: "error"; error: string } | { status: "none" }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const isTab = project.target === "tab";
  const [tabOpts, setTabOpts] = useState<{ profiles: TabProfile[]; apps: { fullName: string; label: string }[] } | null>(null);
  const [tabProfiles, setTabProfiles] = useState<string[]>(project.tab?.profiles ?? []);
  const [tabApp, setTabApp] = useState(project.tab?.application ?? "");
  useEffect(() => {
    if (!isTab) return;
    let live = true;
    loadTabProfiles().then((o) => {
      if (!live) return;
      setTabOpts(o);
      if (!project.tab?.profiles?.length && project.runAs?.profile && o.profiles.some((p) => p.name === project.runAs?.profile)) setTabProfiles([project.runAs.profile]);
    }, () => live && setTabOpts({ profiles: [], apps: [] }));
    return () => {
      live = false;
    };
  }, [isTab, project.runAs?.profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (profiles: string[], app: string) => {
    setTabProfiles(profiles);
    setTabApp(app);
    void builderApi().appSetTabSettings?.(project.id, { profiles, application: app || undefined }).then(() => setAttempt((n) => n + 1));
  };
  const refusal = plan.status === "ready" ? plan.plan.warnings.find((w) => /^Deploy will refuse/i.test(w)) : undefined;
  useEffect(() => {
    const api = builderApi();
    if (!api.appDeployPlan) return setPlan({ status: "none" });
    let live = true;
    setPlan({ status: "loading" });
    api.appDeployPlan(project.id).then(
      (r) => live && setPlan(r.plan ? { status: "ready", plan: normalizePlan(r.plan) } : { status: "error", error: r.error ?? "Couldn't work out what a deploy would write." }),
      (e: unknown) => live && setPlan({ status: "error", error: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      live = false;
    };
  }, [project.id, attempt]);
  const production = plan.status === "ready" ? plan.plan.production : hostProduction;
  const overwrites = (c: AppDeployPlan["components"][number], p: AppDeployPlan) => !!c.existing || p.existing.includes(c.name) || p.existing.includes(`${c.type}:${c.name}`);
  const busy = phase.step === "deploying";
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const deploy = async () => {
    setPhase({ step: "deploying" });
    const r = await builderApi().appDeploy(project.id).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e), result: undefined }));
    if (r.result?.ok) {
      setPhase({ step: "done", result: r.result });
      onDeployed(r.result);
    } else setPhase({ step: "failed", error: r.result?.error ?? r.error ?? "The deploy didn't go through." });
  };

  return (
    <div className="studio-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="studio-modal bld-deploy ui-enter" role="dialog" aria-label="Deploy app" onClick={(e) => e.stopPropagation()}>
        <div className="studio-modal-header">
          <span className="studio-inspector-eyebrow">Deploy · {orgLabel}</span>
          <button className="ui-icon-btn" onClick={onClose} disabled={busy} title="Close" aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {phase.step === "done" ? (
          <>
            <div className="bld-deploy-result">
              <StatusIcon tone="pass" size={28} />
              <h2 className="studio-inspector-title">{project.label} is in the org</h2>
              <p className="bld-deploy-text">
                It isn't on reps' iPads yet. Add it to the {targetLabel(project).toLowerCase()} in the iPad preview, review the change, then publish to the iPad.
              </p>
              {phase.result.warnings.length > 0 && (
                <ul className="bld-deploy-warnings">
                  {phase.result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="studio-modal-actions">
              <button className="studio-btn" onClick={onClose}>
                Done
              </button>
              <button
                className="studio-btn primary"
                onClick={() => {
                  onClose();
                  onAddToIpad();
                }}
              >
                Add to iPad
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="studio-inspector-title">Deploy {project.label}?</h2>
            <p className="bld-deploy-text">This writes the following to the org. Nothing reaches an iPad until you add it to a page and publish.</p>
            {plan.status === "loading" && <StateView kind="loading" layout="inline" title="Working out what a deploy would write…" />}
            {plan.status === "error" && (
              <StateView kind="error" layout="inline" title="Couldn't check the org" detail={plan.error} actions={<button className="studio-btn" onClick={() => setAttempt(attempt + 1)}>Retry</button>} />
            )}
            {plan.status === "ready" && (
              <>
                <ul className="bld-deploy-list" aria-label="What gets deployed">
                  {plan.plan.components.map((c) => (
                    <li key={`${c.type}:${c.name}`}>
                      <code>{c.name}</code>
                      <span>{c.detail ?? c.label ?? c.type}</span>
                      {overwrites(c, plan.plan) && <span className="ui-pill warning">Will overwrite</span>}
                    </li>
                  ))}
                </ul>
                {isTab && (
                  <div className="bld-tab-settings">
                    <div className="bld-tab-label">Who gets this tab</div>
                    {!tabOpts ? (
                      <Spinner size={14} />
                    ) : (
                      <ul className="bld-tab-profiles">
                        {tabOpts.profiles.map((p) => (
                          <li key={p.name}>
                            <label className="ui-check">
                              <input
                                type="checkbox"
                                checked={tabProfiles.includes(p.name)}
                                onChange={(e) => setTab(e.target.checked ? [...tabProfiles, p.name] : tabProfiles.filter((n) => n !== p.name), tabApp)}
                              />
                              {p.label}
                              {p.reps ? <span className="bld-tab-reps">{p.reps} {p.reps === 1 ? "rep" : "reps"}</span> : null}
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    {tabOpts && tabOpts.apps.length > 0 && (
                      <label className="bld-tab-app">
                        Also add to app
                        <select className="studio-select" value={tabApp} onChange={(e) => setTab(tabProfiles, e.target.value)}>
                          <option value="">None</option>
                          {tabOpts.apps.map((a) => (
                            <option key={a.fullName} value={a.fullName}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}
                {plan.plan.warnings.length > 0 && (
                  <ul className="bld-deploy-warnings">
                    {plan.plan.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {plan.status === "none" && (
              <ul className="bld-deploy-list" aria-label="What gets deployed">
                {bundles.map((b) => (
                  <li key={b}>
                    <code>{b}</code>
                    <span>Lightning web component</span>
                  </li>
                ))}
                {(project.target === "record" || project.target === "action") && (
                  <li>
                    <code>{parent}</code>
                    <span>Quick action on {project.objectApiName}</span>
                  </li>
                )}
              </ul>
            )}
            {production && (
              <div className="studio-review-production">
                <StatusIcon tone="warning" size={20} />
                <div className="studio-review-production-text">
                  <div className="studio-finding-title">This is a production org</div>
                  <div className="studio-finding-detail">The components are deployed right away.</div>
                </div>
                <label className="ui-check">
                  <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
                  I want to change production
                </label>
              </div>
            )}
            {phase.step === "failed" && (
              <div className="bld-deploy-error" role="alert">
                <StatusIcon tone="error" size={18} />
                <span>{phase.error}</span>
              </div>
            )}
            <div className="studio-modal-actions">
              <button className="studio-btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button ref={first} className="studio-btn primary" disabled={busy || plan.status === "loading" || plan.status === "error" || !!refusal || (production && !ok)} onClick={deploy}>
                {busy ? <Spinner size={14} /> : <Rocket size={14} aria-hidden="true" />}
                {busy ? "Deploying…" : phase.step === "failed" ? "Try again" : production ? "Deploy to production" : "Deploy"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
