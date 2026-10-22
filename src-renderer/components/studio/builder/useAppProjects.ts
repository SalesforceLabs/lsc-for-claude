import { useCallback, useEffect, useRef, useState } from "react";
import { useSelectedOrgId } from "../../../hooks/useOrgs";
import { builderApi } from "./api";
import { applyEvent } from "./logic";
import type { AppBuilderEvent, AppProject } from "./types";

export interface WritingNote {
  turnId: string;
  path: string;
  chars: number;
}

export type ProjectsState = { status: "loading" } | { status: "error"; error: string } | { status: "ready" };

/**
 * The selected org's builder projects, kept current by the main process's events. One subscription
 * for the life of the view, so a build keeps streaming while another Studio section is shown.
 */
export function useAppProjects() {
  const org = useSelectedOrgId();
  const [projects, setProjects] = useState<AppProject[]>([]);
  const [state, setState] = useState<ProjectsState>({ status: "loading" });
  const [writing, setWriting] = useState<Record<string, WritingNote | undefined>>({});
  const known = useRef(new Set<string>());

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const list = await builderApi().appList();
      known.current = new Set(list.map((p) => p.id));
      setProjects(list);
      setState({ status: "ready" });
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    setProjects([]);
    void load();
  }, [org, load]);

  useEffect(() => {
    return builderApi().onAppEvent(({ projectId, event }: { projectId: string; event: AppBuilderEvent }) => {
      if (event.type === "writing") {
        setWriting((w) => ({ ...w, [projectId]: { turnId: event.turnId, path: event.path, chars: event.chars } }));
        return;
      }
      if (event.type === "version" || event.type === "step" || event.type === "turn") setWriting((w) => (w[projectId] ? { ...w, [projectId]: undefined } : w));
      setProjects((list) => {
        if (event.type === "project") return list.some((p) => p.id === projectId) ? list.map((p) => (p.id === projectId ? event.project : p)) : [event.project, ...list];
        // Events for a project this window hasn't been handed yet are covered by the snapshot it gets.
        return list.map((p) => (p.id === projectId ? applyEvent(p, event) : p));
      });
    });
  }, []);

  const put = useCallback((project: AppProject) => {
    known.current.add(project.id);
    setProjects((list) => (list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? project : p)) : [project, ...list]));
  }, []);

  const refreshOne = useCallback(
    async (id: string) => {
      const p = await builderApi().appGet(id);
      if (p) put(p);
    },
    [put]
  );

  const remove = useCallback(async (id: string) => {
    await builderApi().appDelete(id);
    setProjects((list) => list.filter((p) => p.id !== id));
  }, []);

  const rename = useCallback(async (id: string, label: string) => {
    setProjects((list) => list.map((p) => (p.id === id ? { ...p, label } : p)));
    await builderApi().appRename(id, label);
  }, []);

  return { projects, state, writing, reload: load, put, refreshOne, remove, rename };
}

export type AppProjectsStore = ReturnType<typeof useAppProjects>;
