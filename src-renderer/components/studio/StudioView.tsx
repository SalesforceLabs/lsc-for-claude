import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureMap, FeatureReadiness, FeatureSummary, ProfileOption, SurfaceId } from "./types";
import { countBySeverity, mapFindings } from "./findings";
import { audienceProfiles, isScoped, type Lens } from "./lens";
import { SeverityChips } from "./SeverityChips";
import FeatureGrid from "./FeatureGrid";
import LensChecklist from "./LensChecklist";
import PublishedIpadPreview, { type PublishedState } from "./PublishedIpadPreview";
import { usePreviewEdit } from "./usePreviewEdit";
import type { PublishedResult } from "./published-types";
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
import {
  Activity,
  CloudUpload,
  History,
  LayoutDashboard,
  Pencil,
  RefreshCw,
  Tablet,
  UserRound,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";
import Segmented from "../ui/Segmented";
import StateView from "../ui/StateView";
import Spinner from "../ui/Spinner";
import "./studio.css";

interface StudioViewProps {
  onAskClaude: (prompt: string) => void;
}

/** Features the iPad preview's edit mode reads (tabs, Home actions, DB Schema), loaded when it opens. */
const PREVIEW_FEATURES = ["actions-home", "mobile-sync"];
/** Features whose page offers a "Preview on iPad" shortcut. */
const PREVIEW_HOSTS = [...PREVIEW_FEATURES, "visit"];

type MapState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; map: FeatureMap };

