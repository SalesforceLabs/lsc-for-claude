import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Code, History, ListChecks, Rocket, Tablet, Eye, Maximize2, Minimize2 } from "lucide-react";
import ResizeHandle from "../../ui/ResizeHandle";
import Segmented from "../../ui/Segmented";
import Spinner from "../../ui/Spinner";
import StatusIcon from "../../ui/StatusIcon";
import StateView from "../../ui/StateView";
import { useOrgs } from "../../../hooks/useOrgs";
import { builderApi } from "./api";
import ChecksPane from "./ChecksPane";
import CodePane from "./CodePane";
import Conversation from "./Conversation";
import DeployDialog from "./DeployDialog";
import PreviewPane from "./PreviewPane";
import RunAsControl, { resolveRunAs } from "./RunAs";
import { useMobileLogins } from "../../../hooks/useMobileLogins";
import type { AppProjectsStore } from "./useAppProjects";
import { isBuilding, projectStatus, relativeTime, STATUS_LABEL, STATUS_TONE, targetLabel, versionNumber, versionSummary, parentBundle } from "./logic";
import type { AppIssue, AppProject, AppRunAs } from "./types";

type View = "preview" | "code" | "checks";

const LEFT_DEFAULT = 340;
const LEFT_MIN = 340;
const RIGHT_MIN = 480;
const LEFT_KEY = "bld-left-width";

interface AppWorkspaceProps {
  store: AppProjectsStore;
  project: AppProject;
  onBack: () => void;
  /** Put the deployed app on the iPad preview's page (Draft, Edit) as a pending change. */
  onAddToIpad: (project: AppProject) => void;
}

