import fs from "fs";
import path from "path";
import { app } from "electron";

export interface Settings {
  providerType: "api-key" | "bedrock-gateway" | "sf-gateway" | "";
  apiKey?: string;
  // Bedrock / custom Anthropic-compatible gateway
  baseUrl?: string;
  authToken?: string;
  // Salesforce LLM Gateway (internal; kept for back-compat)
  gatewayUrl?: string;
  gatewayToken?: string;
  model?: string;
  theme?: "light" | "dark" | "system";
  sfTargetOrg?: string;
  // LSC mobile app connected-app consumer key, for First sync mobile login
  mobileClientId?: string;
}

const DEFAULT_SETTINGS: Settings = {
  providerType: "",
  model: "claude-sonnet-5",
  theme: "system",
};

function getSettingsPath(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "settings.json");
}

export function loadSettings(): Settings {
  try {
    const filePath = getSettingsPath();
    if (!fs.existsSync(filePath)) return { ...DEFAULT_SETTINGS };
    const raw = fs.readFileSync(filePath, "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  const filePath = getSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}
