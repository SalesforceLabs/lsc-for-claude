import React, { useState, useEffect, useCallback } from "react";
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

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="form-group">
          <label>Connected via</label>
          <div className="form-row">
            <input
              type="text"
              value={connectedVia || "Not connected"}
              readOnly
              style={{ opacity: 0.7, flex: 1 }}
            />
            <button className="btn-secondary" onClick={onChangeConnection}>
              Change…
            </button>
          </div>
        </div>

        {/* Salesforce Org Section */}
        <div className="form-group org-section">
          <label>
            <span
              className="status-dot"
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                marginRight: 6,
                background: selectedOrg ? "var(--success)" : "var(--text-muted)",
                boxShadow: selectedOrg ? "0 0 6px rgba(52, 211, 153, 0.4)" : "none",
              }}
            />
            Salesforce Org
          </label>
          <div className="org-row">
            <select
              value={selectedOrg}
              onChange={(e) => handleOrgChange(e.target.value)}
              disabled={orgsLoading}
              style={{ flex: 1 }}
            >
              <option value="">
                {orgsLoading ? "Loading..." : orgs.length === 0 ? "No orgs found" : "Select an org..."}
              </option>
              {orgs.map((o) => (
                <option key={o.username} value={o.alias || o.username}>
                  {orgLabel(o)}
                </option>
              ))}
            </select>
            <button
              className="org-refresh-btn"
              onClick={fetchOrgs}
              disabled={orgsLoading}
              title="Refresh org list"
            >
              {orgsLoading ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 4v6h6" /><path d="M23 20v-6h-6" />
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                </svg>
              )}
            </button>
          </div>
          {orgsError && <div className="org-error">{orgsError}</div>}

          {/* Connect New Org */}
          <button
            className="org-connect-toggle"
            onClick={() => { setShowLogin(!showLogin); setLoginStarted(false); }}
          >
            {showLogin ? "Cancel" : "Connect New Org"}
          </button>
          {showLogin && (
            <div className="org-login-form">
              <input
                type="text"
                placeholder="Alias (optional)"
                value={loginAlias}
                onChange={(e) => setLoginAlias(e.target.value)}
              />
              <div className="org-toggle">
                <button
                  className={`org-toggle-btn ${!isSandbox ? "active" : ""}`}
                  onClick={() => setIsSandbox(false)}
                >
                  Production
                </button>
                <button
                  className={`org-toggle-btn ${isSandbox ? "active" : ""}`}
                  onClick={() => setIsSandbox(true)}
                >
                  Sandbox
                </button>
              </div>
              <button
                className="btn-primary"
                onClick={handleLogin}
                disabled={loginStarted}
                style={{ width: "100%" }}
              >
                {loginStarted ? "Waiting for browser login..." : "Login"}
              </button>
              {loginStarted && (
                <div className="org-login-hint">
                  Complete login in your browser, then click Refresh above.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="form-group">
          <label>Default model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {modelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label id="app-icon-label">App icon</label>
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
        </div>

        <div className="form-group">
          <label>LSC mobile app consumer key</label>
          <input
            type="text"
            value={mobileClientId}
            onChange={(e) => setMobileClientId(e.target.value)}
            placeholder="Optional"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="org-login-hint">
            The remoteAccessConsumerKey from the LSC iOS app's bootconfig.plist.
            Needed for First sync's "Log in as mobile user".
          </div>
        </div>

        <div className="form-actions">
          <button className="btn-secondary" onClick={onClose} style={{ marginLeft: "auto" }}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
