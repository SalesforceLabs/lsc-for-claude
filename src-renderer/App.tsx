import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useChat } from "./hooks/useChat";
import { useEngine } from "./hooks/useEngine";
import { useLibrary } from "./hooks/useLibrary";
import ChatView from "./components/ChatView";
import Sidebar from "./components/Sidebar";
import LibraryPanel from "./components/LibraryPanel";
import SettingsPanel from "./components/SettingsPanel";
import SetupScreen from "./components/SetupScreen";
import StudioView from "./components/studio/StudioView";
import StatusBar from "./components/StatusBar";

export default function App() {
  const chat = useChat();
  const engine = useEngine();
  const library = useLibrary();
  const [showSettings, setShowSettings] = useState(false);
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [libraryFocusItemId, setLibraryFocusItemId] = useState<string | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(true);
  const [prefillInput, setPrefillInput] = useState<string | undefined>();
  const [commands, setCommands] = useState<
    Array<{ name: string; description: string }>
  >([]);
  const [defaultModel, setDefaultModel] = useState<string | undefined>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    window.lscApi?.listCommands().then(setCommands).catch(() => {});
    window.lscApi?.getSettings().then((s) => {
      if (s.model) setDefaultModel(s.model);
    }).catch(() => {});
  }, []);

  // Auto-connect: env vars first, then saved settings, then show setup
  useEffect(() => {
    if (!window.lscApi) {
      setAutoDetecting(false);
      return;
    }
    (async () => {
      try {
        // 1. Check for env-based credentials (Bedrock gateway, ANTHROPIC_API_KEY)
        const env = await window.lscApi.detectEnvProvider();
        if (env.detected && env.providerType && env.credentials) {
          await engine.start(env.providerType, env.credentials);
          setAutoDetecting(false);
          return;
        }

        // 2. Fall back to saved settings
        const settings = await window.lscApi.getSettings();
        if (settings.providerType === "api-key" && settings.apiKey) {
          await engine.start("api-key", { apiKey: settings.apiKey });
        } else if (
          settings.providerType === "bedrock-gateway" &&
          settings.authToken &&
          settings.baseUrl
        ) {
          await engine.start("bedrock-gateway", {
            authToken: settings.authToken,
            baseUrl: settings.baseUrl,
          });
        } else if (
          settings.providerType === "sf-gateway" &&
          settings.gatewayToken
        ) {
          await engine.start("sf-gateway", {
            accessToken: settings.gatewayToken,
            gatewayUrl: settings.gatewayUrl,
          });
        }
      } catch {
        // Fall through to setup screen
      }
      setAutoDetecting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Studio → chat handoff: open a fresh session with the context prefilled for the user to edit.
  const handleAskClaude = useCallback((prompt: string) => {
    setStudioOpen(false);
    setLibraryPanelOpen(false);
    chat.clear();
    setPrefillInput(prompt);
  }, [chat]);

  const handleOpenLibrary = useCallback((itemId?: string) => {
    setStudioOpen(false);
    setLibraryPanelOpen(true);
    setLibraryFocusItemId(itemId ?? null);
  }, []);

  const handleSaveToLibrary = useCallback(async (input: {
    title: string;
    content: string;
    contentType: "response" | "code" | "diagram" | "table";
    svg?: string;
    sourceConversationId?: string;
  }) => {
    await library.saveItem(input);
  }, [library]);

  const savedDiagramContents = useMemo(
    () => new Set(library.items.filter(i => i.contentType === "diagram").map(i => i.content)),
    [library.items]
  );

  // Show a brief loading state while auto-detecting
  if (autoDetecting) {
    return (
      <div className="connecting-splash no-drag">
        Connecting...
      </div>
    );
  }

  if (!engine.connected) {
    return (
      <SetupScreen
        onConnect={async (providerType, credentials) => {
          const result = await engine.start(providerType, credentials);
          if (result.ok) {
            await window.lscApi.saveSettings({
              providerType,
              ...(providerType === "api-key"
                ? { apiKey: credentials.apiKey }
                : providerType === "bedrock-gateway"
                ? {
                    authToken: credentials.authToken,
                    baseUrl: credentials.baseUrl,
                  }
                : {
                    gatewayToken: credentials.accessToken,
                    gatewayUrl: credentials.gatewayUrl,
                  }),
            });
          }
          return result;
        }}
        error={engine.error}
      />
    );
  }

  return (
    <div className="app-layout">
      <div className="titlebar" />
      <div className="app-container">
      <Sidebar
        commands={commands}
        providerType={engine.providerType}
        activeConversationId={chat.conversationId}
        streamingConvIds={chat.streamingConvIds}
        libraryCount={library.items.length}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onCommandClick={(name) => { chat.clear(); setStudioOpen(false); setLibraryPanelOpen(false); setPrefillInput(`/lsc:${name} `); }}
        onNewChat={() => { setStudioOpen(false); chat.clear(); }}
        onLoadConversation={(id) => { setStudioOpen(false); setLibraryPanelOpen(false); chat.loadConversation(id); }}
        onDeleteConversation={async (id) => {
          await window.lscApi.deleteConversation(id);
          if (chat.conversationId === id) {
            chat.clear();
          }
        }}
        onRenameConversation={async (id, title) => {
          await window.lscApi.renameConversation(id, title);
        }}
        onTogglePin={async (id) => {
          await window.lscApi.togglePinConversation(id);
        }}
        onOpenLibrary={() => handleOpenLibrary()}
        studioActive={studioOpen}
        onOpenStudio={() => { setLibraryPanelOpen(false); setStudioOpen(true); }}
      />
      {studioOpen ? (
        <StudioView onAskClaude={handleAskClaude} />
      ) : libraryPanelOpen ? (
        <LibraryPanel
          items={library.items}
          onClose={() => { setLibraryPanelOpen(false); setLibraryFocusItemId(null); }}
          onDelete={library.deleteItem}
          onSearch={library.search}
          onGoToSession={(id) => { setLibraryPanelOpen(false); chat.loadConversation(id); }}
          focusItemId={libraryFocusItemId}
        />
      ) : (
        <ChatView
          messages={chat.messages}
          isStreaming={chat.isStreaming}
          error={chat.error}
          commands={commands}
          conversationId={chat.conversationId}
          defaultModel={defaultModel}
          providerType={engine.providerType}
          onSend={chat.sendMessage}
          onAbort={chat.abort}
          onRerun={chat.sendMessage}
          onToggleTool={chat.toggleToolCollapse}
          onSaveToLibrary={handleSaveToLibrary}
          savedDiagramContents={savedDiagramContents}
          prefillInput={prefillInput}
          onPrefillConsumed={() => setPrefillInput(undefined)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onDisconnect={async () => {
            await engine.stop();
            await window.lscApi.saveSettings({ providerType: "" });
            setShowSettings(false);
          }}
        />
      )}
      </div>
      <StatusBar toolCount={engine.toolCount} onSettingsClick={() => setShowSettings(true)} />
    </div>
  );
}
