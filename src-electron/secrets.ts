import fs from "fs";
import path from "path";
import { app, safeStorage } from "electron";

/**
 * API keys and tokens, encrypted with the OS keychain (Electron safeStorage) in
 * userData/secrets.json — never in settings.json and never sent to the renderer.
 * Where no keychain is available (some Linux desktops) they're kept unencrypted, or under Electron's
 * fixed `basic_text` key, which is no better; the file being readable only by this user is then the
 * only protection, so its mode is set on every write (a file made by an older version may be wider).
 */
type Stored = Record<string, { encrypted: boolean; value: string }>;

function secretsPath(): string {
  return path.join(app.getPath("userData"), "secrets.json");
}

function readAll(): Stored {
  try {
    return JSON.parse(fs.readFileSync(secretsPath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeAll(stored: Stored): void {
  const file = secretsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows ignores POSIX modes; the file is in the user's profile.
  }
}

let warned = false;
function warnIfWeak(): void {
  if (warned || process.platform !== "linux") return;
  warned = true;
  const backend = safeStorage.getSelectedStorageBackend?.();
  if (!safeStorage.isEncryptionAvailable() || backend === "basic_text") {
    console.warn(`[secrets] No system keyring (${backend ?? "none"}): keys in ${secretsPath()} are protected only by file permissions.`);
  }
}

export function getSecret(name: string): string | undefined {
  const entry = readAll()[name];
  if (!entry) return undefined;
  try {
    return entry.encrypted ? safeStorage.decryptString(Buffer.from(entry.value, "base64")) : entry.value;
  } catch {
    // Encrypted by another user or machine — treat as not saved.
    return undefined;
  }
}

export function setSecret(name: string, value: string): void {
  warnIfWeak();
  const stored = readAll();
  stored[name] = safeStorage.isEncryptionAvailable()
    ? { encrypted: true, value: safeStorage.encryptString(value).toString("base64") }
    : { encrypted: false, value };
  writeAll(stored);
}

export function deleteSecret(name: string): void {
  const stored = readAll();
  if (!(name in stored)) return;
  delete stored[name];
  writeAll(stored);
}

export function hasSecret(name: string): boolean {
  return name in readAll();
}
