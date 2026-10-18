import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureMap, FeatureReadiness, FeatureSummary, ProfileOption, SurfaceId } from "./types";
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
import SyncHealthView from "./SyncHealthView";
import ReadinessView from "./ReadinessView";
import SetupOverview from "./SetupOverview";
import UserTraceView from "./UserTraceView";
import DriftView from "./DriftView";
import type { ReadinessState } from "./readiness";
import "./studio.css";

interface StudioViewProps {
  onAskClaude: (prompt: string) => void;
}

/** Features the iPad preview is drawn from, loaded when it opens; Visit is loaded when its tab is opened. */
const PREVIEW_FEATURES = ["actions-home", "mobile-sync"];
/** Features whose page offers a "Preview on iPad" shortcut. */
const PREVIEW_HOSTS = [...PREVIEW_FEATURES, "visit"];

type MapState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; map: FeatureMap };

/** What the main pane shows: the iPad preview, a Setup page or feature, or a Testing page. */
type Section = "preview" | "overview" | "user-check" | "drift" | "setup" | "sync";

/** A preview block opened in the inspector beside the preview. */
interface PreviewInspect {
  featureId: string;
  surface: SurfaceId;
  itemId: string;
}

export default function StudioView({ onAskClaude }: StudioViewProps) {
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [featureId, setFeatureId] = useState("visit");
  /** Feature "Check a user" opens with, when reached from a feature's page. */
  const [traceFeature, setTraceFeature] = useState<string | undefined>();
  const [section, setSection] = useState<Section>("overview");
  // A feature opens on its readiness checks; "board" is every configuration surface.
  const [featureView, setFeatureView] = useState<"readiness" | "board">("readiness");
  const [readiness, setReadiness] = useState<Record<string, ReadinessState>>({});
  // The org a user check last read, for applying its changes before any map is loaded.
  const [seenOrg, setSeenOrg] = useState<string | undefined>(undefined);
  // Sync health stays mounted once opened so a run keeps polling while another page is shown.
  const [syncOpened, setSyncOpened] = useState(false);
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
  // iPad preview — stays mounted once opened so its screen survives switching sections.
  const [previewOpened, setPreviewOpened] = useState(false);
  // Object the preview opens on, from a feature's "Preview on iPad"; the key remounts it so it opens there again.
  const [previewStart, setPreviewStart] = useState<string | undefined>(undefined);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewInspect, setPreviewInspect] = useState<PreviewInspect | null>(null);
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

  // Latest request per feature, so an older load that resolves late doesn't overwrite a newer one.
  const readinessRequests = useRef<Record<string, number>>({});
  /** Bumped when the org's configuration changes under the pages (apply, org switch), remounting the Overview. */
  const [configVersion, setConfigVersion] = useState(0);
  const loadReadiness = useCallback(async (id: string, refresh = false) => {
    const ticket = (readinessRequests.current[id] ?? 0) + 1;
    readinessRequests.current[id] = ticket;
    setReadiness((r) => ({ ...r, [id]: { status: "loading" } }));
    const res = await window.lscApi.studioReadiness(id, refresh);
    if (readinessRequests.current[id] !== ticket) return;
    const error = res.error || (res.data as { error?: string } | undefined)?.error;
    setReadiness((r) => ({
      ...r,
      [id]: error ? { status: "error", error } : { status: "ready", readiness: res.data as FeatureReadiness },
    }));
  }, []);

  /** Forget every feature's readiness (and any load still in flight), so pages re-read the org. */
  const resetReadiness = useCallback(() => {
    for (const id of Object.keys(readinessRequests.current)) readinessRequests.current[id] += 1;
    setReadiness({});
    setConfigVersion((v) => v + 1);
  }, []);
  // Another org means other configuration: drop what was read from the old one.
  useEffect(
    () =>
      window.lscApi.onSfOrgChanged(() => {
        setMaps({});
        resetReadiness();
      }),
    [resetReadiness]
  );

  useEffect(() => {
    if (section !== "setup") return;
    if (!maps[featureId]) load(featureId);
    if (!readiness[featureId]) loadReadiness(featureId);
  }, [section, featureId, maps, load, readiness, loadReadiness]);

  const canPreview = PREVIEW_HOSTS.includes(featureId);
  useEffect(() => {
    if (!previewOpened) return;
    for (const id of PREVIEW_FEATURES) if (!maps[id]) load(id);
  }, [previewOpened, maps, load]);
  useEffect(() => {
    if (previewInspect && !maps[previewInspect.featureId]) load(previewInspect.featureId);
  }, [previewInspect, maps, load]);
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
  const inspectBlock = (block: IpadBlock) =>
    setPreviewInspect({ featureId: block.featureId, surface: block.surface, itemId: block.itemId });
  const openPreview = (startOn?: string) => {
    setSection("preview");
    setPreviewOpened(true);
    if (startOn) {
      setPreviewStart(startOn);
      setPreviewKey((k) => k + 1);
    }
  };
  const openSetup = (id: string, surface: SurfaceId | null = null, item: string | null = null) => {
    setSection("setup");
    // Opening a surface or item means the board; otherwise the feature opens on its readiness.
    setFeatureView(surface ? "board" : "readiness");
    setFeatureId(id);
    setSelectedSurface(surface);
    setFocusItem(item);
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

  const publishedProfile = previewOpened && previewMode === "published" ? (lens?.profile ?? null) : null;
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

  // Sync health reads telemetry before any map is loaded; its changes go to the org the MCP server is connected to.
  const [connectedOrg, setConnectedOrg] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!syncOpened || connectedOrg) return;
    window.lscApi.studioConnectedOrg().then((res) => {
      const org = (res.data as { org?: string } | undefined)?.org;
      if (org) setConnectedOrg(org);
    });
  }, [syncOpened, connectedOrg]);

  // Changes are applied against the org Studio last read — from a map, or from readiness checks on the Setup pages.
  const readyOrg =
    map?.org ??
    Object.values(maps).find((m) => m.status === "ready")?.map.org ??
    Object.values(readiness).find((r) => r.status === "ready")?.readiness.org ??
    seenOrg ??
    connectedOrg;
  const previewLoading = PREVIEW_FEATURES.some((id) => maps[id]?.status === "loading");
  const inspectedMap = previewInspect ? readyMap(previewInspect.featureId) : null;
  const inspectedSurface = inspectedMap?.surfaces.find((s) => s.id === previewInspect?.surface) ?? null;
  const inspectedCheckable = !!inspectedMap?.surfaces.some(isScoped);

  const lensPicker = (label: string, title: string, value: string | null, onChange: (profile: string | null) => void) => (
    <label className={`studio-lens-picker${value ? " active" : ""}`} title={title}>
      <span>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{value ? "All configuration" : "Choose…"}</option>
        {lensOptions.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name} {p.users ? `(${p.users})` : "(no active users)"}
          </option>
        ))}
      </select>
    </label>
  );

  const tray = pending.length > 0 && (
    <div className="studio-tray">
      <span className="studio-tray-count">
        {pending.length} pending {pending.length === 1 ? "change" : "changes"}
      </span>
      <span className="studio-tray-list">{pending.map((p) => p.fix.label).join(" · ")}</span>
      <button className="studio-btn" onClick={() => setPending([])}>
        Discard all
      </button>
      <button className="studio-btn primary" onClick={() => setReviewing(true)} disabled={!readyOrg}>
        Review & apply…
      </button>
    </div>
  );

  return (
    <div className="studio">
      <nav className="studio-rail">
        <div className="studio-rail-title">iPad</div>
        <button
          className={`studio-rail-item${section === "preview" ? " active" : ""}`}
          title="What LSC Mobile shows a profile — as last published, or estimated after the next publish"
          onClick={() => openPreview()}
        >
          <span>Preview</span>
        </button>
        <div className="studio-rail-title studio-rail-section">Setup</div>
        <button
          className={`studio-rail-item${section === "overview" ? " active" : ""}`}
          title="Every feature's readiness at a glance, and what blocks them all"
          onClick={() => setSection("overview")}
        >
          <span>Overview</span>
        </button>
        <button
          className={`studio-rail-item${section === "user-check" ? " active" : ""}`}
          title="Why can't a rep do something? Check one user's setup end to end"
          onClick={() => setSection("user-check")}
        >
          <span>Check a user</span>
        </button>
        <button
          className={`studio-rail-item${section === "drift" ? " active" : ""}`}
          title="What changed in the org's LSC configuration since a saved snapshot"
          onClick={() => setSection("drift")}
        >
          <span>What changed</span>
        </button>
        <div className="studio-rail-title studio-rail-section">Features</div>
        {features.map((f) => (
          <button
            key={f.id}
            className={`studio-rail-item${section === "setup" && f.id === featureId ? " active" : ""}`}
            disabled={!f.available}
            title={f.description}
            onClick={() => openSetup(f.id)}
          >
            <span>{f.title}</span>
            {!f.available && <span className="studio-soon">Soon</span>}
          </button>
        ))}
        <div className="studio-rail-title studio-rail-section">Testing</div>
        <button
          className={`studio-rail-item${section === "sync" ? " active" : ""}`}
          title="How reps' iPads are syncing, who is struggling and why, and go-live sign-off"
          onClick={() => {
            setSection("sync");
            setSyncOpened(true);
          }}
        >
          <span>Sync health</span>
        </button>
      </nav>

      {previewOpened && (
        <section className="studio-main" hidden={section !== "preview"}>
          <header className="studio-header">
            <div>
              <h1 className="studio-title">iPad preview</h1>
              <div className="studio-subtitle">
                {previewMode === "published"
                  ? lens
                    ? `The iPad exactly as ${lens.profile}'s users last downloaded it, from the profile's metadata cache.`
                    : "The iPad exactly as a profile's users last downloaded it, from the profile's metadata cache."
                  : `An estimate of the iPad after the next publish, built from the live configuration${
                      lens ? ` for ${lens.profile}` : ""
                    } — permission sets and record sharing aren't evaluated.`}
              </div>
            </div>
            <div className="studio-header-actions">
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
              {lensPicker(
                lens ? "Previewing as" : "Preview as",
                "The profile whose iPad to show",
                lens?.profile ?? null,
                (profile) => setLens(profile ? { profile } : null)
              )}
              {readyOrg && (
                <button className="studio-btn" onClick={() => setPublishing(null)} title="Regenerate the mobile metadata cache">
                  Publish to iPad
                </button>
              )}
              {previewMode === "estimate" && (
                <button
                  className="studio-btn"
                  onClick={() => {
                    for (const id of PREVIEW_FEATURES) load(id, true);
                    if (maps.visit) load("visit", true);
                  }}
                  disabled={previewLoading}
                >
                  {previewLoading ? "Mapping…" : "Refresh"}
                </button>
              )}
            </div>
          </header>

          <div className="studio-stage">
            <div className="studio-canvas">
              {previewMode === "published" ? (
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
              ) : (
                <IpadPreview
                  key={previewKey}
                  actionsMap={readyMap("actions-home")}
                  syncMap={readyMap("mobile-sync")}
                  visitMap={readyMap("visit")}
                  onLoadVisit={loadVisit}
                  visitError={maps.visit?.status === "error" ? maps.visit.error : undefined}
                  lens={lens}
                  pending={pending}
                  onSelect={inspectBlock}
                  selectedItem={previewInspect?.itemId ?? null}
                  startOn={previewStart}
                />
              )}
            </div>
            {previewMode === "estimate" && inspectedMap && inspectedSurface && previewInspect && (
              <Inspector
                key={`${previewInspect.featureId}:${previewInspect.surface}:${previewInspect.itemId}`}
                map={inspectedMap}
                surface={inspectedSurface}
                lens={inspectedCheckable ? lens : null}
                onClose={() => setPreviewInspect(null)}
                onOpenInSetup={() => openSetup(previewInspect.featureId, previewInspect.surface, previewInspect.itemId)}
                onCheckProfile={
                  inspectedCheckable
                    ? (profile) => {
                        setLens({ profile });
                        openSetup(previewInspect.featureId);
                      }
                    : undefined
                }
                onAskClaude={onAskClaude}
                profiles={profiles}
                pending={pending}
                onPendingChange={setPending}
                focusItem={previewInspect.itemId}
              />
            )}
          </div>

          {tray}
        </section>
      )}

      {syncOpened && (
        <section className="studio-main" hidden={section !== "sync"}>
          <SyncHealthView
            onAskClaude={onAskClaude}
            onOpenSetup={(id, surface = null, item = null) => openSetup(id, surface, item)}
            pending={pending}
            onPendingChange={setPending}
          />
          {tray}
        </section>
      )}

      {section === "overview" && (
        <section className="studio-main">
          <div className="studio-scroll">
            <SetupOverview
              key={configVersion}
              features={features}
              readiness={readiness}
              loadReadiness={loadReadiness}
              onOpenFeature={(id) => openSetup(id)}
              onCheckUser={() => {
                setTraceFeature(undefined);
                setSection("user-check");
              }}
              onPublish={(preselect) => setPublishing(preselect)}
              profiles={profiles}
              pending={pending}
              onPendingChange={setPending}
              onAskClaude={onAskClaude}
            />
          </div>
          {tray}
        </section>
      )}

      {section === "user-check" && (
        <section className="studio-main">
          <div className="studio-scroll">
            <UserTraceView
              features={features}
              initialFeatureId={traceFeature}
              profiles={profiles}
              pending={pending}
              onPendingChange={setPending}
              onAskClaude={onAskClaude}
              onOpenFeature={(id) => openSetup(id)}
              onPublish={(preselect) => setPublishing(preselect)}
              onOrgSeen={setSeenOrg}
            />
          </div>
          {tray}
        </section>
      )}

      {section === "drift" && (
        <section className="studio-main">
          <DriftView onAskClaude={onAskClaude} onOpenFeature={(id) => openSetup(id)} />
        </section>
      )}

      <section className="studio-main" hidden={section !== "setup"}>
        <header className="studio-header">
          <div>
            <h1 className="studio-title">{feature?.title ?? "Studio"}</h1>
            {map && (
              <div className="studio-subtitle">
                {map.summary} · {map.org} · mapped {new Date(map.collectedAt).toLocaleString()}
                {activeLens && (
                  <span className="studio-lens-note">
                    {" "}
                    · checking {activeLens.profile} — permission sets and record sharing aren't evaluated
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="studio-header-actions">
            {!activeLens && (
              <div className="studio-view-tabs" role="group" aria-label="View">
                <button
                  type="button"
                  aria-pressed={featureView === "readiness"}
                  onClick={() => {
                    setFeatureView("readiness");
                    selectSurface(null);
                  }}
                >
                  Readiness
                </button>
                <button
                  type="button"
                  aria-pressed={featureView === "board"}
                  onClick={() => setFeatureView("board")}
                >
                  All configuration
                </button>
              </div>
            )}
            {!activeLens && featureView === "readiness" && (
              <button
                className="studio-btn"
                onClick={() => {
                  setTraceFeature(featureId);
                  setSection("user-check");
                }}
                title="Check one rep's setup for this feature"
              >
                Check a user…
              </button>
            )}
            {map && featureView === "board" && (
              <SeverityChips
                counts={countBySeverity(mapFindings(map, activeLens))}
                emptyLabel="No issues found"
              />
            )}
            {checkable &&
              lensPicker(
                activeLens ? "Checking" : "Check a profile",
                "Check what one profile gets from this feature, and what's missing",
                activeLens?.profile ?? null,
                checkProfile
              )}
            {map && canPreview && (
              <button
                className="studio-btn"
                onClick={() => openPreview(featureId === "visit" ? "Visit" : undefined)}
                title="A block render of what LSC Mobile shows — tabs, home page, and record actions"
              >
                Preview on iPad
              </button>
            )}
            {map && (
              <button className="studio-btn" onClick={() => setPublishing(null)} title="Regenerate the mobile metadata cache">
                Publish to iPad
              </button>
            )}
            <button
              className="studio-btn"
              onClick={() => {
                load(featureId, true);
                loadReadiness(featureId, true);
              }}
              disabled={state?.status === "loading" || readiness[featureId]?.status === "loading"}
            >
              {state?.status === "loading" || readiness[featureId]?.status === "loading" ? "Checking…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className="studio-stage">
          {!activeLens && featureView === "readiness" && (
            <div className="studio-canvas studio-scroll">
              <ReadinessView
                title={feature?.title ?? featureId}
                state={readiness[featureId]}
                objects={map?.objects ?? []}
                profiles={profiles}
                pending={pending}
                onPendingChange={setPending}
                onShowSurface={(id) => {
                  setFeatureView("board");
                  selectSurface(id);
                }}
                onAskClaude={onAskClaude}
                onRetry={() => loadReadiness(featureId, true)}
              />
            </div>
          )}
          {(activeLens || featureView === "board") && (!state || state.status === "loading") && (
            <div className="studio-placeholder">
              <div className="studio-spinner" />
              <div>Mapping {feature?.title ?? "feature"} configuration…</div>
              <div className="studio-placeholder-sub">
                Reading objects, scripts, rules, triggers, mobile sync, actions, and settings from your org.
              </div>
            </div>
          )}
          {(activeLens || featureView === "board") && state?.status === "error" && (
            <div className="studio-placeholder">
              <div className="studio-placeholder-error">Couldn't map this feature</div>
              <div className="studio-placeholder-sub">{state.error}</div>
              <button className="studio-btn" onClick={() => load(featureId, true)}>
                Try again
              </button>
            </div>
          )}
          {map && (activeLens || featureView === "board") && (
            <div className="studio-canvas">
              {activeLens ? (
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
          {map && surface && (activeLens || featureView === "board") && (
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
        </div>

        {tray}
      </section>

      {readyOrg && reviewing && (
        <ReviewDialog
          changes={pending}
          org={readyOrg}
          onClose={(applied, remaining) => {
            setReviewing(false);
            setPending(remaining);
            // Other features' maps may be stale too; the main process dropped them from its cache.
            if (applied.length > 0) {
              setMaps({});
              resetReadiness();
              load(featureId, true);
              if (previewOpened) for (const id of PREVIEW_FEATURES) if (id !== featureId) load(id, true);
            }
          }}
          onPublish={(preselect) => setPublishing(preselect)}
        />
      )}
      {readyOrg && publishing !== undefined && (
        <PublishDialog
          org={readyOrg}
          profiles={profiles}
          preselected={publishing}
          onClose={() => setPublishing(undefined)}
        />
      )}
    </div>
  );
}
