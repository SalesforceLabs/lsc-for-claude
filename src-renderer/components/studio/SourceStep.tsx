import React, { useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, FolderGit2, RotateCw } from "lucide-react";
import Spinner from "../ui/Spinner";
import { useSourceControl } from "../../hooks/useSourceControl";
import { savedSummary, sourceDocs, type SourceExportResult } from "./source-control";
import type { StudioFix } from "./types";
import "./source-control.css";

type Save =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; result: SourceExportResult; docs: string }
  | { state: "error"; message: string };

/** What a save left for the user to do, for the saved step's tooltip. */
function savedDetail(result: SourceExportResult): string {
  const lines = result.files.map((f) => f.path + (f.status === "merged" ? " (layout assignments merged)" : ""));
  if (result.toRemove.length) lines.push("", "Deleted in the org — delete from source too:", ...result.toRemove.map((r) => r.path));
  if (result.missing.length) lines.push("", "Not found in the org:", ...result.missing.map((m) => `${m.type} ${m.fullName}`));
  if (result.orgOnly.length) lines.push("", "Org only, no source file:", ...result.orgOnly.map((o) => o.label));
  if (result.manifest) lines.push("", `Manifest: ${result.manifest}`);
  return lines.join("\n");
}

/**
 * The release bar's source-control step, for orgs deployed from Git: how many source files
 * the applied changes touch, and **Save as source files…** to write the org's versions into
 * the project. Draws nothing for orgs not deployed from source control or with nothing to save.
 */
export default function SourceStep({ changes }: { changes: StudioFix[] }) {
  const { deployed, reload } = useSourceControl();
  const docs = useMemo(() => sourceDocs(changes), [changes]);
  const docsKey = docs.join("\n");
  const [save, setSave] = useState<Save>({ state: "idle" });

  // New changes after a save need saving again.
  useEffect(() => {
    setSave((s) => (s.state === "saved" && s.docs !== docsKey ? { state: "idle" } : s));
  }, [docsKey]);

  if (!deployed || docs.length === 0) return null;

  const run = async () => {
    setSave({ state: "saving" });
    try {
      const res = await window.lscApi.studioExportSource(changes);
      if (res.canceled) setSave({ state: "idle" });
      else if (res.error || !res.data) setSave({ state: "error", message: res.error ?? "Nothing came back." });
      else setSave({ state: "saved", result: res.data, docs: docsKey });
      reload();
    } catch (err) {
      setSave({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const n = docs.length;
  const files = `${n} ${n === 1 ? "file" : "files"}`;

  if (save.state === "saving") {
    return (
      <div className="release-step-root source-step" role="status">
        <span className="source-step-label">
          <Spinner size={12} />
          Saving source files…
        </span>
      </div>
    );
  }

  if (save.state === "saved") {
    const summary = savedSummary(save.result);
    const left = save.result.toRemove.length + save.result.missing.length;
    return (
      <div className="release-step-root source-step">
        <span className="source-step-label" title={savedDetail(save.result)}>
          <CircleCheck size={14} aria-hidden="true" className="source-step-done" />
          <span className="source-step-text">{summary}</span>
          {left > 0 && <span className="ui-pill warning">{left} to check</span>}
        </span>
        <button type="button" className="studio-btn ghost sm" onClick={run}>
          Save again…
        </button>
      </div>
    );
  }

  return (
    <div className="release-step-root source-step">
      <span
        className="source-step-label"
        title={save.state === "error" ? save.message : "Applied in the org but not in your project's source files yet"}
      >
        {save.state === "error" ? (
          <CircleAlert size={14} aria-hidden="true" className="source-step-failed" />
        ) : (
          <FolderGit2 size={14} aria-hidden="true" />
        )}
        <span className="source-step-text">
          {save.state === "error" ? "Couldn't save source files" : `Not in source control · ${files}`}
        </span>
      </span>
      <button type="button" className="studio-btn sm" onClick={run}>
        {save.state === "error" ? (
          <>
            <RotateCw aria-hidden="true" /> Retry
          </>
        ) : (
          "Save as source files…"
        )}
      </button>
    </div>
  );
}
