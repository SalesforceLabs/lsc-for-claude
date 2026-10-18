import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Spinner from "./components/ui/Spinner";
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
import { useOrgs, useSelectedOrgId } from "./hooks/useOrgs";
import { orgKey, orgLabel, sameUsername, sessionOrgView, toOrgRef, type OrgRef } from "./orgs";
import type { LibraryItem, OrgScope } from "./types";

export default function App() {
  const chat = useChat();
  const engine = useEngine();
  const orgs = useOrgs();
  const orgId = useSelectedOrgId();
  const [libraryScope, setLibraryScope] = useState<OrgScope>("org");
  const library = useLibrary(orgId, libraryScope);
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

  // ── The org is the workspace: sessions, Studio and the Library follow the selected org ──

  // The org of the session on screen; a new session works in the selected org.
  const [chatOrg, setChatOrg] = useState<OrgRef | null>(null);
  // Bumped when sessions are moved into the org, so the composer reads the session's org again.
  const [sessionsMoved, setSessionsMoved] = useState(0);
  useEffect(() => {
    const id = chat.conversationId;
    if (!id) {
      setChatOrg(null);
      return;
    }
    let stale = false;
    window.lscApi.getConversation(id).then((c) => !stale && setChatOrg(c?.org ?? null)).catch(() => {});
    return () => {
      stale = true;
    };
    // A session started with no org is tied to one by its first message, so look again when a run ends.
  }, [chat.conversationId, chat.isStreaming, sessionsMoved]);

  // Which org each running session is in, so the org menu can show where work is going on.
  const [convOrgs, setConvOrgs] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const unknown = [...chat.streamingConvIds].filter((id) => !convOrgs.has(id));
    if (!unknown.length) return;
    Promise.all(unknown.map((id) => window.lscApi.getConversation(id).then((c) => [id, c?.org?.username ?? ""] as const)))
      .then((found) => setConvOrgs((prev) => new Map([...prev, ...found])))
      .catch(() => {});
  }, [chat.streamingConvIds, convOrgs]);
  const runningOrgs = useMemo(
    () => new Set([...chat.streamingConvIds].map((id) => convOrgs.get(id)?.toLowerCase()).filter((u): u is string => !!u)),
    [chat.streamingConvIds, convOrgs]
  );

  // Switching orgs comes back to the session last open in that org (or a new one), the way
  // switching Safari profiles brings back their windows. Opening a session from another org
  // switches to that org first and lands on it.
  const lastSession = useRef(new Map<string, string | null>());
  const pendingOpen = useRef<string | null>(null);
  const shownOrg = useRef<string | undefined>(undefined);
  const viewedConv = useRef<string | null>(null);
  viewedConv.current = chat.conversationId;
  useEffect(() => {
    if (orgId === undefined) return;
    const prev = shownOrg.current;
    shownOrg.current = orgId;
    if (prev === undefined || sameUsername(prev, orgId) || (!prev && !orgId)) return;
    lastSession.current.set(prev.toLowerCase(), viewedConv.current);
    // Switching orgs says "I'm working here now"; "All orgs" is for one lookup, not a lingering mode.
    setLibraryScope("org");
    const target = pendingOpen.current ?? lastSession.current.get(orgId.toLowerCase()) ?? null;
    if (pendingOpen.current) {
      setStudioOpen(false);
      setLibraryPanelOpen(false);
    }
    pendingOpen.current = null;
    if (target) chat.loadConversation(target);
    else chat.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const openSession = useCallback(
    async (id: string) => {
      setStudioOpen(false);
      setLibraryPanelOpen(false);
      const owner = (await window.lscApi.getConversation(id).catch(() => null))?.org;
      if (owner && orgId !== undefined && !sameUsername(owner.username, orgId)) {
        const live = orgs.orgs.find((o) => sameUsername(o.username, owner.username));
        if (live) {
          pendingOpen.current = id;
          await orgs.select(orgKey(live));
          return;
        }
        // Its connection is gone: open it where we are; the composer says how to log in again.
      }
      chat.loadConversation(id);
    },
    [orgId, orgs, chat]
  );

  const forgetSession = useCallback((id: string) => {
    for (const [org, conv] of lastSession.current) if (conv === id) lastSession.current.set(org, null);
  }, []);

  const deleteSessions = useCallback(
    async (ids: string[]) => {
      await (ids.length === 1 ? window.lscApi.deleteConversation(ids[0]) : window.lscApi.deleteConversations(ids));
      ids.forEach(forgetSession);
      if (chat.conversationId && ids.includes(chat.conversationId)) chat.clear();
    },
    [forgetSession, chat]
  );

  const composerOrg = useMemo(() => {
    const ref = chatOrg ?? (orgs.current ? toOrgRef(orgs.current) : orgs.chosen ? { username: orgs.chosen, label: orgs.chosen } : null);
    return ref ? sessionOrgView(ref, orgs.orgs, orgs.loading) : null;
  }, [chatOrg, orgs.current, orgs.chosen, orgs.orgs, orgs.loading]);

  const labelLibraryOrg = useCallback(
    (item: LibraryItem) => (item.org ? orgLabel(item.org, orgs.orgs) : "No org"),
    [orgs.orgs]
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
      <div className="connecting-splash">
        <div className="setup-drag drag-region" />
        <Spinner size={20} />
        <span>Connecting…</span>
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
      <div className="app-container">
      <Sidebar
        commands={commands}
        providerType={engine.providerType}
        activeConversationId={studioOpen || libraryPanelOpen ? null : chat.conversationId}
        streamingConvIds={chat.streamingConvIds}
        orgId={orgId}
        orgName={orgs.current ? orgKey(orgs.current) : orgs.chosen || undefined}
        runningOrgs={runningOrgs}
        libraryCount={library.items.length}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onCommandClick={(name) => { chat.clear(); setStudioOpen(false); setLibraryPanelOpen(false); setPrefillInput(`/lsc:${name} `); }}
        onNewChat={() => { setStudioOpen(false); setLibraryPanelOpen(false); chat.clear(); }}
        onLoadConversation={openSession}
        onDeleteConversations={deleteSessions}
        onSessionsMoved={() => {
          setSessionsMoved((n) => n + 1);
          // Library items saved from those sessions take their org too.
          library.refresh();
        }}
        onRenameConversation={async (id, title) => {
          await window.lscApi.renameConversation(id, title);
        }}
        onTogglePin={async (id) => {
          await window.lscApi.togglePinConversation(id);
        }}
        onOpenLibrary={() => handleOpenLibrary()}
        studioActive={studioOpen}
        libraryActive={libraryPanelOpen && !studioOpen}
        onOpenStudio={() => { setLibraryPanelOpen(false); setStudioOpen(true); }}
      />
      <div key={studioOpen ? "studio" : libraryPanelOpen ? "library" : "chat"} className="view-pane ui-enter">
      {studioOpen ? (
        <StudioView onAskClaude={handleAskClaude} />
      ) : libraryPanelOpen ? (
        <LibraryPanel
          items={library.items}
          loading={library.loading}
          error={library.error}
          onRetry={library.refresh}
          scope={libraryScope}
          onScopeChange={setLibraryScope}
          orgName={orgs.current ? orgKey(orgs.current) : orgs.chosen || undefined}
          labelOrg={labelLibraryOrg}
          onClose={() => { setLibraryPanelOpen(false); setLibraryFocusItemId(null); }}
          onDelete={library.deleteItem}
          onSearch={library.search}
          onGoToSession={openSession}
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
          org={composerOrg}
          waitingLogin={orgs.waitingLogin}
          onOrgLogin={
            composerOrg
              ? () => orgs.login({ alias: composerOrg.loginAlias, instanceUrl: composerOrg.ref.instanceUrl })
              : undefined
          }
        />
      )}
      </div>
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
