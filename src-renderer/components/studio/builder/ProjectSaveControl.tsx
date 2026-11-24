import React, { useState } from "react";
import { CircleAlert, FolderGit2, RotateCw, TriangleAlert } from "lucide-react";
import Spinner from "../../ui/Spinner";
import { useSourceControl } from "../../../hooks/useSourceControl";
import { builderApi } from "./api";
import { conflictText, projectSave } from "./project-save";
import type { AppProject } from "./types";

/**
 * The builder header's project step for orgs deployed from source control: whether the
 * current version is in the org's sfdx project, with Save / Replace / Keep mine. Draws
 * nothing for orgs not deployed from source control.
 */
export default function ProjectSaveControl({ project }: { project: AppProject }) {
  const sc = useSourceControl();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const state = projectSave(project, sc);

  if (state.kind === "off") return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(null);
    setOpen(false);
    try {
      await fn();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (replace = false) =>
    run(async () => {
      const r = await builderApi().appSaveToProject(project.id, replace);
      if (r.error) setFailed(r.error);
    });
  const chooseThenSave = () =>
    run(async () => {
      const err = await sc.chooseFolder();
      if (err) return setFailed(err);
      const r = await builderApi().appSaveToProject(project.id);
      // Cancelled the folder picker: nothing to report.
      if (r.error && !/choose the project folder/.test(r.error)) setFailed(r.error);
    });

  if (busy)
    return (
      <span className="bld-project" role="status">
        <Spinner size={12} />
        Saving to project…
      </span>
    );

  if (failed || state.kind === "error")
    return (
      <button type="button" className="studio-btn sm" title={failed ?? (state.kind === "error" ? state.message : "")} onClick={() => (state.kind === "no-folder" ? chooseThenSave() : save())}>
        <CircleAlert size={14} aria-hidden="true" className="bld-project-failed" />
        Couldn't save to project
        <RotateCw size={12} aria-hidden="true" />
      </button>
    );

  if (state.kind === "no-folder")
    return (
      <button type="button" className="studio-btn sm" onClick={chooseThenSave} title="Choose the org's sfdx project folder and save this app's files there">
        <FolderGit2 size={14} aria-hidden="true" />
        Save to project…
      </button>
    );

  if (state.kind === "saved")
    return (
      <span className="bld-project" title={state.title}>
        <FolderGit2 size={14} aria-hidden="true" />
        In project
      </span>
    );

  if (state.kind === "unsaved")
    return (
      <button type="button" className="studio-btn sm" onClick={() => save()} title={`Write v${state.version}'s files into the project`}>
        <FolderGit2 size={14} aria-hidden="true" />
        Save to project
      </button>
    );

  return (
    <div className="ui-menu" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}>
      <button type="button" className="studio-btn sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <TriangleAlert size={14} aria-hidden="true" className="bld-project-conflict" />
        Edited in project
      </button>
      {open && (
        <div className="ui-menu-list bld-project-pop" role="dialog" aria-label="Files edited in the project" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <p>{conflictText(state.files)}</p>
          <div className="bld-project-pop-actions">
            <button type="button" className="studio-btn ghost sm" onClick={() => run(() => builderApi().appKeepProjectFiles(project.id))}>
              Keep mine
            </button>
            <button type="button" className="studio-btn sm primary" autoFocus onClick={() => save(true)}>
              Replace with v{state.version}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
