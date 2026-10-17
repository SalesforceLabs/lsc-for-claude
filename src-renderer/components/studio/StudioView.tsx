import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { FeatureMap, FeatureSummary, ProfileOption, SurfaceId } from "./types";
import { countBySeverity, mapFindings } from "./findings";
import { audienceProfiles, isScoped, type Lens } from "./lens";
import { SeverityChips } from "./SeverityChips";
import FeatureGrid from "./FeatureGrid";
import LensChecklist from "./LensChecklist";
import IpadPreview from "./IpadPreview";
import PublishedIpadPreview, { type PublishedState } from "./PublishedIpadPreview";
import type { PublishedResult } from "./published-types";
import type { IpadBlock } from "./ipad";
import Inspector from "./Inspector";
import ReviewDialog from "./ReviewDialog";
import PublishDialog from "./PublishDialog";
import type { PendingChange } from "./changes";
import "./studio.css";

interface StudioViewProps {
  onAskClaude: (prompt: string) => void;
}

/** Features the iPad preview is drawn from, loaded when it opens; Visit is loaded when its tab is opened. */
const PREVIEW_FEATURES = ["actions-home", "mobile-sync"];
/** Features that offer the preview — Visit too, so inspecting its sidebar keeps the preview open. */
const PREVIEW_HOSTS = [...PREVIEW_FEATURES, "visit"];

type MapState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; map: FeatureMap };

