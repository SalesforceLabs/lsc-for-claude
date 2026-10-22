import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  FileQuestion,
  FileText,
  Folder,
  RefreshCw,
  Search,
} from "lucide-react";
import StateView from "../ui/StateView";
import Spinner from "../ui/Spinner";
import Segmented from "../ui/Segmented";
import JsonTree from "../ui/JsonTree";
import { Limited } from "../ui/Limited";
import { Callout } from "./PerfParts";
import { formatBytes } from "./sim-types";
import {
  commonDir,
  filterFiles,
  groupFiles,
  formatWhen,
  parseJson,
  type CacheContents,
  type CacheFileText,
} from "./metadata-cache-types";

/** Raw text drawn at most; the rest is in the ZIP. */
const RAW_CHARS = 400_000;

type Load<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

/** One cache ZIP: its files, one opened as JSON or text, and Download ZIP. */
export default function CacheContentsView({
  recordId,
  label,
  onBack,
}: {
  recordId: string;
  label: string;
  onBack: () => void;
}) {
  const [load, setLoad] = useState<Load<CacheContents>>({ status: "loading" });
  const [file, setFile] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ tone: "pass" | "error"; text: string } | null>(null);

  const read = async () => {
    setLoad({ status: "loading" });
    const res = await window.lscApi.studioMetadataCacheContents(recordId);
    if (res.error || !res.data)
      setLoad({ status: "error", error: res.error || "Studio couldn't open this cache." });
    else {
      const data = res.data as CacheContents;
      setLoad({ status: "ready", data });
      setFile(
        (f) =>
          f ?? data.files.find((x) => x.path.endsWith(".json"))?.path ?? data.files[0]?.path ?? null
      );
    }
  };

  useEffect(() => {
    read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  const save = async () => {
    setSaving(true);
    setSaveNote(null);
    const res = await window.lscApi.studioSaveMetadataCache(recordId);
    setSaving(false);
    if (res.error) setSaveNote({ tone: "error", text: res.error });
    else if (!res.canceled && res.path) setSaveNote({ tone: "pass", text: `Saved to ${res.path}` });
  };

  const data = load.status === "ready" ? load.data : null;
  const root = useMemo(() => (data ? commonDir(data.files.map((f) => f.path)) : ""), [data]);
  const groups = useMemo(
    () => (data ? groupFiles(filterFiles(data.files, filter), root) : []),
    [data, filter, root]
  );

  let body: React.ReactNode;
  if (load.status === "loading") {
    body = (
      <StateView
        kind="loading"
        layout="inline"
        title="Downloading the cache…"
        detail="The first time takes a moment: Studio downloads the ZIP from Salesforce, then keeps the last few on this Mac."
      />
    );
  } else if (load.status === "error") {
    body = (
      <StateView
        kind="error"
        layout="inline"
        title="Couldn't open this cache"
        detail={load.error}
        actions={
          <button type="button" className="studio-btn" onClick={read}>
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </button>
        }
      />
    );
  } else if (data && data.files.length === 0) {
    body = (
      <StateView
        kind="empty"
        layout="inline"
        icon={FileQuestion}
        title="This cache is empty"
        detail="The ZIP has no files in it."
      />
    );
  } else if (data) {
    body = (
      <div className="mc-browser">
        <div className="mc-files">
          <label className="mc-filter">
            <Search size={14} aria-hidden="true" />
            <input
              className="studio-input"
              placeholder="Filter files"
              aria-label="Filter files"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="mc-file-list" role="listbox" aria-label="Files">
            {groups.length === 0 ? (
              <div className="studio-perf-hint mc-file-none">No file matches.</div>
            ) : (
              groups.map((g) => (
                <div key={g.folder} role="group" aria-label={g.folder || "Top level"}>
                  {g.folder && (
                    <div className="mc-folder mc-ellipsis" title={`${root}${g.folder}`}>
                      <Folder size={14} aria-hidden="true" />
                      <span className="mc-ellipsis">{g.folder}</span>
                    </div>
                  )}
                  <Limited
                    items={g.files}
                    render={({ file: f, name }) => (
                      <button
                        key={f.path}
                        type="button"
                        role="option"
                        aria-selected={f.path === file}
                        className={`mc-file${g.folder ? " nested" : ""}${f.path === file ? " active" : ""}`}
                        onClick={() => setFile(f.path)}
                        title={f.path}
                      >
                        <FileText size={16} aria-hidden="true" />
                        <span className="mc-ellipsis">{name}</span>
                        <span className="mc-file-size">{formatBytes(f.size)}</span>
                      </button>
                    )}
                  />
                </div>
              ))
            )}
          </div>
        </div>
        <div className="mc-viewer">
          {file ? (
            <FileViewer key={file} recordId={recordId} path={file} name={file.slice(root.length)} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="studio-page mc-page mc-contents ui-enter">
      <nav className="mc-crumbs" aria-label="Breadcrumb">
        <button type="button" className="studio-link-btn" onClick={onBack}>
          Metadata cache
        </button>
        <ChevronRight size={14} aria-hidden="true" />
        <span aria-current="page" className="mc-ellipsis">
          {data?.profile ?? label}
        </span>
      </nav>
      <header className="studio-page-head">
        <div>
          <h2>{data?.profile ?? "Cache contents"}</h2>
          <p className="mc-ellipsis" title={data?.name}>
            {data
              ? [
                  `Published ${formatWhen(data.generatedAt)}`,
                  `${data.files.length} files`,
                  data.sizeBytes != null ? `${formatBytes(data.sizeBytes)} download` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "What its iPads download, file by file."}
          </p>
        </div>
        <div className="studio-page-actions">
          <button type="button" className="studio-btn" onClick={save} disabled={!data || saving}>
            {saving ? <Spinner size={14} /> : <Download size={14} aria-hidden="true" />}
            Download ZIP…
          </button>
        </div>
      </header>
      {saveNote && <Callout tone={saveNote.tone}>{saveNote.text}</Callout>}
      {body}
    </div>
  );
}

function FileViewer({ recordId, path, name }: { recordId: string; path: string; name: string }) {
  const [load, setLoad] = useState<Load<CacheFileText>>({ status: "loading" });
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const ticket = useRef(0);

  const read = async () => {
    const mine = ++ticket.current;
    setLoad({ status: "loading" });
    const res = await window.lscApi.studioMetadataCacheFile(recordId, path);
    if (ticket.current !== mine) return;
    if (res.error || !res.data)
      setLoad({ status: "error", error: res.error || "Studio couldn't read this file." });
    else setLoad({ status: "ready", data: res.data as CacheFileText });
  };

  useEffect(() => {
    read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, path]);

  const data = load.status === "ready" ? load.data : null;
  const json = useMemo(
    () =>
      data?.kind === "text" && !data.truncated ? parseJson(data.text) : { ok: false as const },
    [data]
  );

  if (load.status === "loading") return <StateView kind="loading" title={`Reading ${name}…`} />;
  if (load.status === "error" || !data) {
    return (
      <StateView
        kind="error"
        title="Couldn't read this file"
        detail={load.status === "error" ? load.error : undefined}
        actions={
          <button type="button" className="studio-btn" onClick={read}>
            <RefreshCw size={14} aria-hidden="true" />
            Retry
          </button>
        }
      />
    );
  }
  if (data.kind === "image") {
    return (
      <div className="mc-image">
        <img src={data.image} alt={name} />
      </div>
    );
  }
  if (data.kind === "binary") {
    return (
      <StateView
        kind="empty"
        icon={FileQuestion}
        title="Not a text file"
        detail="Download the ZIP to open it in another app."
      />
    );
  }
  const raw = data.text.length > RAW_CHARS ? data.text.slice(0, RAW_CHARS) : data.text;
  return (
    <div className="mc-file-view">
      <div className="mc-file-bar">
        <span className="mc-file-path" title={path}>
          {name.includes("/") && (
            <span className="mc-file-dir">{name.slice(0, name.lastIndexOf("/") + 1)}</span>
          )}
          {name.slice(name.lastIndexOf("/") + 1)}
        </span>
        <span className="studio-perf-meta">{formatBytes(data.size)}</span>
        {json.ok && (
          <Segmented
            size="sm"
            aria-label="Show as"
            value={mode}
            onChange={setMode}
            options={[
              { value: "tree", label: "Tree" },
              { value: "raw", label: "Text" },
            ]}
          />
        )}
      </div>
      {(data.truncated || (!(json.ok && mode === "tree") && raw.length < data.text.length)) && (
        <div className="mc-cut">
          This file is large, so only its beginning is shown. Download the ZIP for all of it.
        </div>
      )}
      <div className="mc-file-body">
        {json.ok && mode === "tree" ? (
          <JsonTree value={json.value} openDepth={2} />
        ) : (
          <pre className="mc-raw">{raw}</pre>
        )}
      </div>
    </div>
  );
}
