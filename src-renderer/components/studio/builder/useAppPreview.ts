import { useCallback, useEffect, useState } from "react";
import { builderApi } from "./api";
import type { AppCheckResult } from "./types";

export type PreviewState =
  | { status: "loading" }
  | { status: "ready"; script: string; placeholders: string[]; check?: AppCheckResult }
  | { status: "broken"; check?: AppCheckResult; error?: string }
  | { status: "error"; error: string };

/** The compiled script for one version of a project, and a way to read it again. */
export function useAppPreview(projectId: string, versionId: string | null) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!versionId) return;
    let live = true;
    setState({ status: "loading" });
    builderApi()
      .appPreview(projectId, versionId)
      .then(
        (r) => {
          if (!live) return;
          if (r.script) setState({ status: "ready", script: r.script, placeholders: r.placeholders ?? [], check: r.check });
          else setState({ status: "broken", check: r.check, error: r.error });
        },
        (e: unknown) => live && setState({ status: "error", error: e instanceof Error ? e.message : String(e) })
      );
    return () => {
      live = false;
    };
  }, [projectId, versionId, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload, nonce };
}
