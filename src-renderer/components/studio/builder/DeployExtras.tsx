import React, { useState } from "react";
import { CircleAlert, CircleCheck, FolderGit2, TriangleAlert } from "lucide-react";
import Spinner from "../../ui/Spinner";
import { useSourceControl } from "../../../hooks/useSourceControl";
import { conflictDetail, savedSummary, type SourceExportResult } from "../source-control";
import { deployExtras } from "./project-save";

type Save =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; result: SourceExportResult }
  | { state: "error"; message: string };

/**
 * After a deploy, for orgs deployed from source control: save the quick action, page, tab
 * and app the deploy wrote into the org's project, beside the app's bundles.
 */
export default function DeployExtras({ deployed }: { deployed: string[] }) {
  const sc = useSourceControl();
  const [save, setSave] = useState<Save>({ state: "idle" });
  const { items, profiles } = deployExtras(deployed);
  if (!sc.deployed || (items.length === 0 && profiles.length === 0)) return null;

  const run = async (replace?: string[]) => {
    setSave({ state: "saving" });
    try {
      const r = await window.lscApi.studioExportSource([], items, replace ? { replace } : {});
      if (r.canceled) setSave({ state: "idle" });
      else if (r.error || !r.data) setSave({ state: "error", message: r.error ?? "Nothing came back." });
      else setSave({ state: "saved", result: r.data });
      sc.reload();
    } catch (e) {
      setSave({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const profileNote =
    profiles.length > 0 ? (
      <p className="bld-deploy-extras-note">
        Tab visibility on {profiles.length === 1 ? `the ${profiles[0]} profile` : `${profiles.length} profiles`} isn't saved: Studio doesn't edit profile files for tabs. Add it to your project by hand.
      </p>
    ) : null;

  if (items.length === 0) return <div className="bld-deploy-extras">{profileNote}</div>;

  const n = items.length;
  let body: React.ReactNode;
  if (save.state === "saving")
    body = (
      <span className="bld-deploy-extras-row" role="status">
        <Spinner size={12} />
        Saving to project…
      </span>
    );
  else if (save.state === "saved" && save.result.conflicts?.length) {
    const result = save.result;
    body = (
      <>
        <span className="bld-deploy-extras-row">
          <TriangleAlert size={14} aria-hidden="true" className="bld-project-conflict" />
          {savedSummary(result)}
        </span>
        <p className="bld-deploy-extras-note">{conflictDetail(result)}</p>
        <div className="bld-project-pop-actions">
          <button type="button" className="studio-btn ghost sm" onClick={() => setSave({ state: "saved", result: { ...result, conflicts: [] } })}>
            Keep mine
          </button>
          <button type="button" className="studio-btn sm" onClick={() => run(result.conflicts.map((c) => c.path))}>
            Replace
          </button>
        </div>
      </>
    );
  } else if (save.state === "saved")
    body = (
      <span className="bld-deploy-extras-row" title={save.result.files.map((f) => f.path).join("\n")}>
        <CircleCheck size={14} aria-hidden="true" className="bld-project-done" />
        {savedSummary(save.result)}
      </span>
    );
  else
    body = (
      <span className="bld-deploy-extras-row">
        {save.state === "error" ? <CircleAlert size={14} aria-hidden="true" className="bld-project-failed" /> : <FolderGit2 size={14} aria-hidden="true" />}
        <span className="bld-deploy-extras-text" title={save.state === "error" ? save.message : undefined}>
          {save.state === "error" ? "Couldn't save to the project" : `${n === 1 ? "1 more file isn't" : `${n} more files aren't`} in your project: ${items.map((i) => i.fullName).join(", ")}`}
        </span>
        <button type="button" className="studio-btn sm" onClick={() => run()}>
          {save.state === "error" ? "Retry" : sc.folder ? "Save to project" : "Save to project…"}
        </button>
      </span>
    );

  return (
    <div className="bld-deploy-extras">
      {body}
      {profileNote}
    </div>
  );
}
