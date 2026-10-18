import React, { useState, useEffect, useCallback } from "react";
import { Monitor, Moon, Sun, X, type LucideIcon } from "lucide-react";
import Segmented from "./ui/Segmented";
import { pickModel, type ModelOption } from "../models";
import { ROZ_ICONS, rozIcon, rozTileSrc, setAppIcon, type RozIcon } from "../app-icon";
import { APP_THEMES, appTheme, type AppTheme } from "../theme";
import { useOrgs } from "../hooks/useOrgs";
import { hostOf, KIND_LABEL, orgKey } from "../orgs";

const THEME_ICONS: Record<AppTheme, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

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
  const [theme, setTheme] = useState<AppTheme>("system");
  const [savedTheme, setSavedTheme] = useState<AppTheme>("system");

  const { current, chosen, loading: orgsLoading } = useOrgs();

  useEffect(() => {
    window.lscApi.getSettings().then((s) => {
      setModel(pickModel(s.model, modelOptions));
      setMobileClientId(s.mobileClientId || "");
      setAppIconChoice(rozIcon(s.appIcon));
      setTheme(appTheme(s.theme));
      setSavedTheme(appTheme(s.theme));
    });
  }, [modelOptions]);

  // A picked appearance shows at once; closing without saving puts the saved one back.
  const pickTheme = (value: AppTheme) => {
    setTheme(value);
    window.lscApi.previewTheme(value);
  };

  const handleCancel = useCallback(() => {
    if (theme !== savedTheme) window.lscApi.previewTheme(savedTheme);
    onClose();
  }, [theme, savedTheme, onClose]);

  const handleSave = async () => {
    // settings:save replaces the whole file, so merge into the current settings.
    const saved = await window.lscApi.getSettings();
    await window.lscApi.saveSettings({
      ...saved,
      model,
      mobileClientId: mobileClientId.trim() || undefined,
      appIcon,
      theme,
    });
    setAppIcon(appIcon);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleCancel]);

  return (
    <div className="settings-overlay" onClick={handleCancel}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button className="ui-icon-btn" onClick={handleCancel} title="Close (Esc)" aria-label="Close settings">
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
              Salesforce org
            </label>
            <input
              id="settings-org"
              className="ui-field"
              type="text"
              readOnly
              value={
                current
                  ? `${orgKey(current)} · ${KIND_LABEL[current.kind]} · ${hostOf(current.instanceUrl)}`
                  : chosen || (orgsLoading ? "Loading…" : "None")
              }
            />
            <div className="settings-hint">
              Switch orgs or log in to another from the menu at the top of the sidebar. Each session stays in the org it started in.
            </div>
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
            <div className="ui-label">Appearance</div>
            <Segmented
              aria-label="Appearance"
              value={theme}
              onChange={pickTheme}
              options={APP_THEMES.map((t) => ({ value: t.id, label: t.label, icon: THEME_ICONS[t.id] }))}
            />
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
          <button className="studio-btn lg" onClick={handleCancel}>
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
