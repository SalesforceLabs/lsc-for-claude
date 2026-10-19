import React, { useEffect, useRef, useState } from "react";
import { AppWindow, ArrowUp, ChevronDown, Download, House, PanelTop, Pencil, Sparkles, Tablet, Trash2, Zap } from "lucide-react";
import StateView from "../../ui/StateView";
import Spinner from "../../ui/Spinner";
import Menu from "../../ui/Menu";
import SearchPicker from "../../ui/SearchPicker";
import { builderApi } from "./api";
import { COMMON_OBJECTS, EXAMPLES, TARGETS, needsObject, STATUS_LABEL, STATUS_TONE, projectStatus, relativeTime, targetLabel } from "./logic";
import RunAsControl, { defaultRunAs } from "./RunAs";
import StarterCards from "./StarterCards";
import { useOrgs } from "../../../hooks/useOrgs";
import { useMobileLogins } from "../../../hooks/useMobileLogins";
import type { AppProjectsStore } from "./useAppProjects";
import type { AppProject, AppRunAs, AppTarget, OrgApp } from "./types";

const TARGET_ICON = { home: House, record: PanelTop, action: Zap, tab: AppWindow } as const;
const IDENT = /^[A-Za-z][A-Za-z0-9_]*(__[a-z]+)?$/;

interface GalleryProps {
  store: AppProjectsStore;
  onOpen: (id: string) => void;
}

