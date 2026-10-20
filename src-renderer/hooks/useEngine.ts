import { useState, useCallback, useEffect } from "react";
import type { LlmApiStyle, LlmConnection, LlmConnectionKind } from "../connection";

interface EngineState {
  connected: boolean;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  providerType: LlmConnectionKind | "";
  apiStyle?: LlmApiStyle;
  /** How the app reaches the model, e.g. "OpenAI API key". */
  label?: string;
  /** The connection's own model, if it names one. */
  defaultModel?: string;
  models?: string[];
  error: string | null;
}

const DISCONNECTED: EngineState = {
  connected: false,
  toolCount: 0,
  tools: [],
  providerType: "",
  error: null,
};

export function useEngine() {
  const [state, setState] = useState<EngineState>(DISCONNECTED);

  // The org's MCP server starts after the engine connects, so the tool count arrives later.
  useEffect(
    () => window.lscApi?.onEngineTools((toolCount) => setState((prev) => (prev.connected ? { ...prev, toolCount } : prev))),
    []
  );

  /** Connect; a `secret` entered on the setup screen is saved to the keychain by the main process. */
  const start = useCallback(async (connection: LlmConnection, secret?: string) => {
    setState((prev) => ({ ...prev, error: null }));
    const result = await window.lscApi.startEngine(connection, secret);

    if (result.ok) {
      setState({
        connected: true,
        toolCount: result.toolCount || 0,
        tools: result.tools || [],
        providerType: result.providerType ?? connection.kind,
        apiStyle: result.apiStyle,
        label: result.label,
        defaultModel: result.defaultModel,
        models: result.models,
        error: null,
      });
    } else {
      setState((prev) => ({
        ...prev,
        connected: false,
        error: result.error || "Failed to start engine",
      }));
    }

    return result;
  }, []);

  const stop = useCallback(async () => {
    await window.lscApi.stopEngine();
    setState(DISCONNECTED);
  }, []);

  return { ...state, start, stop };
}
