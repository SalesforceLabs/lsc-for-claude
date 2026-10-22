import React, { useCallback, useEffect, useState } from "react";
import { AppWindow, ExternalLink, House, PanelTop, Zap } from "lucide-react";
import StateView from "../../ui/StateView";
import Spinner from "../../ui/Spinner";
import { builderApi } from "./api";
import { targetLabel } from "./logic";
import type { AppProjectsStore } from "./useAppProjects";
import type { AppRunAs, AppStarter } from "./types";

const TARGET_ICON = { home: House, record: PanelTop, action: Zap, tab: AppWindow } as const;

type Load = { status: "loading" } | { status: "ready"; starters: AppStarter[] } | { status: "error"; error: string };

/** Working LSC apps copied from GitHub; picking one opens a project with it as the first version. */
export default function StarterCards({ store, onOpen, runAs }: { store: AppProjectsStore; onOpen: (id: string) => void; runAs: AppRunAs | null }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const r = await builderApi().appStarters();
      setLoad(r.error || !r.starters ? { status: "error", error: r.error ?? "Couldn't read the starter apps." } : { status: "ready", starters: r.starters });
    } catch (e) {
      setLoad({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  const start = async (s: AppStarter) => {
    if (opening) return;
    setOpening(s.id);
    setError("");
    try {
      const r = await builderApi().appFromStarter(s.id, runAs ?? undefined);
      if (r.error || !r.project) setError(r.error ?? `Couldn't open ${s.label}.`);
      else {
        store.put(r.project);
        onOpen(r.project.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };

  return (
    <section className="bld-projects bld-starters" aria-label="Start from a sample">
      <div className="bld-projects-head">
        <h3 className="ui-section-title">
          Start from a sample {load.status === "ready" && <span className="count">{load.starters.length}</span>}
        </h3>
      </div>
      {error && (
        <div className="bld-inline-error" role="alert">
          {error}
        </div>
      )}
      {load.status === "loading" ? (
        <div className="bld-cards" aria-busy="true" aria-label="Loading samples">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bld-card skeleton">
              <div className="ui-skeleton" style={{ height: 14, width: "50%" }} />
              <div className="ui-skeleton" style={{ height: 11, width: "90%" }} />
              <div className="ui-skeleton" style={{ height: 11, width: "30%", marginTop: "auto" }} />
            </div>
          ))}
        </div>
      ) : load.status === "error" ? (
        <StateView
          kind="error"
          layout="inline"
          title="Couldn't load the samples"
          detail={load.error}
          actions={
            <button className="studio-btn" onClick={() => void reload()}>
              Retry
            </button>
          }
        />
      ) : load.starters.length === 0 ? (
        <StateView kind="empty" layout="inline" icon={AppWindow} title="No samples in this build" detail="Describe an app above instead." className="bld-empty" />
      ) : (
        <div className="bld-cards">
          {load.starters.map((s) => {
            const Icon = TARGET_ICON[s.target];
            const busy = opening === s.id;
            return (
              <div
                key={s.id}
                className={`bld-card bld-starter${opening && !busy ? " dimmed" : ""}`}
                role="button"
                tabIndex={0}
                aria-busy={busy}
                aria-label={`Start from ${s.label}, ${targetLabel(s)}`}
                onClick={() => void start(s)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    void start(s);
                  }
                }}
              >
                <div className="bld-card-head">
                  <span className="bld-starter-icon" aria-hidden="true">
                    {busy ? <Spinner size={14} /> : <Icon size={16} strokeWidth={1.75} />}
                  </span>
                  <span className="bld-card-title" title={s.label}>
                    {s.label}
                  </span>
                </div>
                <p className="bld-starter-desc" title={s.description}>
                  {s.description}
                </p>
                <div className="bld-card-meta">
                  <span className="ui-pill">{targetLabel(s)}</span>
                  {s.objects.filter((o) => o !== s.objectApiName).slice(0, 3).map((o) => (
                    <span key={o} className="ui-pill">
                      {o}
                    </span>
                  ))}
                </div>
                <div className="bld-card-foot">
                  <button
                    type="button"
                    className="bld-link bld-starter-source"
                    title={`${s.repo} at ${s.sha.slice(0, 7)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void window.lscApi.openExternal(s.url);
                    }}
                  >
                    {s.repo}
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
