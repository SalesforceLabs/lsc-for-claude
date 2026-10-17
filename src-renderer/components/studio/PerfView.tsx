import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AssessmentResult, PerfJobStatus, PerfPlan } from "./perf-types";
import type { ProfileOption } from "./types";
import type { PerfPlanRecord, PerfRunRecord } from "../../types";
import { emptyPlan, normalizePlan, planFileName, planToYaml, remediationPrompt, validatePlan } from "./perf-plan";
import PlanEditor from "./PlanEditor";
import RunReport from "./RunReport";

interface PerfViewProps {
  onAskClaude: (prompt: string) => void;
}

/** The run in flight, kept so polling resumes if the view is left and reopened. */
const ACTIVE_JOB_KEY = "lsc.studio.perfJob";
const POLL_MS = 3000;

interface ActiveJob {
  jobId: string;
  planId: string;
  planName: string;
}

type Selection = { kind: "plan"; id: string } | { kind: "draft" };
type RunView = { id: string; result: AssessmentResult; previous: AssessmentResult | null };

const responseError = (res: { error?: string; data?: { error?: string } }) => res.error || res.data?.error;

function readActiveJob(): ActiveJob | null {
  try {
    const raw = localStorage.getItem(ACTIVE_JOB_KEY);
    return raw ? (JSON.parse(raw) as ActiveJob) : null;
  } catch {
    return null;
  }
}

