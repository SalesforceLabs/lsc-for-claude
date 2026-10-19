import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, Plus } from "lucide-react";
import { useAssistantName } from "../../../hooks/useAssistantName";
import { usePersistedFlag, usePersistedState } from "../../../hooks/usePersistedState";
import ResizeHandle from "../../ui/ResizeHandle";
import StateView from "../../ui/StateView";
import type { CodeEditorHandle } from "../../ui/CodeEditor";
import type { PendingChange } from "../changes";
import { useLazyStudio } from "../useLazyStudio";
import { scriptChangeKey, scriptFix, scriptDeleteChange, type ScriptDetail, type ScriptDiagnostic, type ScriptLibrary as Library, type ScriptTestResult } from "./script-model";
import NewScriptDialog, { type NewScriptInit } from "./NewScriptDialog";
import ScriptAssistPanel, { FOCUS_ASSIST_EVENT } from "./ScriptAssistPanel";
import ScriptEditorPane, { type EditorTab, type Proposal } from "./ScriptEditorPane";
import ScriptLibrary from "./ScriptLibrary";
import {
  deleteQueued as isDeleteQueued,
  draftChanges,
  draftFromDetail,
  draftFromQueuedCreate,
  draftIsDirty,
  matchesOrg,
  newDraft,
  newKey,
  queueScriptChanges,
  queuedScriptKeys,
  withoutScriptChanges,
  type ScriptDraft,
} from "./script-drafts";
import { scriptShortcut } from "./script-keys";
import { buildRows } from "./script-library-logic";
import { sendAssistMessage } from "./script-assist-store";
import { prefillAssistComposer } from "./script-ask";
import "./scripts.css";

interface CustomScriptsViewProps {
  pending: PendingChange[];
  onPendingChange: (next: PendingChange[]) => void;
  /** Open the review dialog for the tray. */
  onReview: () => void;
  /** Bumps after changes are applied to the org. */
  writeVersion: number;
  /** The page is the one on screen (it stays mounted when it isn't). */
  active: boolean;
  /** A script to open, from the inspector; `nonce` makes asking for the same one again work. */
  openRequest: { id: string; nonce: number } | null;
  tray: React.ReactNode;
}

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const number = (raw: string) => (Number.isFinite(Number(raw)) ? Number(raw) : undefined);
const MISSING_OBJECTS = /INVALID_TYPE|sObject type|not supported|isn't supported|doesn't exist|does not exist/i;

function toLibrary(data: unknown): Library {
  const lib = data as Library | undefined;
  if (!lib || !Array.isArray(lib.scripts)) throw new Error("Studio couldn't read the scripts.");
  return { ...lib, stageObjects: Array.isArray(lib.stageObjects) ? lib.stageObjects : [] };
}