export default function AppWorkspace({ store, project, onBack, onAddToIpad }: AppWorkspaceProps) {
  const { current } = useOrgs();
  const building = isBuilding(project);
  const status = projectStatus(project);
  const [view, setView] = useState<View>("preview");
  const [left, setLeftNow] = useState(() => Math.max(LEFT_MIN, Number(window.localStorage.getItem(LEFT_KEY)) || LEFT_DEFAULT));
  const setLeft = (w: number) => (window.localStorage.setItem(LEFT_KEY, String(Math.round(w))), setLeftNow(w));
  const [focused, setFocused] = useState(false);
  const [tools, setTools] = useState<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shown, setShown] = useState<string | null>(project.currentVersionId);
  const [focus, setFocus] = useState<{ path: string; line?: number; nonce: number } | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(project.label);
  const [notice, setNotice] = useState("");
  const { logins, loaded } = useMobileLogins();
  const runState = resolveRunAs(project.runAs, logins, loaded);
  const body = useRef<HTMLDivElement>(null);
  const prevCurrent = useRef(project.currentVersionId);

  // A newly written version takes over the preview, unless the user is looking at an old one on purpose.
  useEffect(() => {
    if (prevCurrent.current !== project.currentVersionId) {
      if (shown === prevCurrent.current || shown === null || !project.versions.some((v) => v.id === shown)) setShown(project.currentVersionId);
      prevCurrent.current = project.currentVersionId;
    }
  }, [project.currentVersionId, project.versions, shown]);
  useEffect(() => setLabel(project.label), [project.label]);

  const version = project.versions.find((v) => v.id === shown) ?? project.versions[project.versions.length - 1];
  const isCurrent = !version || version.id === project.currentVersionId;
  const bundles = useMemo(() => [...new Set((version?.files ?? []).map((f) => f.bundle))], [version]);
  const parent = parentBundle(version?.files ?? [], project.name);
  const canDeploy = !!version && isCurrent && version.check.ok && !building;
  const changed = status === "changed";
  const deployedNow = status === "deployed";

  const commitLabel = () => {
    setEditing(false);
    const l = label.trim();
    if (l && l !== project.label) void store.rename(project.id, l);
    else setLabel(project.label);
  };

  const restore = async (versionId: string) => {
    const r = await builderApi().appRestore(project.id, versionId);
    if (r.error) return setNotice(r.error);
    await store.refreshOne(project.id);
    if (r.version) setShown(r.version.id);
  };

  const setRunAs = async (runAs: AppRunAs | null) => {
    await builderApi().appSetRunAs(project.id, runAs).catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)));
    await store.refreshOne(project.id);
  };

  const openIssue = (path: string, line?: number) => {
    setFocus({ path, line, nonce: Date.now() });
    setView("code");
  };
  const askFix = (i: AppIssue) => {
    void builderApi().appSend(project.id, `Fix this: ${i.message}${i.path ? ` (${i.path}${i.line ? `:${i.line}` : ""})` : ""}`);
  };

  return (
    <div className="bld-workspace ui-enter">
      <div className="bld-panes" ref={body}>
        <aside className={`bld-left${dragging ? " dragging" : ""}`} style={focused ? { display: "none" } : { width: left }} aria-label="Conversation">
          <div className="bld-left-head">
            <button type="button" className="ui-icon-btn" onClick={onBack} aria-label="Back to all apps" title="All apps">
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <span className="bld-crumb"><span className="bld-crumb-root">LSC apps</span><span aria-hidden="true">/</span><span className="bld-crumb-leaf">Conversation</span></span>
          </div>
          <Conversation project={project} writing={store.writing[project.id]} shownVersionId={version?.id ?? null} onShowVersion={(id) => setShown(id)} />
          <ResizeHandle value={left} min={LEFT_MIN} max={Math.max(LEFT_MIN, (body.current?.clientWidth ?? 1000) - RIGHT_MIN)} onChange={setLeft} onReset={() => setLeft(LEFT_DEFAULT)} onDragging={setDragging} label="Resize conversation" />
        </aside>

        <section className="bld-right" aria-label="App">
          <header className="bld-head">
            <div className="bld-head-title">
              {editing ? (
                <input className="bld-label-input" value={label} autoFocus aria-label="App name" onChange={(e) => setLabel(e.target.value)} onBlur={commitLabel} onKeyDown={(e) => (e.key === "Enter" ? commitLabel() : e.key === "Escape" && (setLabel(project.label), setEditing(false)))} />
              ) : (
                <button type="button" className="bld-label" onClick={() => setEditing(true)} title="Rename" aria-label={`${project.label}, rename`}>
                  {project.label}
                </button>
              )}
              <span className="ui-pill neutral">{targetLabel(project)}</span>
              <span className={`ui-pill ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
            </div>
            <div className="bld-head-actions">
              {project.versions.length > 0 && (
                <div className="bld-versions">
                  <button type="button" className="studio-btn sm" aria-haspopup="listbox" aria-expanded={versionsOpen} onClick={() => setVersionsOpen(!versionsOpen)} onBlur={() => setTimeout(() => setVersionsOpen(false), 120)}>
                    <History size={14} aria-hidden="true" />v{versionNumber(project, version?.id)}
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                  {versionsOpen && (
                    <ul className="bld-version-list ui-menu-list" role="listbox" aria-label="Versions">
                      {[...project.versions].reverse().map((v) => (
                        <li key={v.id} role="option" aria-selected={v.id === version?.id}>
                          <button type="button" className="ui-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => (setShown(v.id), setVersionsOpen(false))}>
                            <span>
                              v{versionNumber(project, v.id)} · {versionSummary(project, v)}
                            </span>
                            <span className="bld-version-time">{relativeTime(v.at)}</span>
                            {v.id === project.currentVersionId && <Check size={12} aria-label="Latest" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <button
                type="button"
                className={`studio-btn sm${deployedNow ? "" : " primary"}`}
                disabled={!canDeploy || deployedNow}
                onClick={() => setDeploying(true)}
                title={deployedNow ? "The org already has this version" : !version ? "Nothing to deploy yet" : !version.check.ok ? "Fix the errors in Checks first" : !isCurrent ? "Restore this version to deploy it" : deployedNow ? "The org already has this version" : undefined}
              >
                <Rocket size={14} aria-hidden="true" />
                Deploy
              </button>
              <button type="button" className="studio-btn sm" disabled={!project.deployed} onClick={() => onAddToIpad(project)} title={project.deployed ? "Put it on the iPad preview" : "Deploy first"}>
                <Tablet size={14} aria-hidden="true" />
                Add to iPad
              </button>
            </div>
          </header>

          <div className="bld-viewbar">
            <Segmented<View>
              aria-label="App view"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "preview", label: "Preview", icon: Eye },
                { value: "code", label: "Code", icon: Code },
                { value: "checks", label: "Checks", icon: ListChecks, count: version?.check.issues.filter((i) => i.severity !== "info").length || undefined },
              ]}
            />
            {notice && (
              <span className="bld-notice" role="alert">
                {notice}
              </span>
            )}
            <span className="bld-composer-spacer" />
            <RunAsControl value={project.runAs} onChange={(r) => void setRunAs(r)} disabled={building} />
            <div className="bld-viewbar-tools" ref={setTools} />
            <button
              type="button"
              className={`ui-icon-btn${focused ? " active" : ""}`}
              aria-pressed={focused}
              aria-label={focused ? "Show the conversation" : "Focus the preview"}
              title={focused ? "Show the conversation" : "Focus the preview"}
              onClick={() => setFocused(!focused)}
            >
              {focused ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
            </button>
          </div>

          <div className="bld-view" key={view}>
            {view === "preview" && <PreviewPane project={project} versionId={version?.id ?? null} building={building} runAs={runState} toolsSlot={tools} onOpenChecks={() => setView("checks")} />}
            {view === "code" && (
              <CodePane project={project} version={version} isCurrent={isCurrent} building={building} focus={focus} onSaved={async (id) => (await store.refreshOne(project.id), setShown(id))} onRestore={restore} />
            )}
            {view === "checks" && <ChecksPane version={version} building={building} projectId={project.id} runAs={runState} onOpenIssue={openIssue} onAskFix={askFix} />}
          </div>
        </section>
      </div>

      {deploying && (
        <DeployDialog
          project={project}
          orgLabel={current?.alias ?? current?.username ?? project.org}
          production={current?.kind === "production"}
          bundles={bundles}
          parent={parent}
          onClose={() => setDeploying(false)}
          onDeployed={() => void store.refreshOne(project.id)}
          onAddToIpad={() => onAddToIpad(project)}
        />
      )}
    </div>
  );
}