/** The empty state is the hero: one big composer. Below it, the org's projects. */
export default function Gallery({ store, onOpen }: GalleryProps) {
  const { projects, state } = store;
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState<AppTarget>("home");
  const [object, setObject] = useState("Account");
  const [pickingObject, setPickingObject] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // Run as: the org's first signed-in test user until the user picks someone (or the admin login).
  const { current } = useOrgs();
  const { logins, loaded } = useMobileLogins();
  const [runAs, setRunAs] = useState<AppRunAs | null>(null);
  const chosen = useRef(false);
  useEffect(() => {
    if (!loaded || chosen.current) return;
    setRunAs(defaultRunAs(logins, current?.orgId));
  }, [loaded, logins, current?.orgId]);

  const canBuild = prompt.trim().length > 3 && !starting;
  const build = async () => {
    if (!canBuild) return;
    setStarting(true);
    setError("");
    try {
      const r = await builderApi().appCreate({ prompt: prompt.trim(), target, ...(needsObject(target) ? { objectApiName: object } : {}), ...(runAs ? { runAs } : {}) });
      if (r.error || !r.project) {
        setError(r.error ?? "Roz couldn't start building.");
        return;
      }
      store.put(r.project);
      setPrompt("");
      onOpen(r.project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  // The textarea grows with the prompt, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [prompt]);

  const [importing, setImporting] = useState<{ status: "loading" } | { status: "ready"; apps: OrgApp[] } | { status: "error"; error: string } | null>(null);
  const [importError, setImportError] = useState("");
  const openImport = async () => {
    setImporting({ status: "loading" });
    setImportError("");
    try {
      const r = await builderApi().appOrgApps();
      if (r.error || !r.apps) setImporting({ status: "error", error: r.error ?? "Couldn't list the org's apps." });
      else setImporting({ status: "ready", apps: r.apps });
    } catch (e) {
      setImporting({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };
  const importApp = async (name: string) => {
    setImporting(null);
    try {
      const r = await builderApi().appImport(name);
      if (r.error || !r.project) setImportError(r.error ?? "Couldn't import that app.");
      else {
        store.put(r.project);
        onOpen(r.project.id);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const [query, setQuery] = useState("");
  const objectOptions = [...new Set([object, ...COMMON_OBJECTS])].map((o) => ({ value: o, label: o }));
  if (IDENT.test(query) && !objectOptions.some((o) => o.value.toLowerCase() === query.toLowerCase())) objectOptions.unshift({ value: query, label: query });

  return (
    <div className="bld-gallery ui-enter">
      <section className="bld-hero" aria-label="Describe an app">
        <span className="bld-hero-mark" aria-hidden="true">
          <Sparkles size={20} strokeWidth={1.75} />
        </span>
        <h2 className="bld-hero-title">What should your reps' iPads show?</h2>
        <p className="bld-hero-sub">Describe an app in plain words. Roz reads your org's real fields, builds it, and runs it here before anything is deployed.</p>
        <div className={`bld-composer${starting ? " busy" : ""}`}>
          <textarea
            ref={box}
            className="bld-composer-input"
            rows={2}
            value={prompt}
            autoFocus
            disabled={starting}
            placeholder="Describe an app for your reps…"
            aria-label="Describe an app for your reps"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void build();
              }
            }}
          />
          <div className="bld-composer-bar">
            {needsObject(target) && (
              <button type="button" className="studio-btn sm bld-object-btn" onClick={() => setPickingObject(true)} aria-label={`Object: ${object}. Change`}>
                {object}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}
            <span className="bld-composer-spacer" />
            <RunAsControl
              value={runAs}
              onChange={(r) => {
                chosen.current = true;
                setRunAs(r);
              }}
              disabled={starting}
            />
            <span className="bld-kbd" aria-hidden="true">
              ⌘↵
            </span>
            <button type="button" className="studio-btn primary" disabled={!canBuild} onClick={build}>
              {starting ? <Spinner size={14} /> : <ArrowUp size={14} aria-hidden="true" />}
              {starting ? "Starting…" : "Build"}
            </button>
          </div>
        </div>
        <div className="bld-targets" role="radiogroup" aria-label="Where the app goes">
          {TARGETS.map((t) => {
            const Icon = TARGET_ICON[t.value];
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={target === t.value}
                className={`bld-target${target === t.value ? " selected" : ""}`}
                onClick={() => setTarget(t.value)}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                <span className="bld-target-label">{t.label}</span>
                <span className="bld-target-hint">{t.hint}</span>
              </button>
            );
          })}
        </div>
        {error && (
          <div className="bld-inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="bld-chips" role="list" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              role="listitem"
              className="bld-chip"
              title={ex.prompt}
              onClick={() => {
                setPrompt(ex.prompt);
                setTarget(ex.target);
                if (ex.objectApiName) setObject(ex.objectApiName);
                box.current?.focus();
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </section>

      <section className="bld-projects" aria-label="Your apps">
        <div className="bld-projects-head">
          <h3 className="ui-section-title">
            Your apps {state.status === "ready" && <span className="count">{projects.length}</span>}
          </h3>
          <button type="button" className="studio-btn sm" onClick={openImport} disabled={importing?.status === "loading"}>
            {importing?.status === "loading" ? <Spinner size={14} /> : <Download size={14} aria-hidden="true" />}
            Start from an app in this org
          </button>
        </div>
        {importError && (
          <div className="bld-inline-error" role="alert">
            {importError}
          </div>
        )}
        {state.status === "loading" ? (
          <div className="bld-cards" aria-busy="true" aria-label="Loading your apps">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bld-card skeleton">
                <div className="ui-skeleton" style={{ height: 14, width: "55%" }} />
                <div className="ui-skeleton" style={{ height: 11, width: "35%" }} />
                <div className="ui-skeleton" style={{ height: 11, width: "25%", marginTop: "auto" }} />
              </div>
            ))}
          </div>
        ) : state.status === "error" ? (
          <StateView
            kind="error"
            layout="inline"
            title="Couldn't load your apps"
            detail={state.error}
            actions={
              <button className="studio-btn" onClick={() => void store.reload()}>
                Retry
              </button>
            }
          />
        ) : projects.length === 0 ? (
          <StateView
            kind="empty"
            layout="inline"
            icon={Tablet}
            title="No apps in this org yet"
            detail="Describe one above, start from a sample below, or start from an LSC app the org already has and change it with Roz."
            className="bld-empty"
          />
        ) : (
          <div className="bld-cards">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p.id)} store={store} />
            ))}
          </div>
        )}
      </section>

      <StarterCards store={store} onOpen={onOpen} runAs={runAs} />

      {pickingObject && (
        <SearchPicker
          eyebrow="Record page"
          title="Which object's record page?"
          description="The app gets the record's Id and object name. Type an API name that isn't listed to use it."
          placeholder="Search or type an object API name"
          options={objectOptions}
          emptyTitle="No objects"
          onQueryChange={setQuery}
          onPick={(v) => {
            setObject(v);
            setPickingObject(false);
            setQuery("");
          }}
          onCancel={() => {
            setPickingObject(false);
            setQuery("");
          }}
        />
      )}
      {importing && importing.status !== "loading" && (
        <SearchPicker
          eyebrow="Start from an app"
          title="LSC apps in this org"
          description="Roz copies the bundle into a new project. Nothing in the org changes until you deploy."
          placeholder="Search apps"
          options={importing.status === "ready" ? importing.apps.map((a) => ({ value: a.name, label: a.label || a.name, detail: `${a.target === "record" ? `${a.objectApiNames?.[0] ?? "Record"} page` : a.target === "home" ? "Home page" : "App"} · ${a.name}` })) : []}
          emptyTitle={importing.status === "error" ? "Couldn't list apps" : "No LSC apps in this org yet"}
          emptyDetail={importing.status === "error" ? importing.error : "Bundles named lscMobileInline_… show up here."}
          onPick={importApp}
          onCancel={() => setImporting(null)}
        />
      )}
    </div>
  );
}

function ProjectCard({ project: p, onOpen, store }: { project: AppProject; onOpen: () => void; store: AppProjectsStore }) {
  const status = projectStatus(p);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState(p.label);
  return (
    <div
      className="bld-card"
      role="button"
      tabIndex={0}
      aria-label={`${p.label}, ${targetLabel(p)}, ${STATUS_LABEL[status]}`}
      onClick={() => !renaming && onOpen()}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="bld-card-head">
        {renaming ? (
          <input
            className="studio-input bld-card-rename"
            value={label}
            autoFocus
            aria-label="App name"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (label.trim() && label.trim() !== p.label) void store.rename(p.id, label.trim());
              else setLabel(p.label);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setLabel(p.label);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span className="bld-card-title" title={p.label}>
            {p.label}
          </span>
        )}
        <Menu
          label={`Actions for ${p.label}`}
          items={[
            { label: "Rename", icon: Pencil, onSelect: () => setRenaming(true) },
            { label: "Delete…", icon: Trash2, danger: true, onSelect: () => setConfirming(true) },
          ]}
        />
      </div>
      <div className="bld-card-meta">
        <span className="ui-pill">{targetLabel(p)}</span>
        <span className={`ui-pill ${STATUS_TONE[status] === "neutral" ? "" : STATUS_TONE[status]}`}>
          {status === "building" && <Spinner size={10} className="bld-pill-spin" />}
          {STATUS_LABEL[status]}
        </span>
      </div>
      <div className="bld-card-foot">
        <span>{relativeTime(p.updatedAt)}</span>
        <span className="ui-num">
          {p.versions.length} {p.versions.length === 1 ? "version" : "versions"}
        </span>
      </div>
      {confirming && (
        <div className="studio-modal-backdrop" onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>
          <div
            className="studio-modal"
            role="dialog"
            aria-label="Delete app"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}
          >
            <h2 className="studio-inspector-title">Delete "{p.label}"?</h2>
            <p className="studio-inspector-desc">This removes the project, its conversation and every version from Roz. {p.deployed ? "The bundle already deployed to the org stays there." : "Nothing was deployed, so the org is untouched."}</p>
            <div className="studio-modal-actions">
              <button className="studio-btn" autoFocus onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className="studio-btn danger"
                onClick={() => {
                  setConfirming(false);
                  void store.remove(p.id);
                }}
              >
                Delete app
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
