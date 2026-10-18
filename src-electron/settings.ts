import fs from "fs";
import path from "path";
import { app } from "electron";
import { Connection, LegacyLlmSettings, migrateLegacyConnection } from "./llm/connection.js";

export interface Settings {
  /** How the app reaches a model; its key or token is in the keychain (secrets.ts). */
  connection?: Connection;
  model?: string;
  theme?: "light" | "dark" | "system";
  sfTargetOrg?: string;
  // LSC mobile app connected-app consumer key, for First sync mobile login
  mobileClientId?: string;
}

const DEFAULT_SETTINGS: Settings = {
  model: "claude-sonnet-5",
  theme: "system",
};

/** Fields from before connections, holding secrets in plain text — moved out by migrateSettings. */
const LEGACY_FIELDS = ["providerType", "apiKey", "baseUrl", "authToken", "gatewayUrl", "gatewayToken"] as const;

function getSettingsPath(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "settings.json");
}

function readRaw(): Record<string, unknown> {
  try {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

export function loadSettings(): Settings {
  const raw = readRaw();
  for (const field of LEGACY_FIELDS) delete raw[field];
  return { ...DEFAULT_SETTINGS, ...raw } as Settings;
}

export function saveSettings(settings: Settings): void {
  const filePath = getSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}

/**
 * One-time move from the old provider fields to a connection, with the plain-text
 * key handed to `storeSecret` (the keychain) and removed from settings.json.
 */
export function migrateSettings(storeSecret: (connection: Connection, secret: string) => void): void {
  const raw = readRaw();
  if (!LEGACY_FIELDS.some((field) => field in raw)) return;
  const migrated = raw.connection ? null : migrateLegacyConnection(raw as LegacyLlmSettings);
  if (migrated?.secret) storeSecret(migrated.connection, migrated.secret);
  for (const field of LEGACY_FIELDS) delete raw[field];
  if (migrated) raw.connection = migrated.connection;
  saveSettings(raw as Settings);
}