/** Studio's Custom scripts page: the org's scripts, a code editor with Ask Roz beside it, and changes that wait in the tray. */
export default function CustomScriptsView({ pending, onPendingChange, onReview, writeVersion, active, openRequest, tray }: CustomScriptsViewProps) {
  const assistant = useAssistantName();
  const loads = useRef(0);
  const { state, retry } = useLazyStudio(
    `scripts:${writeVersion}`,
    () => window.lscApi.studioCustomScripts(loads.current++ > 0),
    toLibrary
  );
  // The last good library stays on screen while a refresh runs, so the editor never blinks away.
  const [library, setLibrary] = useState<Library | null>(null);
  useEffect(() => {
    if (state.status === "ready") setLibrary(state.data);
  }, [state]);

  const [drafts, setDrafts] = useState<Record<string, ScriptDraft>>({});
  const [details, setDetails] = useState<Record<string, ScriptDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tabs, setTabs] = useState<Record<string, EditorTab>>({});
  const [proposals, setProposals] = useState<Record<string, Proposal | undefined>>({});
  /** The last test per script and the code it ran against, so a result for older code can say so. */
  const [tests, setTests] = useState<Record<string, { result: ScriptTestResult; code: string } | undefined>>({});
  const [diags, setDiags] = useState<Record<string, ScriptDiagnostic[]>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [askOpen, setAskOpen] = usePersistedFlag("roz.scripts.ask", true);
  const [askWidth, setAskWidth] = usePersistedState("roz.scripts.askWidth", 380, number, String);
  const [libWidth, setLibWidth] = usePersistedState("roz.scripts.libWidth", 264, number, String);
  const [dragging, setDragging] = useState(false);
  const editorRef = useRef<CodeEditorHandle | null>(null);

  const stageObjects = library?.stageObjects ?? [];

  // --- Loading one script ---------------------------------------------------------------------

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await window.lscApi.studioCustomScript(id);
      const data = res.data as (ScriptDetail & { error?: string }) | undefined;
      if (res.error || !data || data.error) throw new Error(res.error || data?.error || "No answer from Studio.");
      setDetails((d) => ({ ...d, [id]: data }));
      setDetailErrors((e) => {
        if (!(id in e)) return e;
        const { [id]: _gone, ...rest } = e;
        return rest;
      });
      return data;
    } catch (err) {
      setDetailErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : String(err) }));
      return null;
    }
  }, []);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  // A script that is selected gets its detail read, and a draft made from it.
  useEffect(() => {
    if (!selectedKey || selectedKey.startsWith("new:") || details[selectedKey] || detailErrors[selectedKey]) return;
    loadDetail(selectedKey);
  }, [selectedKey, details, detailErrors, loadDetail]);

  useEffect(() => {
    setDrafts((current) => {
      let next = current;
      for (const [id, detail] of Object.entries(details)) {
        if (!current[id]) next = { ...next, [id]: draftFromDetail(detail) };
      }
      return next;
    });
  }, [details]);

  // After changes are applied, read the scripts again; a draft that matches the org (or has no edits) takes the fresh copy.
  const lastWrite = useRef(writeVersion);
  useEffect(() => {
    if (lastWrite.current === writeVersion) return;
    lastWrite.current = writeVersion;
    const ids = Object.keys(details);
    Promise.all(ids.map((id) => loadDetail(id))).then((fresh) => {
      setDrafts((current) => {
        const next = { ...current };
        for (const detail of fresh) {
          if (!detail) continue;
          const d = next[detail.id];
          if (!d || !draftIsDirty(d, stageObjects) || matchesOrg(d, detail)) next[detail.id] = draftFromDetail(detail);
        }
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeVersion]);

  // A new script that now exists in the org stops being a draft.
  useEffect(() => {
    if (!library) return;
    const known = new Map(library.scripts.map((s) => [s.componentName.toLowerCase(), s.id]));
    const created = Object.values(drafts).filter((d) => d.isNew && known.has(d.fields.componentName.toLowerCase()));
    if (!created.length) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const d of created) delete next[d.key];
      return next;
    });
    if (selectedKey && created.some((d) => d.key === selectedKey)) {
      setSelectedKey(known.get(created.find((d) => d.key === selectedKey)!.fields.componentName.toLowerCase())!);
    }
  }, [library, drafts, selectedKey]);

  // Creates waiting in the tray come back as drafts after a reload.
  useEffect(() => {
    const missing: ScriptDraft[] = [];
    for (const p of pending) {
      const f = scriptFix(p.fix);
      if (f?.kind !== "createCustomScript" || !f.componentName) continue;
      const componentName = f.componentName;
      if (draftsRef.current[newKey(componentName)]) continue;
      if (library?.scripts.some((s) => s.componentName.toLowerCase() === componentName.toLowerCase())) continue;
      const d = draftFromQueuedCreate(pending, f.componentName);
      if (d) missing.push(d);
    }
    if (missing.length) setDrafts((current) => Object.fromEntries([...Object.entries(current), ...missing.map((d) => [d.key, d] as const)]));
  }, [pending, library]);

  // --- Library ----------------------------------------------------------------------------------

  const queuedKeys = useMemo(() => queuedScriptKeys(pending), [pending]);
  const dirtyKeys = useMemo(() => new Set(Object.values(drafts).filter((d) => draftIsDirty(d, stageObjects)).map((d) => d.key)), [drafts, stageObjects]);
  const rows = useMemo(
    () =>
      buildRows(
        library?.scripts ?? [],
        Object.values(drafts)
          .filter((d) => d.isNew)
          .map((d) => ({ key: d.key, name: d.fields.name, componentName: d.fields.componentName, type: d.fields.type, queued: queuedKeys.has(d.key) })),
        dirtyKeys,
        queuedKeys
      ),
    [library, drafts, dirtyKeys, queuedKeys]
  );
  const allComponentNames = useMemo(
    () => [...(library?.scripts.map((s) => s.componentName) ?? []), ...Object.values(drafts).filter((d) => d.isNew).map((d) => d.fields.componentName)],
    [library, drafts]
  );

  // First script opens by itself: the one that runs on visits, else the first.
  useEffect(() => {
    if (selectedKey || !library?.scripts.length) return;
    setSelectedKey(library.runningVisitScriptId ?? library.scripts[0].id);
  }, [library, selectedKey]);

  const openId = useRef(0);
  useEffect(() => {
    if (!openRequest || openRequest.nonce === openId.current) return;
    openId.current = openRequest.nonce;
    setSelectedKey(openRequest.id);
    setQuery("");
  }, [openRequest]);

  const draft = selectedKey ? (drafts[selectedKey] ?? null) : null;
  const detail = selectedKey ? (details[selectedKey] ?? null) : null;
  const row = rows.find((r) => r.key === selectedKey) ?? null;
  const tab = (selectedKey && tabs[selectedKey]) || "code";
  const proposal = selectedKey ? (proposals[selectedKey] ?? null) : null;

  const setDraft = (next: ScriptDraft) => setDrafts((d) => ({ ...d, [next.key]: next }));
  const setTab = (next: EditorTab) => selectedKey && setTabs((t) => ({ ...t, [selectedKey]: next }));
  const taken = useMemo(() => {
    const own = draft?.fields.componentName.toLowerCase();
    return allComponentNames.filter((n) => n.toLowerCase() !== own);
  }, [allComponentNames, draft]);

  // --- Actions ----------------------------------------------------------------------------------

  const assistContext = useCallback(
    (d: ScriptDraft, lastTest?: ScriptTestResult) => ({
      script: { name: d.fields.name, type: d.fields.type, objectName: d.fields.objectName, operationEventType: d.fields.operationEventType, code: d.code },
      diagnostics: diags[d.key],
      lastTest,
    }),
    [diags]
  );

  const create = (init: NewScriptInit) => {
    const d = newDraft({ name: init.name, componentName: init.componentName, type: init.type, code: init.code, componentNameEdited: init.componentNameEdited });
    setDrafts((current) => ({ ...current, [d.key]: d }));
    setSelectedKey(d.key);
    setQuery("");
    setNewOpen(false);
    if (init.describe) {
      setAskOpen(true);
      void sendAssistMessage(d.key, init.describe, assistContext(d));
    }
  };

  const save = useCallback(() => {
    if (!draft) return;
    const changes = draftChanges(draft, stageObjects);
    if (changes.length) onPendingChange(queueScriptChanges(pending, changes));
    onReview();
  }, [draft, stageObjects, pending, onPendingChange, onReview]);

  const discard = () => {
    if (!draft) return;
    setDiscarding(false);
    const stale = new Set(draftChanges(draft, stageObjects).map((c) => scriptChangeKey(c.fix)));
    onPendingChange(withoutScriptChanges(pending, draft.key).filter((p) => !stale.has(scriptChangeKey(p.fix))));
    setProposals((p) => ({ ...p, [draft.key]: undefined }));
    if (draft.isNew) {
      setDrafts((current) => {
        const { [draft.key]: _gone, ...rest } = current;
        return rest;
      });
      setSelectedKey(library?.runningVisitScriptId ?? library?.scripts[0]?.id ?? null);
    } else if (detail) {
      setDraft(draftFromDetail(detail));
    }
  };

  const queueDelete = (deleteBundle: boolean) => {
    if (!draft || draft.isNew) return;
    onPendingChange(queueScriptChanges(withoutScriptChanges(pending, draft.key), [scriptDeleteChange({ scriptId: draft.key, scriptName: draft.fields.name, deleteBundle })]));
  };
  const undoDelete = () => draft && onPendingChange(pending.filter((p) => scriptChangeKey(p.fix) !== `script-delete:${draft.key}`));

  const accept = useCallback(() => {
    if (!selectedKey) return;
    const p = proposals[selectedKey];
    if (!p) return;
    if (editorRef.current) editorRef.current.acceptProposal();
    else setDrafts((d) => ({ ...d, [selectedKey]: { ...d[selectedKey], code: p.code } }));
    setProposals((all) => ({ ...all, [selectedKey]: undefined }));
  }, [selectedKey, proposals]);
  const reject = useCallback(() => {
    if (!selectedKey) return;
    editorRef.current?.rejectProposal();
    setProposals((all) => ({ ...all, [selectedKey]: undefined }));
  }, [selectedKey]);

  const propose = (code: string, summary: string) => {
    if (!selectedKey) return;
    setProposals((all) => ({ ...all, [selectedKey]: { code, summary } }));
    setTab("code");
  };

  // The panel sees the new result as its lastTest and offers "Fix this test failure"; nothing is sent until they choose.
  const onAskRoz = (result: ScriptTestResult) => {
    if (!draft) return;
    onTestResult(draft.key, result);
    setAskOpen(true);
    window.setTimeout(() => window.dispatchEvent(new Event(FOCUS_ASSIST_EVENT)), 50);
  };

  const onAskFix = (text: string) => {
    setAskOpen(true);
    prefillAssistComposer(text);
  };

  const onTestResult = (key: string, result: ScriptTestResult | undefined) =>
    setTests((all) => {
      const cur = all[key];
      if (!result) return cur ? { ...all, [key]: undefined } : all;
      // The Test tab hands back a remembered result when it reopens: same object, same code.
      if (cur?.result === result) return all;
      return { ...all, [key]: { result, code: draftsRef.current[key]?.code ?? "" } };
    });

  // Keyboard: ⌘S save, ⌘K Ask Roz, ⇧⌘↵ Test, ⌘↵ / Esc for a suggestion.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const blocked = !!document.querySelector(".studio-modal-backdrop");
      const action = scriptShortcut(e, { proposal: !!proposal, blocked }, isMac);
      if (!action || !draft) return;
      if (action === "save") {
        e.preventDefault();
        if (!proposal) save();
      } else if (action === "ask") {
        if (!askOpen) {
          e.preventDefault();
          setAskOpen(true);
          window.setTimeout(() => window.dispatchEvent(new Event(FOCUS_ASSIST_EVENT)), 50);
        }
      } else if (action === "test") {
        e.preventDefault();
        setTab("test");
      } else if (action === "accept") {
        e.preventDefault();
        accept();
      } else if (action === "reject") {
        e.preventDefault();
        reject();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, proposal, draft, askOpen, save, accept, reject]);

  // --- Render -----------------------------------------------------------------------------------

  const missingObjects = library?.unavailable || (state.status === "error" && MISSING_OBJECTS.test(state.message));
  const newButton = (
    <button className="studio-btn primary" onClick={() => setNewOpen(true)}>
      <Plus size={14} aria-hidden="true" />
      New script
    </button>
  );

  let body: React.ReactNode;
  if (!library && state.status !== "error") {
    body = <StateView kind="loading" title="Reading custom scripts…" detail="This takes a few seconds in a large org." />;
  } else if (!library || missingObjects) {
    body = missingObjects ? (
      <StateView
        kind="empty"
        icon={FileCode2}
        title="This org doesn't have custom scripts"
        detail="Custom scripts need Life Sciences Cloud for Customer Engagement with the Custom Script object. Check that the package is installed and that this connection is an admin."
        actions={
          <button className="studio-btn" onClick={retry}>
            Check again
          </button>
        }
      />
    ) : (
      <StateView
        kind="error"
        title="Couldn't read custom scripts"
        detail={state.status === "error" ? state.message : undefined}
        actions={
          <button className="studio-btn" onClick={retry}>
            Retry
          </button>
        }
      />
    );
  } else if (rows.length === 0) {
    body = (
      <StateView
        kind="empty"
        icon={FileCode2}
        title="No custom scripts yet"
        detail={`Scripts add checks to visits, workflow stages and checklists. Describe what you want and ${assistant} writes the first version, or start from a template.`}
        actions={newButton}
      />
    );
  } else {
    body = (
      <div className={`scripts-shell${dragging ? " dragging" : ""}${askOpen && draft ? " asking" : ""}`}>
        <div className="scripts-library-col" style={{ width: libWidth }}>
          <ScriptLibrary rows={rows} selectedKey={selectedKey} onSelect={setSelectedKey} onNew={() => setNewOpen(true)} query={query} onQuery={setQuery} />
          <ResizeHandle value={libWidth} min={216} max={400} onChange={setLibWidth} onReset={() => setLibWidth(264)} onDragging={setDragging} label="Resize the script list" />
        </div>
        <div className="scripts-center">
          {draft ? (
            <ScriptEditorPane
              key={draft.key}
              draft={draft}
              detail={detail}
              library={library}
              row={row}
              takenComponentNames={taken}
              tab={tab}
              onTab={setTab}
              queued={queuedKeys.has(draft.key)}
              deleteQueued={isDeleteQueued(pending, draft.key)}
              proposal={proposal}
              askOpen={askOpen}
              isMac={isMac}
              editorRef={editorRef}
              onToggleAsk={() => setAskOpen(!askOpen)}
              onChange={setDraft}
              onDiagnostics={(next) => setDiags((all) => ({ ...all, [draft.key]: next }))}
              onAccept={accept}
              onReject={reject}
              onSave={save}
              onDiscard={() => setDiscarding(true)}
              onLoadLwc={() => detail?.lwcCode != null && setDraft({ ...draft, code: detail.lwcCode })}
              onQueueDelete={queueDelete}
              onUndoDelete={undoDelete}
              onResult={(r) => onTestResult(draft.key, r)}
              onAskRoz={onAskRoz}
              onAskFix={onAskFix}
              testStale={!!tests[draft.key] && tests[draft.key]!.code !== draft.code}
            />
          ) : selectedKey && detailErrors[selectedKey] ? (
            <StateView
              kind="error"
              title="Couldn't read this script"
              detail={detailErrors[selectedKey]}
              actions={
                <button className="studio-btn" onClick={() => loadDetail(selectedKey)}>
                  Retry
                </button>
              }
            />
          ) : selectedKey ? (
            <StateView kind="loading" title="Opening the script…" />
          ) : (
            <StateView kind="empty" icon={FileCode2} title="Pick a script" detail="Choose one from the list, or start a new one." actions={newButton} />
          )}
        </div>
        {askOpen && draft && (
          <aside className="scripts-ask" style={{ width: askWidth }} aria-label={`Ask ${assistant}`}>
            <ResizeHandle edge="left" value={askWidth} min={300} max={600} onChange={setAskWidth} onReset={() => setAskWidth(380)} onDragging={setDragging} label={`Resize ${assistant}`} />
            <ScriptAssistPanel
              key={draft.key}
              scriptKey={draft.key}
              script={assistContext(draft).script}
              diagnostics={diags[draft.key]}
              lastTest={tests[draft.key]?.result}
              proposal={proposal ? "pending" : "none"}
              onPropose={propose}
              onClose={() => setAskOpen(false)}
            />
          </aside>
        )}
      </div>
    );
  }

  return (
    <section className="studio-main scripts-page ui-enter" hidden={!active}>
      {library && state.status === "error" && (
        <div className="scripts-banner" role="alert">
          Couldn't refresh the scripts: {state.message}
          <button className="studio-link-btn" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {body}
      {tray}
      {newOpen && library && (
        <NewScriptDialog scripts={library.scripts} takenComponentNames={allComponentNames} onCreate={create} onCancel={() => setNewOpen(false)} onOpenScript={(id) => { setNewOpen(false); setSelectedKey(id); }} />
      )}
      {discarding && draft && (
        <div className="studio-modal-backdrop" onClick={() => setDiscarding(false)} onKeyDown={(e) => e.key === "Escape" && setDiscarding(false)}>
          <div className="studio-modal scripts-confirm" role="alertdialog" aria-label="Discard changes" onClick={(e) => e.stopPropagation()}>
            <h2 className="studio-inspector-title">{draft.isNew ? "Discard this draft?" : `Discard changes to ${draft.fields.name}?`}</h2>
            <p className="scripts-muted">{draft.isNew ? "The script hasn't been created, so nothing is kept." : "The code and settings go back to what the org has."}</p>
            <div className="studio-modal-actions">
              <button className="studio-btn ghost" autoFocus onClick={() => setDiscarding(false)}>
                Keep editing
              </button>
              <button className="studio-btn danger" onClick={discard}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