export default function StudioView({ onAskClaude }: StudioViewProps) {
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [featureId, setFeatureId] = useState("visit");
  // Maps are kept per feature so switching back doesn't re-query the org.
  const [maps, setMaps] = useState<Record<string, MapState>>({});
  const [selectedSurface, setSelectedSurface] = useState<SurfaceId | null>(null);
  // Edits queued in the tray, applied together from the review dialog.
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [reviewing, setReviewing] = useState(false);
  // Profiles to preselect in "Publish to iPad"; undefined = closed, null = none preselected.
  const [publishing, setPublishing] = useState<string[] | null | undefined>(undefined);
  // "View as" — kept across features so switching features keeps the same point of view.
  const [lens, setLens] = useState<Lens>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  // iPad preview — kept across the two features it's drawn from.
  const [previewing, setPreviewing] = useState(false);
  // "published" reads the profile's last metadata cache; "estimate" simulates the iPad after the next publish.
  const [previewMode, setPreviewMode] = useState<"published" | "estimate">("published");
  const [published, setPublished] = useState<Record<string, PublishedState>>({});
  // Item the inspector opens, e.g. a block clicked in the preview.
  const [focusItem, setFocusItem] = useState<string | null>(null);
  const selectSurface = (id: SurfaceId | null) => {
    setSelectedSurface(id);
    setFocusItem(null);
  };

  const loadProfiles = useCallback(() => {
    window.lscApi.studioListProfiles().then((res) => {
      if (res.data && Array.isArray(res.data)) setProfiles(res.data as ProfileOption[]);
    });
  }, []);

  useEffect(() => {
    window.lscApi.studioListFeatures().then((res) => {
      if (res.data && Array.isArray(res.data))
        setFeatures([...(res.data as FeatureSummary[])].sort((a, b) => a.title.localeCompare(b.title)));
    });
    loadProfiles();
  }, [loadProfiles]);

  // Maps are persisted per org by the main process; `refresh` re-queries the org.
  const load = useCallback(async (id: string, refresh = false) => {
    setMaps((m) => ({ ...m, [id]: { status: "loading" } }));
    const res = await window.lscApi.studioFeatureMap(id, refresh);
    const error = res.error || (res.data as { error?: string } | undefined)?.error;
    setMaps((m) => ({
      ...m,
      [id]: error ? { status: "error", error } : { status: "ready", map: res.data as FeatureMap },
    }));
    // A refresh dropped the cached profile list too.
    if (refresh) loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!maps[featureId]) load(featureId);
  }, [featureId, maps, load]);

  const canPreview = PREVIEW_HOSTS.includes(featureId);
  const showPreview = previewing && canPreview;
  useEffect(() => {
    if (!showPreview) return;
    for (const id of PREVIEW_FEATURES) if (!maps[id]) load(id);
  }, [showPreview, maps, load]);
  const loadPublished = useCallback(async (profile: string, refresh = false, userId?: string) => {
    setPublished((p) => ({ ...p, [profile]: { status: "loading" } }));
    const res = await window.lscApi.studioIpadPublished(profile, refresh, userId);
    const error = res.error || (res.data as { error?: string } | undefined)?.error;
    setPublished((p) => ({
      ...p,
      [profile]: error ? { status: "error", error } : { status: "ready", result: res.data as PublishedResult },
    }));
  }, []);
  const loadVisit = useCallback(() => {
    if (!maps.visit) load("visit");
  }, [maps.visit, load]);
  const readyMap = (id: string) => {
    const m = maps[id];
    return m?.status === "ready" ? m.map : null;
  };
  const inspectBlock = (block: IpadBlock) => {
    setFeatureId(block.featureId);
    setSelectedSurface(block.surface);
    setFocusItem(block.itemId);
  };

  const state = maps[featureId];
  const feature = features.find((f) => f.id === featureId);
  const map = state?.status === "ready" ? state.map : null;
  const surface = map?.surfaces.find((s) => s.id === selectedSurface) ?? null;
  // Only features with per-profile setup can be checked for a profile; elsewhere the profile is kept for later.
  const checkable = !!map?.surfaces.some(isScoped);
  const activeLens = checkable ? lens : null;
  const checkProfile = (profile: string | null) => {
    setLens(profile ? { profile } : null);
    selectSurface(null);
  };

  const publishedProfile = showPreview && previewMode === "published" ? (activeLens?.profile ?? null) : null;
  useEffect(() => {
    if (publishedProfile && !published[publishedProfile]) loadPublished(publishedProfile);
  }, [publishedProfile, published, loadPublished]);

  // Profiles with users, plus any profile a loaded map assigns config to (it may have no users yet).
  const lensOptions = useMemo(() => {
    const options = new Map(profiles.map((p) => [p.name.toLowerCase(), p]));
    for (const m of Object.values(maps)) {
      if (m.status !== "ready") continue;
      for (const name of audienceProfiles(m.map)) {
        if (!options.has(name.toLowerCase())) options.set(name.toLowerCase(), { name, users: 0 });
      }
    }
    return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, maps]);

  return (
    <div className="studio">
      <nav className="studio-rail">
        <div className="studio-rail-title">Features</div>
        {features.map((f) => (
          <button
            key={f.id}
            className={`studio-rail-item${f.id === featureId ? " active" : ""}`}
            disabled={!f.available}
            title={f.description}
            onClick={() => {
              setFeatureId(f.id);
              selectSurface(null);
            }}
          >
            <span>{f.title}</span>
            {!f.available && <span className="studio-soon">Soon</span>}
          </button>
        ))}
      </nav>

      <section className="studio-main">
        <header className="studio-header">
          <div>
            <h1 className="studio-title">{feature?.title ?? "Studio"}</h1>
            {map && (
              <div className="studio-subtitle">
                {map.summary} · {map.org} · mapped {new Date(map.collectedAt).toLocaleString()}
                {activeLens && (
                  <span className="studio-lens-note">
                    {" "}
                    · {showPreview ? "previewing" : "checking"} {activeLens.profile} — permission sets and record sharing aren't evaluated
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="studio-header-actions">
            {map && (
              <SeverityChips
                counts={countBySeverity(mapFindings(map, activeLens))}
                emptyLabel="No issues found"
              />
            )}
            {checkable && (
              <label
                className={`studio-lens-picker${activeLens ? " active" : ""}`}
                title="Check what one profile gets from this feature, and what's missing"
              >
                <span>{showPreview ? (activeLens ? "Previewing as" : "Preview as") : activeLens ? "Checking" : "Check a profile"}</span>
                <select value={activeLens?.profile ?? ""} onChange={(e) => checkProfile(e.target.value || null)}>
                  <option value="">{activeLens ? "All configuration" : "Choose…"}</option>
                  {lensOptions.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} {p.users ? `(${p.users})` : "(no active users)"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {map && canPreview && (
              <button
                className={`studio-btn${showPreview ? " active" : ""}`}
                aria-pressed={showPreview}
                onClick={() => {
                  setPreviewing(!showPreview);
                  selectSurface(null);
                }}
                title="A block render of what LSC Mobile shows — tabs, home page, and record actions"
              >
                {showPreview ? "Back to board" : "iPad preview"}
              </button>
            )}
            {map && (
              <button className="studio-btn" onClick={() => setPublishing(null)} title="Regenerate the mobile metadata cache">
                Publish to iPad
              </button>
            )}
            <button
              className="studio-btn"
              onClick={() => load(featureId, true)}
              disabled={state?.status === "loading"}
            >
              {state?.status === "loading" ? "Mapping…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className="studio-stage">
          {(!state || state.status === "loading") && (
            <div className="studio-placeholder">
              <div className="studio-spinner" />
              <div>Mapping {feature?.title ?? "feature"} configuration…</div>
              <div className="studio-placeholder-sub">
                Reading objects, scripts, rules, triggers, mobile sync, actions, and settings from your org.
              </div>
            </div>
          )}
          {state?.status === "error" && (
            <div className="studio-placeholder">
              <div className="studio-placeholder-error">Couldn't map this feature</div>
              <div className="studio-placeholder-sub">{state.error}</div>
              <button className="studio-btn" onClick={() => load(featureId, true)}>
                Try again
              </button>
            </div>
          )}
          {map && (
            <div className="studio-canvas">
              {showPreview && (
                <div className="studio-ipad-mode" role="group" aria-label="Preview mode">
                  <button
                    type="button"
                    className={`studio-btn${previewMode === "published" ? " active" : ""}`}
                    aria-pressed={previewMode === "published"}
                    onClick={() => setPreviewMode("published")}
                  >
                    As published
                  </button>
                  <button
                    type="button"
                    className={`studio-btn${previewMode === "estimate" ? " active" : ""}`}
                    aria-pressed={previewMode === "estimate"}
                    onClick={() => setPreviewMode("estimate")}
                  >
                    After next publish (estimate)
                  </button>
                </div>
              )}
              {showPreview && previewMode === "published" ? (
                publishedProfile ? (
                  <PublishedIpadPreview
                    profile={publishedProfile}
                    state={published[publishedProfile]}
                    onRefresh={(userId) => loadPublished(publishedProfile, true, userId)}
                    onPickUser={(userId) => loadPublished(publishedProfile, false, userId)}
                  />
                ) : (
                  <div className="studio-placeholder">
                    <div className="studio-placeholder-sub">
                      Choose a profile in “Preview as” to see the iPad exactly as that profile's users last downloaded it.
                    </div>
                  </div>
                )
              ) : showPreview ? (
                <IpadPreview
                  actionsMap={readyMap("actions-home")}
                  syncMap={readyMap("mobile-sync")}
                  visitMap={readyMap("visit")}
                  onLoadVisit={loadVisit}
                  visitError={maps.visit?.status === "error" ? maps.visit.error : undefined}
                  lens={activeLens}
                  pending={pending}
                  onSelect={inspectBlock}
                  selectedItem={selectedSurface ? focusItem : null}
                  startOn={featureId === "visit" ? "Visit" : undefined}
                />
              ) : activeLens ? (
                <LensChecklist
                  map={map}
                  lens={activeLens}
                  selectedSurface={selectedSurface}
                  onSelectSurface={selectSurface}
                  pending={pending}
                  onPendingChange={setPending}
                  onPublish={(preselect) => setPublishing(preselect)}
                  onExit={() => checkProfile(null)}
                />
              ) : (
                <FeatureGrid map={map} selectedSurface={selectedSurface} onSelectSurface={selectSurface} />
              )}
            </div>
          )}
          {map && surface && (
            <Inspector
              map={map}
              surface={surface}
              lens={activeLens}
              onClose={() => selectSurface(null)}
              onCheckProfile={checkable ? checkProfile : undefined}
              onAskClaude={onAskClaude}
              profiles={profiles}
              pending={pending}
              onPendingChange={setPending}
              focusItem={focusItem}
            />
          )}
          {map && reviewing && (
            <ReviewDialog
              changes={pending}
              org={map.org}
              onClose={(applied, remaining) => {
                setReviewing(false);
                setPending(remaining);
                // Other features' maps may be stale too; the main process dropped them from its cache.
                if (applied.length > 0) {
                  setMaps({});
                  load(featureId, true);
                }
              }}
              onPublish={(preselect) => setPublishing(preselect)}
            />
          )}
          {map && publishing !== undefined && (
            <PublishDialog
              org={map.org}
              profiles={profiles}
              preselected={publishing}
              onClose={() => setPublishing(undefined)}
            />
          )}
        </div>

        {pending.length > 0 && (
          <div className="studio-tray">
            <span className="studio-tray-count">
              {pending.length} pending {pending.length === 1 ? "change" : "changes"}
            </span>
            <span className="studio-tray-list">{pending.map((p) => p.fix.label).join(" · ")}</span>
            <button className="studio-btn" onClick={() => setPending([])}>
              Discard all
            </button>
            <button className="studio-btn primary" onClick={() => setReviewing(true)} disabled={!map}>
              Review & apply…
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