/** What the main pane shows: the iPad preview, a Setup page or feature, or a Testing page. */
type Section = "preview" | "overview" | "user-check" | "drift" | "setup" | "sync";

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
  // "published" reads the profile's last metadata cache; "draft" lays the tray over it.
  const [previewMode, setPreviewMode] = useState<"published" | "draft">("published");
  // Edit mode: select blocks in the published preview to see what they are and change them.
  const [editOn, setEditOn] = useState(false);
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
  const loadPublished = useCallback(async (profile: string, refresh = false, userId?: string) => {
    setPublished((p) => ({ ...p, [profile]: { status: "loading" } }));
    const res = await window.lscApi.studioIpadPublished(profile, refresh, userId);
    const error = res.error || (res.data as { error?: string } | undefined)?.error;
    setPublished((p) => ({
      ...p,
      [profile]: error ? { status: "error", error } : { status: "ready", result: res.data as PublishedResult },
    }));
  }, []);
  const readyMap = (id: string) => {
    const m = maps[id];
    return m?.status === "ready" ? m.map : null;
  };
  const openPreview = () => {
    setSection("preview");
    setPreviewOpened(true);
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

  const publishedProfile = previewOpened ? (lens?.profile ?? null) : null;
  const toggleEdit = useCallback(() => {
    setEditOn((on) => {
      // Edits are made in Draft; Published stays selectable to explain what reps have today.
      if (!on) setPreviewMode("draft");
      return !on;
    });
  }, []);
  const previewShown = section === "preview" && !!publishedProfile;
  useEffect(() => {
    if (!previewShown) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (e.key !== "e" || e.metaKey || e.ctrlKey || e.altKey || reviewing || publishing !== undefined) return;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      toggleEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewShown, toggleEdit, reviewing, publishing]);
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
  const publishedState = publishedProfile ? published[publishedProfile] : undefined;
  const { edit: previewEdit, panel: editPanel } = usePreviewEdit({
    on: editOn && previewShown,
    draft: previewMode === "draft",
    profile: publishedProfile,
    result: publishedState?.status === "ready" ? publishedState.result : undefined,
    actionsMap: readyMap("actions-home"),
    syncMap: readyMap("mobile-sync"),
    pending,
    onPendingChange: setPending,
    org: readyOrg,
    profiles,
    onOpenStudio: (id, surface, item) => openSetup(id, surface, item),
  });

  const previewSubtitle =
    previewMode === "published"
      ? `Exactly as ${lens ? `${lens.profile}'s` : "a profile's"} users last downloaded it, from the profile's metadata cache`
      : `As published, with ${pending.length === 1 ? "the pending change" : `${pending.length || "no"} pending changes`} laid on top — tabs, Home actions, DB Schema and page layouts`;

  const featureBusy = state?.status === "loading" || readiness[featureId]?.status === "loading";
  const featureSubtitle = map
    ? `${map.summary} · ${map.org} · mapped ${new Date(map.collectedAt).toLocaleString()}${
        activeLens ? ` · checking ${activeLens.profile} — permission sets and record sharing aren't evaluated` : ""
      }`
    : undefined;

  const lensPicker = (label: string, title: string, value: string | null, onChange: (profile: string | null) => void) => (
    <label className={`studio-lens-picker${value ? " active" : ""}`} title={title}>
      <UserRound size={14} strokeWidth={2} aria-hidden="true" />
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

  const railItem = (id: Section, label: string, title: string, onClick: () => void, Icon: LucideIcon) => (
    <button
      className={`studio-rail-item${section === id ? " active" : ""}`}
      aria-current={section === id ? "page" : undefined}
      title={title}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="studio-rail-label">{label}</span>
    </button>
  );

  const publishButton = (
    <button
      className="studio-btn collapsible"
      onClick={() => setPublishing(null)}
      title="Publish to iPad — regenerate the mobile metadata cache"
    >
      <CloudUpload aria-hidden="true" />
      <span className="studio-btn-label">Publish to iPad</span>
    </button>
  );

  const refreshButton = (busy: boolean, onClick: () => void, title: string) => (
    <button className="ui-icon-btn" onClick={onClick} disabled={busy} title={title} aria-label={title}>
      {busy ? <Spinner size={14} /> : <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />}
    </button>
  );

  const tray = pending.length > 0 && (
    <div className="studio-tray">
      <span className="studio-tray-count">
        <span className="studio-tray-badge">{pending.length}</span>
        pending {pending.length === 1 ? "change" : "changes"}
      </span>
      <span className="studio-tray-list">{pending.map((p) => p.fix.label).join(" · ")}</span>
      <button className="studio-btn ghost" onClick={() => setPending([])}>
        Discard all
      </button>
      <button className="studio-btn primary" onClick={() => setReviewing(true)} disabled={!readyOrg}>
        Review & apply…
      </button>
    </div>
  );

  return (
    <div className="studio">
      <nav className="studio-rail" aria-label="Studio">
        <div className="studio-rail-head">Studio</div>
        <div className="studio-rail-title">iPad</div>
        {railItem(
          "preview",
          "Preview",
          "What LSC Mobile shows a profile — as last published, or with pending changes laid on top",
          () => openPreview(),
          Tablet
        )}
        <div className="studio-rail-title studio-rail-section">Setup</div>
        {railItem("overview", "Overview", "Every feature's readiness at a glance, and what blocks them all", () => setSection("overview"), LayoutDashboard)}
        {railItem(
          "user-check",
          "Check a user",
          "Why can't a rep do something? Check one user's setup end to end",
          () => setSection("user-check"),
          UserRoundSearch
        )}
        {railItem(
          "drift",
          "What changed",
          "What changed in the org's LSC configuration since a saved snapshot",
          () => setSection("drift"),
          History
        )}
        <div className="studio-rail-title studio-rail-section">Testing</div>
        {railItem(
          "sync",
          "Sync health",
          "How reps' iPads are syncing, who is struggling and why, and go-live sign-off",
          () => {
            setSection("sync");
            setSyncOpened(true);
          },
          Activity
        )}
        <div className="studio-rail-title studio-rail-section">Features</div>
        {features.map((f) => (
          <button
            key={f.id}
            className={`studio-rail-item${section === "setup" && f.id === featureId ? " active" : ""}`}
            aria-current={section === "setup" && f.id === featureId ? "page" : undefined}
            disabled={!f.available}
            title={`${f.title} — ${f.description}`}
            onClick={() => openSetup(f.id)}
          >
            <span className="studio-rail-label">{f.title}</span>
            {!f.available && <span className="studio-soon">Soon</span>}
          </button>
        ))}
      </nav>

      {previewOpened && (
        <section className="studio-main ui-enter" hidden={section !== "preview"}>
          <header className="studio-header">
            <div className="studio-heading">
              <h1 className="studio-title">iPad preview</h1>
              <div className="studio-subtitle" title={previewSubtitle}>
                {previewSubtitle}
              </div>
            </div>
            <div className="studio-header-actions">
              {publishedProfile && (
                <button
                  className={`studio-btn collapsible${editOn ? " active" : ""}`}
                  aria-pressed={editOn}
                  onClick={toggleEdit}
                  title="Edit — select anything on the iPad to see where it comes from and change it (E)"
                >
                  <Pencil aria-hidden="true" />
                  <span className="studio-btn-label">Edit</span>
                </button>
              )}
              {readyOrg && publishButton}
            </div>
          </header>
          <div className="studio-subbar">
            <Segmented
              aria-label="Preview mode"
              value={previewMode}
              onChange={setPreviewMode}
              options={[
                { value: "published", label: "Published", title: "What reps have today, from the metadata cache" },
                { value: "draft", label: "Draft", title: "Published, with the pending changes laid on top" },
              ]}
            />
            <div className="studio-subbar-group">
              {lensPicker(
                lens ? "Previewing as" : "Preview as",
                "The profile whose iPad to show",
                lens?.profile ?? null,
                (profile) => setLens(profile ? { profile } : null)
              )}
            </div>
          </div>

          <div className="studio-stage">
            <div className="studio-canvas">
              {publishedProfile ? (
                <PublishedIpadPreview
                  profile={publishedProfile}
                  state={publishedState}
                  onRefresh={(userId) => loadPublished(publishedProfile, true, userId)}
                  onPickUser={(userId) => loadPublished(publishedProfile, false, userId)}
                  edit={previewEdit}
                />
              ) : (
                <StateView
                  kind="empty"
                  icon={Tablet}
                  title="Choose a profile"
                  detail="Pick one in “Preview as” to see the iPad exactly as that profile's users last downloaded it."
                />
              )}
            </div>
            {editPanel}
          </div>

          {tray}
        </section>
      )}

      {syncOpened && (
        <section className="studio-main ui-enter" hidden={section !== "sync"}>
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
        <section className="studio-main ui-enter">
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
        <section className="studio-main ui-enter">
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
        <section className="studio-main ui-enter">
          <DriftView onAskClaude={onAskClaude} onOpenFeature={(id) => openSetup(id)} />
        </section>
      )}

      <section className="studio-main ui-enter" hidden={section !== "setup"}>
        <header className="studio-header">
          <div className="studio-heading">
            <h1 className="studio-title">{feature?.title ?? "Studio"}</h1>
            {map && (
              <div className="studio-subtitle" title={featureSubtitle}>
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
            {map && canPreview && (
              <button
                className="studio-btn collapsible"
                onClick={() => openPreview()}
                title="Preview on iPad — what LSC Mobile shows a profile, as last published or with pending changes in Draft"
              >
                <Tablet aria-hidden="true" />
                <span className="studio-btn-label">Preview on iPad</span>
              </button>
            )}
            {map && publishButton}
            {refreshButton(
              featureBusy,
              () => {
                load(featureId, true);
                loadReadiness(featureId, true);
              },
              featureBusy ? "Checking…" : "Refresh"
            )}
          </div>
        </header>
        <div className="studio-subbar">
          <div className="studio-subbar-group">
            {!activeLens && (
              <Segmented
                aria-label="View"
                value={featureView}
                onChange={(view) => {
                  setFeatureView(view);
                  if (view === "readiness") selectSurface(null);
                }}
                options={[
                  { value: "readiness", label: "Readiness" },
                  { value: "board", label: "All configuration" },
                ]}
              />
            )}
            {map && featureView === "board" && (
              <SeverityChips counts={countBySeverity(mapFindings(map, activeLens))} emptyLabel="No issues found" />
            )}
          </div>
          <div className="studio-subbar-group">
            {!activeLens && featureView === "readiness" && (
              <button
                className="studio-btn"
                onClick={() => {
                  setTraceFeature(featureId);
                  setSection("user-check");
                }}
                title="Check one rep's setup for this feature"
              >
                <UserRoundSearch aria-hidden="true" />
                Check a user…
              </button>
            )}
            {checkable &&
              lensPicker(
                activeLens ? "Checking" : "Check a profile",
                "Check what one profile gets from this feature, and what's missing",
                activeLens?.profile ?? null,
                checkProfile
              )}
          </div>
        </div>

        <div className="studio-stage">
          {!activeLens && featureView === "readiness" && (
            <div key={`readiness:${featureId}`} className="studio-canvas studio-scroll ui-enter">
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
            <StateView
              kind="loading"
              title={`Mapping ${feature?.title ?? "feature"} configuration…`}
              detail="Reading objects, scripts, rules, triggers, mobile sync, actions, and settings from your org."
            />
          )}
          {(activeLens || featureView === "board") && state?.status === "error" && (
            <StateView
              kind="error"
              title="Couldn't map this feature"
              detail={state.error}
              actions={
                <button className="studio-btn" onClick={() => load(featureId, true)}>
                  Try again
                </button>
              }
            />
          )}
          {map && (activeLens || featureView === "board") && (
            <div key={`board:${featureId}:${activeLens ? "lens" : "all"}`} className="studio-canvas ui-enter">
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