function elapsed(from: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function PerfView({ onAskClaude }: PerfViewProps) {
  const [plans, setPlans] = useState<PerfPlanRecord[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<PerfPlan>(emptyPlan);
  const [dirty, setDirty] = useState(false);
  const [runs, setRuns] = useState<PerfRunRecord[]>([]);
  const [runView, setRunView] = useState<RunView | null>(null);
  const [tab, setTab] = useState<"plan" | "report">("plan");
  const [job, setJob] = useState<PerfJobStatus | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(readActiveJob);
  // Set from the click until the engine hands back a job id; the org connection check takes seconds.
  const [starting, setStarting] = useState<Omit<ActiveJob, "jobId"> | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  // Bumped to remount the editor when a different plan is loaded.
  const [editorKey, setEditorKey] = useState(0);
  const [, tick] = useState(0);

  const selectedPlan = selection?.kind === "plan" ? plans.find((p) => p.id === selection.id) : undefined;
  const inFlight = activeJob ?? starting;
  const running = !!inFlight;

  const loadPlans = useCallback(async () => {
    const list = await window.lscApi.perfListPlans();
    setPlans(list);
    return list;
  }, []);

  const loadRuns = useCallback(async (planId: string) => {
    const list = await window.lscApi.perfListRuns(planId);
    setRuns(list);
    return list;
  }, []);

  const openRun = useCallback(async (list: PerfRunRecord[], id: string) => {
    const index = list.findIndex((r) => r.id === id);
    const [run, prev] = await Promise.all([
      window.lscApi.perfGetRun(id),
      index >= 0 && list[index + 1] ? window.lscApi.perfGetRun(list[index + 1].id) : Promise.resolve(null),
    ]);
    if (!run?.result) return;
    setRunView({ id, result: run.result as AssessmentResult, previous: (prev?.result as AssessmentResult | undefined) ?? null });
    setTab("report");
  }, []);

  const openPlan = useCallback(
    async (record: PerfPlanRecord) => {
      setSelection({ kind: "plan", id: record.id });
      setDraft(record.plan as PerfPlan);
      setDirty(false);
      setRunView(null);
      setTab("plan");
      setNotice(null);
      setEditorKey((k) => k + 1);
      await loadRuns(record.id);
    },
    [loadRuns]
  );

  const openDraft = (plan: PerfPlan) => {
    setSelection({ kind: "draft" });
    setDraft(plan);
    setDirty(true);
    setRuns([]);
    setRunView(null);
    setTab("plan");
    setEditorKey((k) => k + 1);
  };

  useEffect(() => {
    loadPlans().then((list) => {
      const active = readActiveJob();
      const first = (active && list.find((p) => p.id === active.planId)) || list[0];
      if (first) openPlan(first);
      else openDraft(emptyPlan());
    });
    window.lscApi.studioListProfiles().then((res) => {
      if (Array.isArray(res.data)) setProfiles(res.data as ProfileOption[]);
    });
  }, [loadPlans, openPlan]);

  const finishJob = useCallback(
    async (status: PerfJobStatus, active: ActiveJob) => {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      setActiveJob(null);
      if (status.state === "done" && status.result) {
        const saved = await window.lscApi.perfSaveRun({
          planId: active.planId,
          planName: active.planName,
          status: status.result.status,
          startedAt: status.startedAt,
          finishedAt: status.finishedAt ?? new Date().toISOString(),
          result: status.result,
        });
        setNotice(null);
        if (selection?.kind === "plan" && selection.id === active.planId) {
          const list = await loadRuns(active.planId);
          await openRun(list, saved.id);
        }
      } else if (status.state === "failed") {
        setNotice({ kind: "error", text: `Run failed: ${status.error ?? "unknown error"}` });
      } else if (status.state === "cancelled") {
        setNotice({ kind: "info", text: "Run cancelled." });
      }
    },
    [selection, loadRuns, openRun]
  );

  // Poll the run while one is active; the engine holds the job, this view only watches it.
  const finishRef = useRef(finishJob);
  finishRef.current = finishJob;
  useEffect(() => {
    if (!activeJob) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const res = await window.lscApi.studioPerfStatus(activeJob.jobId);
      if (stopped) return;
      const error = responseError(res);
      if (error) {
        localStorage.removeItem(ACTIVE_JOB_KEY);
        setActiveJob(null);
        setJob(null);
        setNotice({ kind: "error", text: error });
        return;
      }
      const status = res.data as PerfJobStatus;
      setJob(status);
      if (status.state === "running") timer = setTimeout(poll, POLL_MS);
      else await finishRef.current(status, activeJob);
    };
    poll();
    // Elapsed time ticks between polls.
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(clock);
    };
  }, [activeJob]);

  const editDraft = (plan: PerfPlan) => {
    setDraft(plan);
    setDirty(true);
  };

  const save = async (): Promise<PerfPlanRecord | null> => {
    const plan = normalizePlan(draft);
    const record = await window.lscApi.perfSavePlan({
      id: selectedPlan?.id,
      name: plan.name,
      plan,
    });
    await loadPlans();
    setSelection({ kind: "plan", id: record.id });
    setDraft(plan);
    setDirty(false);
    return record;
  };

  const issues = validatePlan(draft);

  const run = async () => {
    if (issues.length) {
      setTab("plan");
      return;
    }
    setNotice(null);
    setJob(null);
    setStarting({ planId: selectedPlan?.id ?? "", planName: normalizePlan(draft).name });
    try {
      const record = await save();
      if (!record) return;
      setStarting({ planId: record.id, planName: record.name });
      await loadRuns(record.id);
      const res = await window.lscApi.studioPerfStart(record.plan);
      const error = responseError(res);
      if (error) {
        setNotice({ kind: "error", text: error });
        return;
      }
      const status = res.data as PerfJobStatus;
      const active = { jobId: status.jobId, planId: record.id, planName: record.name };
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(active));
      setJob(status);
      setActiveJob(active);
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setStarting(null);
    }
  };

  const cancel = async () => {
    if (!activeJob) return;
    const res = await window.lscApi.studioPerfCancel(activeJob.jobId);
    if (!responseError(res)) setJob(res.data as PerfJobStatus);
  };

  const importYaml = async () => {
    const file = await window.lscApi.perfOpenFile();
    if (file.canceled || file.text === undefined) return;
    const res = await window.lscApi.studioPerfParsePlan(file.text);
    const error = responseError(res);
    if (error) {
      setNotice({ kind: "error", text: `Couldn't import: ${error}` });
      return;
    }
    setNotice(null);
    openDraft(res.data as PerfPlan);
  };

  const exportYaml = async () => {
    const res = await window.lscApi.perfSaveFile(planFileName(draft, "yaml"), planToYaml(draft), "yaml");
    if (!res.canceled && res.path) setNotice({ kind: "info", text: `Saved ${res.path}` });
  };

  const exportRun = async () => {
    if (!runView) return;
    const name = planFileName({ ...draft, name: `${runView.result.profile} ${runView.result.generatedAt.slice(0, 10)}` }, "json");
    const res = await window.lscApi.perfSaveFile(name, JSON.stringify(runView.result, null, 2), "json");
    if (!res.canceled && res.path) setNotice({ kind: "info", text: `Saved ${res.path}` });
  };

  const removePlan = async () => {
    if (!selectedPlan || !window.confirm(`Delete “${selectedPlan.name}” and its run history?`)) return;
    await window.lscApi.perfDeletePlan(selectedPlan.id);
    const list = await loadPlans();
    if (list[0]) openPlan(list[0]);
    else openDraft(emptyPlan());
  };

  const removeRun = async (id: string) => {
    if (!selectedPlan) return;
    await window.lscApi.perfDeleteRun(id);
    const list = await loadRuns(selectedPlan.id);
    if (runView?.id === id) {
      setRunView(null);
      if (list[0]) openRun(list, list[0].id);
      else setTab("plan");
    }
  };

  const confirmLeave = () => !dirty || window.confirm("Discard unsaved changes to this plan?");

  return (
    <div className="studio-perf">
      <aside className="studio-perf-sidebar">
        <div className="studio-perf-sidebar-header">
          <div className="studio-rail-title">Test plans</div>
          <button
            className="studio-icon-btn"
            title="New plan"
            aria-label="New plan"
            disabled={running}
            onClick={() => confirmLeave() && openDraft(emptyPlan())}
          >
            +
          </button>
        </div>
        {selection?.kind === "draft" && <div className="studio-rail-item active">{draft.name || "Untitled plan"} (unsaved)</div>}
        {plans.map((p) => (
          <button
            key={p.id}
            className={`studio-rail-item${selection?.kind === "plan" && selection.id === p.id ? " active" : ""}`}
            disabled={running}
            onClick={() => confirmLeave() && openPlan(p)}
          >
            {p.name}
          </button>
        ))}

        {selectedPlan && (
          <>
            <div className="studio-rail-title studio-perf-runs-title">Runs</div>
            {inFlight?.planId === selectedPlan.id && (
              <div className="studio-perf-run-item active" title={job?.step ?? "Connecting to the org"}>
                <span className="studio-perf-run-open">
                  <span className="studio-spinner studio-perf-run-spinner" />
                  <span>Running · {job ? elapsed(job.startedAt) : "starting"}</span>
                </span>
              </div>
            )}
            {runs.length === 0 && inFlight?.planId !== selectedPlan.id && <div className="studio-perf-hint">No runs yet.</div>}
            {runs.map((r) => (
              <div key={r.id} className={`studio-perf-run-item${runView?.id === r.id ? " active" : ""}`}>
                <button className="studio-perf-run-open" onClick={() => openRun(runs, r.id)}>
                  <span className={`studio-sev-dot studio-perf-dot ${r.status}`} />
                  <span>{new Date(r.startedAt).toLocaleString()}</span>
                </button>
                <button className="studio-chip-x" title="Delete run" aria-label="Delete run" onClick={() => removeRun(r.id)}>
                  ×
                </button>
              </div>
            ))}
          </>
        )}
      </aside>

      <div className="studio-perf-main">
        <div className="studio-perf-toolbar">
          <div className="studio-ipad-mode" role="tablist">
            <button
              role="tab"
              className={`studio-btn${tab === "plan" ? " active" : ""}`}
              aria-selected={tab === "plan"}
              onClick={() => setTab("plan")}
            >
              Plan
            </button>
            <button
              role="tab"
              className={`studio-btn${tab === "report" ? " active" : ""}`}
              aria-selected={tab === "report"}
              disabled={!runView}
              onClick={() => setTab("report")}
            >
              Report
            </button>
          </div>
          <div className="studio-header-actions">
            <button className="studio-btn" onClick={importYaml} disabled={running} title="Load a plan from an NFR profile YAML file">
              Import YAML
            </button>
            <button className="studio-btn" onClick={exportYaml} title="Save as YAML for run_perf_assessment or CI">
              Export YAML
            </button>
            {selectedPlan && (
              <button className="studio-btn" onClick={removePlan} disabled={running}>
                Delete
              </button>
            )}
            <button className="studio-btn" onClick={save} disabled={running || !dirty}>
              Save
            </button>
            <button
              className="studio-btn primary"
              onClick={run}
              disabled={running || issues.length > 0}
              title={issues.length ? issues.join("\n") : "Save the plan and run it against the connected org"}
            >
              Run test
            </button>
          </div>
        </div>

        {inFlight && (
          <div className="studio-finding info studio-perf-progress">
            <div className="studio-spinner" />
            <div className="studio-perf-progress-text">
              <div className="studio-finding-title">Running “{inFlight.planName}”</div>
              <div className="studio-finding-detail">
                {job ? `${job.step} · ${job.queries} queries · ${elapsed(job.startedAt)}` : "Connecting to the org…"}
              </div>
            </div>
            <button className="studio-btn" onClick={cancel} disabled={!activeJob || job?.step === "Cancelling…"}>
              Cancel
            </button>
          </div>
        )}
        {notice && <div className={`studio-finding ${notice.kind === "error" ? "error" : "info"} studio-perf-notice`}>{notice.text}</div>}

        <div className="studio-perf-body">
          {tab === "report" && runView ? (
            <RunReport
              result={runView.result}
              previous={runView.previous}
              onAskClaude={() => onAskClaude(remediationPrompt(runView.result))}
              onExport={exportRun}
            />
          ) : (
            <>
              {issues.length > 0 && (
                <div className="studio-finding warning studio-perf-notice">
                  <div className="studio-finding-title">Before this plan can run</div>
                  <ul className="studio-perf-issues">
                    {issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              )}
              <PlanEditor
                key={editorKey}
                plan={draft}
                onChange={editDraft}
                profiles={profiles}
                disabled={running}
              />
              <details className="studio-perf-yaml">
                <summary>YAML</summary>
                <pre>{safeYaml(draft)}</pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The plan as run_perf_assessment reads it. */
function safeYaml(plan: PerfPlan): string {
  try {
    return planToYaml(plan);
  } catch (err) {
    return `# ${err instanceof Error ? err.message : String(err)}`;
  }
}
