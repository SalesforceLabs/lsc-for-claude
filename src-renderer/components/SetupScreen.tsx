import React, { useState } from "react";
import {
  CONNECTION_CHOICES,
  connectionChoice,
  headerLines,
  parseHeaderLines,
  type LlmAuthHeader,
  type LlmConnection,
  type LlmConnectionKind,
  type LlmConnectionTest,
} from "../connection";

export interface DetectedProviders {
  /** Host of the gateway in Claude Code's settings, if any. */
  claudeCode?: string;
  env: { anthropic: boolean; openai: boolean };
  /** Kinds with a key saved in the keychain. */
  savedSecrets: LlmConnectionKind[];
}

interface SetupScreenProps {
  onConnect: (connection: LlmConnection, secret?: string) => Promise<{ ok: boolean; error?: string }>;
  error: string | null;
  detected: DetectedProviders;
  /** The saved connection, to start from when changing it. */
  initial?: LlmConnection;
  /** Shown when the setup screen was opened from Settings. */
  onCancel?: () => void;
}

const AUTH_HEADERS: Record<"anthropic" | "openai", Array<{ value: LlmAuthHeader; label: string }>> = {
  anthropic: [
    { value: "x-api-key", label: "x-api-key" },
    { value: "bearer", label: "Authorization: Bearer" },
  ],
  openai: [
    { value: "bearer", label: "Authorization: Bearer" },
    { value: "api-key", label: "api-key (Azure OpenAI)" },
  ],
};

function initialKind(detected: DetectedProviders, initial?: LlmConnection): LlmConnectionKind {
  if (initial) return initial.kind;
  if (detected.claudeCode) return "claude-code";
  return "anthropic";
}

