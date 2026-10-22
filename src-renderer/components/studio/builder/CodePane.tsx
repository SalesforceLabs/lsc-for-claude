import React, { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, FileCode, History, Save, TriangleAlert, Undo2 } from "lucide-react";
import Spinner from "../../ui/Spinner";
import StateView from "../../ui/StateView";
import { builderApi } from "./api";
import { highlight, langOf } from "./highlight";
import { fileName, fileOrder, versionNumber } from "./logic";
import type { AppFile, AppIssue, AppProject, AppVersion } from "./types";

interface CodePaneProps {
  project: AppProject;
  version: AppVersion | undefined;
  isCurrent: boolean;
  building: boolean;
  /** A file and line to open at (from the Checks view). */
  focus: { path: string; line?: number; nonce: number } | null;
  onSaved: (versionId: string) => void;
  onRestore: (versionId: string) => void;
}

export default function CodePane({ project, version, isCurrent, building, focus, onSaved, onRestore }: CodePaneProps) {
  const files = useMemo(() => [...(version?.files ?? [])].sort((a, b) => fileOrder(a, b, project.name)), [version, project.name]);
  const [path, setPath] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A new version resets the edits; a file that is gone falls back to the first.
  useEffect(() => {
    setDrafts({});
    setError("");
  }, [version?.id]);
  useEffect(() => {
    if (!files.some((f) => f.path === path)) setPath(files[0]?.path ?? "");
  }, [files, path]);
  useEffect(() => {
    if (focus && files.some((f) => f.path === focus.path)) setPath(focus.path);
  }, [focus, files]);

  if (!version) {
    return building ? (
      <StateView kind="loading" layout="inline" title="Roz is writing the first files" detail="The code appears as soon as there is a version." />
    ) : (
      <StateView kind="empty" layout="inline" icon={FileCode} title="No code yet" detail="Ask Roz to build something and its files show up here." />
    );
  }

  const file = files.find((f) => f.path === path);
  const source = file ? drafts[file.path] ?? file.source : "";
  const dirty = Object.entries(drafts).filter(([p, s]) => files.find((f) => f.path === p)?.source !== s);
  const issuesFor = (p: string) => version.check.issues.filter((i) => i.path === p);

  const save = async () => {
    if (!dirty.length) return;
    setSaving(true);
    setError("");
    let last: AppVersion | undefined;
    for (const [p, s] of dirty) {
      const r = await builderApi().appEditFile(project.id, p, s).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e), version: undefined }));
      if (r.error || !r.version) {
        setError(r.error ?? "Couldn't save.");
        setSaving(false);
        return;
      }
      last = r.version;
    }
    setSaving(false);
    setDrafts({});
    if (last) onSaved(last.id);
  };

  const groups = [...new Set(files.map((f) => f.bundle))];
  return (
    <div className="bld-code">
      {!isCurrent && (
        <div className="bld-banner" role="status">
          <History size={14} aria-hidden="true" />
          <span>Viewing v{versionNumber(project, version.id)}, an earlier version. Restore it to edit.</span>
          <button className="studio-btn sm" onClick={() => onRestore(version.id)}>
            <Undo2 size={14} aria-hidden="true" />
            Restore as new version
          </button>
        </div>
      )}
      <div className="bld-code-main">
        <nav className="bld-files" aria-label="Files">
          {groups.map((g) => (
            <div key={g} className="bld-file-group">
              <div className="bld-file-bundle" title={g}>
                {g === project.name ? "App" : g}
              </div>
              {files
                .filter((f) => f.bundle === g)
                .map((f) => {
                  const issues = issuesFor(f.path);
                  const worst = issues.some((i) => i.severity === "error") ? "error" : issues.some((i) => i.severity === "warning") ? "warning" : null;
                  return (
                    <button key={f.path} type="button" className="bld-file" aria-current={f.path === path ? "true" : undefined} onClick={() => setPath(f.path)} title={f.path}>
                      <span className="bld-file-name">{fileName(f.path)}</span>
                      {drafts[f.path] !== undefined && drafts[f.path] !== f.source && <span className="bld-file-dot" role="img" aria-label="Unsaved changes" />}
                      {worst && (worst === "error" ? <CircleAlert size={12} className="bld-file-issue error" aria-label={`${issues.length} issues`} /> : <TriangleAlert size={12} className="bld-file-issue warning" aria-label={`${issues.length} issues`} />)}
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="bld-code-pane">
          {file && (
            <>
              <div className="bld-code-bar">
                <span className="bld-code-path" title={file.path}>
                  {file.path.replace(/^lwc\//, "")}
                </span>
                <span className="bld-composer-spacer" />
                {error && <span className="bld-code-error">{error}</span>}
                {dirty.length > 0 && (
                  <button type="button" className="studio-btn sm" onClick={() => setDrafts({})} disabled={saving}>
                    Discard
                  </button>
                )}
                <button type="button" className="studio-btn sm primary" disabled={!dirty.length || saving || !isCurrent} onClick={save}>
                  {saving ? <Spinner size={14} /> : <Save size={14} aria-hidden="true" />}
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
              <Editor key={file.path} file={file} source={source} issues={issuesFor(file.path)} readOnly={!isCurrent} focusLine={focus?.path === file.path ? { line: focus.line, nonce: focus.nonce } : undefined} onChange={(s) => setDrafts((d) => ({ ...d, [file.path]: s }))} onSave={save} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const LINE_HEIGHT = 20;

function Editor({ file, source, issues, readOnly, focusLine, onChange, onSave }: { file: AppFile; source: string; issues: AppIssue[]; readOnly: boolean; focusLine?: { line?: number; nonce: number }; onChange: (s: string) => void; onSave: () => void }) {
  const lines = useMemo(() => highlight(source, langOf(file.path)), [source, file.path]);
  const scroller = useRef<HTMLDivElement>(null);
  const widest = useMemo(() => source.split("\n").reduce((m, l) => Math.max(m, l.replace(/\t/g, "  ").length), 0), [source]);
  const byLine = useMemo(() => {
    const m = new Map<number, AppIssue[]>();
    for (const i of issues) if (i.line) m.set(i.line, [...(m.get(i.line) ?? []), i]);
    return m;
  }, [issues]);
  const [flash, setFlash] = useState<number | null>(null);

  useEffect(() => {
    const line = focusLine?.line;
    if (!line || !scroller.current) return;
    scroller.current.scrollTop = Math.max(0, (line - 4) * LINE_HEIGHT);
    setFlash(line);
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [focusLine?.nonce, focusLine?.line]);

  return (
    <div className="bld-editor" ref={scroller}>
      <div className="bld-editor-inner" style={{ height: lines.length * LINE_HEIGHT + 16 }}>
        <div className="bld-gutter" aria-hidden="true">
          {lines.map((_, n) => {
            const here = byLine.get(n + 1);
            const tone = here?.some((i) => i.severity === "error") ? "error" : here?.some((i) => i.severity === "warning") ? "warning" : here ? "info" : "";
            return (
              <div key={n} className={`bld-gutter-line ${tone}`} title={here?.map((i) => i.message).join("\n")}>
                {n + 1}
              </div>
            );
          })}
        </div>
        <div className="bld-editor-text" style={{ minWidth: `calc(${widest + 4}ch)` }}>
          <pre className="bld-hl" aria-hidden="true">
            {lines.map((toks, n) => {
              const here = byLine.get(n + 1);
              const tone = here?.some((i) => i.severity === "error") ? "error" : here?.some((i) => i.severity === "warning") ? "warning" : here ? "info" : "";
              return (
                <div key={n} className={`bld-hl-line ${tone}${flash === n + 1 ? " flash" : ""}`}>
                  {toks.length ? toks.map((t, k) => (t.cls ? <span key={k} className={`tok-${t.cls}`}>{t.text}</span> : <React.Fragment key={k}>{t.text}</React.Fragment>)) : " "}
                </div>
              );
            })}
          </pre>
          <textarea
            className="bld-ta"
            value={source}
            readOnly={readOnly}
            spellCheck={false}
            wrap="off"
            aria-label={`Source of ${fileName(file.path)}`}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                onSave();
              } else if (e.key === "Tab" && !readOnly) {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: a, selectionEnd: b } = el;
                onChange(source.slice(0, a) + "  " + source.slice(b));
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
