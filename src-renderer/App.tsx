import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useChat } from "./hooks/useChat";
import { useEngine } from "./hooks/useEngine";
import { useLibrary } from "./hooks/useLibrary";
import ChatView from "./components/ChatView";
import Sidebar from "./components/Sidebar";
import LibraryPanel from "./components/LibraryPanel";
import SettingsPanel from "./components/SettingsPanel";
import SetupScreen, { type DetectedProviders } from "./components/SetupScreen";
import { type LlmConnection } from "./connection";
import { modelOptionsFor } from "./models";
import StudioView from "./components/studio/StudioView";
import StatusBar from "./components/StatusBar";

export default function App() {
  const chat = useChat();
  const engine = useEngine();
  const library = useLibrary();
  const [showSettings, setShowSettings] = useState(false);
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  // What the setup screen can offer without asking, and the saved connection to start from
  const [detected, setDetected] = useState<DetectedProviders>({ env: { anthropic: false, openai: false }, savedSecrets: [] });
  const [savedConnection, setSavedConnection] = useState<LlmConnection | undefined>();
  // Opened from Settings while connected: the setup screen replaces the app until it connects or is cancelled
  const [changingConnection, setChangingConnection] = useState(false);
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

  // Auto-connect: the saved connection, then Claude Code's gateway, then ANTHROPIC_API_KEY, else setup
  useEffect(() => {
    if (!window.lscApi) {
      setAutoDetecting(false);
      return;
    }
    (async () => {
      try {
        const [found, settings] = await Promise.all([window.lscApi.detectProvider(), window.lscApi.getSettings()]);
        setDetected(found);
        setSavedConnection(settings.connection);
        const candidate: LlmConnection | undefined =
          settings.connection ??
          (found.claudeCode ? { kind: "claude-code" } : found.env.anthropic ? { kind: "anthropic" } : undefined);
        if (candidate) await engine.start(candidate);
      } catch {
        // Fall through to setup screen
      }
      setAutoDetecting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openConnectionSetup = useCallback(async () => {
    setShowSettings(false);
    const [found, settings] = await Promise.all([window.lscApi.detectProvider(), window.lscApi.getSettings()]);
    setDetected(found);
    setSavedConnection(settings.connection);
    setChangingConnection(true);
  }, []);

  const modelOptions = useMemo(
    () => modelOptionsFor(engine.apiStyle, engine.models, engine.defaultModel),
    [engine.apiStyle, engine.models, engine.defaultModel]
  );

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

  if (!engine.connected || changingConnection) {
    return (
      <SetupScreen
        onConnect={async (connection, secret) => {
          // The main process saves the connection (and the secret, to the keychain) once it starts.
          const result = await engine.start(connection, secret);
          if (result.ok) {
            setSavedConnection(connection);
            setChangingConnection(false);
          }
          return result;
        }}
        error={engine.error}
        detected={detected}
        initial={savedConnection}
        onCancel={engine.connected ? () => setChangingConnection(false) : undefined}
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
          modelOptions={modelOptions}
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
          connectedVia={engine.label}
          modelOptions={modelOptions}
          onClose={() => setShowSettings(false)}
          onChangeConnection={openConnectionSetup}
        />
      )}
      </div>
      <StatusBar toolCount={engine.toolCount} onSettingsClick={() => setShowSettings(true)} />
    </div>
  );
}