export default function SetupScreen({ onConnect, error, detected, initial, onCancel }: SetupScreenProps) {
  const [kind, setKind] = useState<LlmConnectionKind>(() => initialKind(detected, initial));
  // Each kind keeps its own fields; the saved connection fills in the one it's for.
  const fromInitial = initial?.kind === kind ? initial : undefined;
  const [secret, setSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState(fromInitial?.baseUrl ?? "");
  const [authHeader, setAuthHeader] = useState<LlmAuthHeader | undefined>(fromInitial?.authHeader);
  const [useCommand, setUseCommand] = useState(!!fromInitial?.tokenCommand);
  const [tokenCommand, setTokenCommand] = useState(fromInitial?.tokenCommand ?? "");
  const [headers, setHeaders] = useState(headerLines(fromInitial?.headers));
  const [model, setModel] = useState(fromInitial?.model ?? "");
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);
  const [test, setTest] = useState<LlmConnectionTest | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const choice = connectionChoice(kind)!;
  const gateway = kind === "anthropic-gateway" || kind === "openai-compatible";
  const needsModel = choice.style === "openai";
  const hasSavedSecret = detected.savedSecrets.includes(kind);
  const envKey = (kind === "anthropic" && detected.env.anthropic) || (kind === "openai" && detected.env.openai);

  const changeKind = (next: LlmConnectionKind) => {
    const saved = initial?.kind === next ? initial : undefined;
    setKind(next);
    setSecret("");
    setBaseUrl(saved?.baseUrl ?? "");
    setAuthHeader(saved?.authHeader);
    setUseCommand(!!saved?.tokenCommand);
    setTokenCommand(saved?.tokenCommand ?? "");
    setHeaders(headerLines(saved?.headers));
    setModel(saved?.model ?? "");
    setTest(null);
    setLocalError(null);
  };

  /** Any edit makes the last test result stale. */
  const edited = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setTest(null);
    setLocalError(null);
  };

  const connection = (): LlmConnection => {
    const c: LlmConnection = { kind };
    if (model.trim()) c.model = model.trim();
    if (gateway) {
      c.baseUrl = baseUrl.trim();
      c.authHeader = authHeader ?? AUTH_HEADERS[choice.style][0].value;
      if (useCommand && tokenCommand.trim()) c.tokenCommand = tokenCommand.trim();
      const parsed = parseHeaderLines(headers);
      if (Object.keys(parsed).length) c.headers = parsed;
    }
    return c;
  };
  // A command replaces the token, so a typed token isn't sent alongside one.
  const enteredSecret = () => (gateway && useCommand ? undefined : secret.trim() || undefined);

  const runTest = async (): Promise<LlmConnectionTest> => {
    const result = await window.lscApi.testProvider(connection(), enteredSecret());
    setTest(result);
    // Fill in the model the test used, so Connect saves the one that worked.
    if (result.ok && result.model && needsModel && !model.trim()) setModel(result.model);
    return result;
  };

  const handleTest = async () => {
    setBusy("test");
    setLocalError(null);
    try {
      await runTest();
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = async () => {
    setBusy("connect");
    setLocalError(null);
    try {
      const result = test?.ok ? test : await runTest();
      if (!result.ok) return;
      const c = connection();
      if (!c.model && result.model && (needsModel || gateway)) c.model = result.model;
      const started = await onConnect(c, enteredSecret());
      if (!started.ok) setLocalError(started.error || "Connection failed");
    } finally {
      setBusy(null);
    }
  };

  const canSubmit = (() => {
    switch (kind) {
      case "claude-code":
        return !!detected.claudeCode;
      case "anthropic":
      case "openai":
        return !!secret.trim() || hasSavedSecret || envKey;
      default:
        return !!baseUrl.trim() && (!useCommand || !!tokenCommand.trim());
    }
  })();

  const displayError = localError || (test && !test.ok ? test.error : null) || (test ? null : error);
  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canSubmit && !busy) handleConnect();
  };

  const secretPlaceholder = hasSavedSecret
    ? "Saved in your keychain — leave blank to keep it"
    : envKey
    ? `Using ${kind === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} from the environment`
    : kind === "anthropic"
    ? "sk-ant-..."
    : kind === "openai"
    ? "sk-..."
    : "Leave blank if the endpoint needs none";

  return (
    <div className="setup-screen no-drag">
      <div className="setup-container">
        <div className="setup-header">
          <h1>LSC Assistant</h1>
          <p>AI-powered assistant for LSC implementations</p>
        </div>

        <div className="settings-panel">
          <div className="form-group">
            <label>How do you want to connect?</label>
            <select value={kind} onChange={(e) => changeKind(e.target.value as LlmConnectionKind)}>
              {CONNECTION_CHOICES.map((c) => (
                <option key={c.kind} value={c.kind}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="setup-hint">{choice.description}</p>
          </div>

          {kind === "claude-code" && (
            <p className="setup-hint">
              {detected.claudeCode ? (
                <>
                  Found <strong>{detected.claudeCode}</strong> in Claude Code&apos;s settings.{" "}
                </>
              ) : (
                <>
                  No gateway found in Claude Code&apos;s settings yet. Set up Claude Code for the
                  gateway first, then come back.{" "}
                </>
              )}
              The app uses the same <code>ANTHROPIC_BASE_URL</code>,{" "}
              <code>ANTHROPIC_CUSTOM_HEADERS</code>, and <code>apiKeyHelper</code> (or{" "}
              <code>ANTHROPIC_AUTH_TOKEN</code>) from <code>~/.claude/settings.json</code>, read fresh
              each time it connects.
            </p>
          )}

          {gateway && (
            <>
              <div className="form-group">
                <label>Base URL</label>
                <input
                  type="text"
                  placeholder={
                    kind === "anthropic-gateway"
                      ? "https://llm-gateway.example.com"
                      : "https://llm-gateway.example.com/v1"
                  }
                  value={baseUrl}
                  onChange={(e) => edited(setBaseUrl)(e.target.value)}
                  spellCheck={false}
                />
                <p className="setup-hint">
                  {kind === "anthropic-gateway" ? (
                    <>Requests go to <code>/v1/messages</code> under this URL.</>
                  ) : (
                    <>
                      Requests go to <code>/chat/completions</code> under this URL — it usually ends
                      in <code>/v1</code>. For Azure OpenAI, use the deployment&apos;s OpenAI-compatible
                      URL.
                    </>
                  )}{" "}
                  Must be https (http only for localhost).
                </p>
              </div>
              <div className="form-group">
                <label>Send the token as</label>
                <select
                  value={authHeader ?? AUTH_HEADERS[choice.style][0].value}
                  onChange={(e) => edited(setAuthHeader)(e.target.value as LlmAuthHeader)}
                >
                  {AUTH_HEADERS[choice.style].map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <div className="setup-radio">
                  <label>
                    <input type="radio" checked={!useCommand} onChange={() => edited(setUseCommand)(false)} />
                    Token
                  </label>
                  <label>
                    <input type="radio" checked={useCommand} onChange={() => edited(setUseCommand)(true)} />
                    Run a command for the token
                  </label>
                </div>
              </div>
            </>
          )}

          {kind !== "claude-code" && !(gateway && useCommand) && (
            <div className="form-group">
              <label>{gateway ? "Token" : "API key"}</label>
              <input
                type="password"
                placeholder={secretPlaceholder}
                value={secret}
                onChange={(e) => edited(setSecret)(e.target.value)}
                onKeyDown={submitOnEnter}
                autoComplete="off"
              />
              <p className="setup-hint">
                {kind === "anthropic" && (
                  <>
                    Get a key from{" "}
                    <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                      console.anthropic.com
                    </a>
                    .{" "}
                  </>
                )}
                {kind === "openai" && (
                  <>
                    Get a key from{" "}
                    <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                      platform.openai.com
                    </a>
                    .{" "}
                  </>
                )}
                Stored in your system keychain and only sent to {gateway ? "this URL" : kind === "openai" ? "OpenAI" : "Anthropic"}.
              </p>
            </div>
          )}

          {gateway && useCommand && (
            <div className="form-group">
              <label>Token command</label>
              <input
                type="text"
                placeholder="e.g. my-sso-tool print-token"
                value={tokenCommand}
                onChange={(e) => edited(setTokenCommand)(e.target.value)}
                onKeyDown={submitOnEnter}
                spellCheck={false}
              />
              <p className="setup-hint">
                Runs in a shell and its output is used as the token, like Claude Code&apos;s{" "}
                <code>apiKeyHelper</code>. Re-run every 5 minutes and when the gateway rejects the token.
              </p>
            </div>
          )}

          {gateway && (
            <div className="form-group">
              <label>Extra headers</label>
              <textarea
                rows={2}
                placeholder="Header-Name: value (one per line, optional)"
                value={headers}
                onChange={(e) => edited(setHeaders)(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}

          {needsModel && (
            <div className="form-group">
              <label>Model</label>
              <input
                type="text"
                list="setup-models"
                placeholder={kind === "openai" ? "e.g. gpt-5" : "Model or deployment name"}
                value={model}
                onChange={(e) => edited(setModel)(e.target.value)}
                onKeyDown={submitOnEnter}
                spellCheck={false}
              />
              <datalist id="setup-models">
                {(test?.models ?? []).map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              <p className="setup-hint">
                {test?.models?.length
                  ? `${test.models.length} model${test.models.length === 1 ? "" : "s"} found — pick one or type a name.`
                  : "Test the connection to list the models the endpoint serves."}{" "}
                LSC Assistant is tested with Claude; other models may vary.
              </p>
            </div>
          )}

          {test?.ok && (
            <div className="setup-success">
              Connection works{test.model ? ` — ${test.model} answered` : ""}.
              {test.models?.length ? ` ${test.models.length} models available.` : ""}
            </div>
          )}
          {displayError && <div className="setup-error">{displayError}</div>}

          <div className="form-row" style={{ marginTop: 4 }}>
            {onCancel && (
              <button className="btn-secondary" onClick={onCancel} disabled={!!busy}>
                Cancel
              </button>
            )}
            <button className="btn-secondary" onClick={handleTest} disabled={!!busy || !canSubmit}>
              {busy === "test" ? "Testing..." : "Test connection"}
            </button>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              onClick={handleConnect}
              disabled={!!busy || !canSubmit}
            >
              {busy === "connect" ? "Connecting..." : "Connect"}
            </button>
          </div>

          <p className="setup-hint" style={{ marginTop: 12, textAlign: "center" }}>
            The app reconnects with this setup next time. If Claude Code is set up for a gateway, or{" "}
            <code>ANTHROPIC_API_KEY</code> is set, it connects automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
