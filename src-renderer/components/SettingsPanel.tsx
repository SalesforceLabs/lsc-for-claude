import React, { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import Spinner from "./ui/Spinner";
import Segmented from "./ui/Segmented";
import { pickModel, type ModelOption } from "../models";
import { ROZ_ICONS, rozIcon, rozTileSrc, setAppIcon, type RozIcon } from "../app-icon";

interface SfOrg {
  alias?: string;
  username: string;
  orgId: string;
  instanceUrl: string;
  isDefault?: boolean;
}

interface SettingsPanelProps {
  /** How the running engine reaches the model, e.g. "OpenAI API key". */
  connectedVia?: string;
  /** The models the connection offers (see modelOptionsFor). */
  modelOptions: ModelOption[];
  onClose: () => void;
  /** Back to the setup screen; the saved connection stays until a new one connects. */
  onChangeConnection: () => void;
}

export default function SettingsPanel({
  connectedVia,
  modelOptions,
  onClose,
  onChangeConnection,
}: SettingsPanelProps) {
  const [model, setModel] = useState("");
  const [mobileClientId, setMobileClientId] = useState("");
  const [appIcon, setAppIconChoice] = useState<RozIcon>(ROZ_ICONS[0].id);

  // Org state
  const [orgs, setOrgs] = useState<SfOrg[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgsError, setOrgsError] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [loginAlias, setLoginAlias] = useState("");
  const [isSandbox, setIsSandbox] = useState(false);
  const [loginStarted, setLoginStarted] = useState(false);

  const fetchOrgs = useCallback(async () => {
    setOrgsLoading(true);
    setOrgsError("");
    try {
      const result = await window.lscApi.listSfOrgs();
      setOrgs(result.orgs || []);
      if (result.error) setOrgsError(result.error);
    } catch {
      setOrgsError("Failed to list orgs");
    } finally {
      setOrgsLoading(false);
    }
  }, []);

  useEffect(() => {
    window.lscApi.getSettings().then((s) => {
      setModel(pickModel(s.model, modelOptions));
      if (s.sfTargetOrg) setSelectedOrg(s.sfTargetOrg);
      setMobileClientId(s.mobileClientId || "");
      setAppIconChoice(rozIcon(s.appIcon));
    });
    fetchOrgs();
  }, [fetchOrgs, modelOptions]);

  const handleOrgChange = async (value: string) => {
    setSelectedOrg(value);
    if (value) {
      await window.lscApi.setSfOrg(value);
    }
  };

  const handleLogin = async () => {
    const instanceUrl = isSandbox ? "https://test.salesforce.com" : undefined;
    await window.lscApi.loginSfOrg(loginAlias || undefined, instanceUrl);
    setLoginStarted(true);
  };

  const handleSave = async () => {
    // settings:save replaces the whole file, so merge into the current settings.
    const current = await window.lscApi.getSettings();
    await window.lscApi.saveSettings({
      ...current,
      model,
      mobileClientId: mobileClientId.trim() || undefined,
      appIcon,
    });
    setAppIcon(appIcon);
    onClose();
  };

  const orgLabel = (o: SfOrg) => o.alias ? `${o.alias} (${o.username})` : o.username;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button className="ui-icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close settings">
            <X size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-group">
            <label className="ui-label" htmlFor="settings-connected">
              Connected via
            </label>
            <div className="settings-row">
              <input id="settings-connected" className="ui-field" type="text" value={connectedVia || "Not connected"} readOnly />
              <button className="studio-btn" onClick={onChangeConnection}>
                Change…
              </button>
            </div>
          </section>

          <section className="settings-group">
            <label className="ui-label" htmlFor="settings-org">
              <span className="settings-label-row">
                <span className={`settings-dot ${selectedOrg ? "on" : ""}`} aria-hidden="true" />
                Salesforce org
              </span>
            </label>
            <div className="settings-row">
              <select
                id="settings-org"
                className="ui-field"
                value={selectedOrg}
                onChange={(e) => handleOrgChange(e.target.value)}
                disabled={orgsLoading}
              >
                <option value="">
                  {orgsLoading ? "Loading…" : orgs.length === 0 ? "No orgs found" : "Select an org…"}
                </option>
                {orgs.map((o) => (
                  <option key={o.username} value={o.alias || o.username}>
                    {orgLabel(o)}
                  </option>
                ))}
              </select>
              <button
                className="ui-icon-btn bordered"
                onClick={fetchOrgs}
                disabled={orgsLoading}
                title="Refresh org list"
                aria-label="Refresh org list"
              >
                {orgsLoading ? <Spinner size={14} /> : <RefreshCw size={14} strokeWidth={1.9} aria-hidden="true" />}
              </button>
            </div>
            {orgsError && (
              <div className="settings-note error" role="alert">
                <TriangleAlert size={14} strokeWidth={1.9} aria-hidden="true" />
                <span>{orgsError}</span>
              </div>
            )}

            <button
              type="button"
              className="studio-btn ghost sm settings-connect-toggle"
              onClick={() => { setShowLogin(!showLogin); setLoginStarted(false); }}
              aria-expanded={showLogin}
            >
              {showLogin ? <X size={14} strokeWidth={1.9} aria-hidden="true" /> : <Plus size={14} strokeWidth={1.9} aria-hidden="true" />}
              {showLogin ? "Cancel" : "Connect new org"}
            </button>
            {showLogin && (
              <div className="settings-login ui-enter">
                <input
                  className="ui-field"
                  type="text"
                  placeholder="Alias (optional)"
                  aria-label="Alias"
                  value={loginAlias}
                  onChange={(e) => setLoginAlias(e.target.value)}
                  spellCheck={false}
                />
                <Segmented
                  aria-label="Org type"
                  value={isSandbox ? "sandbox" : "production"}
                  onChange={(v) => setIsSandbox(v === "sandbox")}
                  options={[
                    { value: "production", label: "Production" },
                    { value: "sandbox", label: "Sandbox" },
                  ]}
                />
                <button className="btn-primary" onClick={handleLogin} disabled={loginStarted}>
                  {loginStarted && <Spinner size={13} />}
                  {loginStarted ? "Waiting for browser login…" : "Log in"}
                </button>
                {loginStarted && (
                  <div className="settings-hint">Complete the login in your browser, then refresh the list above.</div>
                )}
              </div>
            )}
          </section>

          <section className="settings-group">
            <label className="ui-label" htmlFor="settings-model">
              Default model
            </label>
            <select id="settings-model" className="ui-field" value={model} onChange={(e) => setModel(e.target.value)}>
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </section>

          <section className="settings-group">
            <div className="ui-label" id="app-icon-label">App icon</div>
            <div className="app-icon-picker" role="radiogroup" aria-labelledby="app-icon-label">
              {ROZ_ICONS.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  role="radio"
                  aria-checked={appIcon === icon.id}
                  className={`app-icon-option ${appIcon === icon.id ? "active" : ""}`}
                  onClick={() => setAppIconChoice(icon.id)}
                >
                  <img src={rozTileSrc(icon.id)} alt="" />
                  <span>{icon.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <label className="ui-label" htmlFor="settings-consumer-key">
              LSC mobile app consumer key
            </label>
            <input
              id="settings-consumer-key"
              className="ui-field"
              type="text"
              value={mobileClientId}
              onChange={(e) => setMobileClientId(e.target.value)}
              placeholder="Optional"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="settings-hint">
              The remoteAccessConsumerKey from the LSC iOS app's bootconfig.plist. Needed for First sync's “Log in as
              mobile user”.
            </div>
          </section>
        </div>

        <div className="settings-footer">
          <button className="studio-btn lg" onClick={onClose}>
            Cancel
          </button>
          <button className="studio-btn primary lg" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
