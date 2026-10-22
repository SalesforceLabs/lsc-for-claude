import React, { useEffect, useState } from "react";
import StateView from "../../ui/StateView";
import AppWorkspace from "./AppWorkspace";
import Gallery from "./Gallery";
import { useAppProjects } from "./useAppProjects";
import type { AppProject } from "./types";
import "./builder.css";

interface AppsViewProps {
  onAddToIpad: (project: AppProject) => void;
  /** Whether an app's workspace is open, so Studio can fold its rail to give the preview room. */
  onWorkspace?: (open: boolean) => void;
}

/** Build → LSC apps: the gallery of the org's apps, and a workspace for the one being built. Stays mounted so a build keeps streaming. */
export default function AppsView({ onAddToIpad, onWorkspace }: AppsViewProps) {
  const store = useAppProjects();
  const [openId, setOpenId] = useState<string | null>(null);
  const project = store.projects.find((p) => p.id === openId);

  // Org switch or a deleted project: back to the gallery.
  useEffect(() => {
    if (openId && store.state.status === "ready" && !project) setOpenId(null);
  }, [openId, project, store.state.status]);

  useEffect(() => onWorkspace?.(!!project), [project, onWorkspace]);

  return (
    <div className="bld-root">
      {project ? (
        <AppWorkspace key={project.id} store={store} project={project} onBack={() => setOpenId(null)} onAddToIpad={onAddToIpad} />
      ) : openId && store.state.status === "loading" ? (
        <StateView kind="loading" title="Opening the app" />
      ) : (
        <Gallery store={store} onOpen={setOpenId} />
      )}
    </div>
  );
}
