import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AssessmentResult, PerfCheckResult, PerfJobStatus, PerfPlan } from "./perf-types";
import type { ProfileOption } from "./types";
import type { MobileLoginInfo, PerfPlanRecord, PerfRunRecord } from "../../types";
import {
  applyBaseline,
  emptyPlan,
  formatValue,
  hasCustomerTargets,
  metricInfo,
  normalizePlan,
  planFileName,
  planToYaml,
  remediationPrompt,
  validatePlan,
} from "./perf-plan";
import { asRunSummary, runSummary, trendRows } from "./perf-history";
import { Download, LogIn, Play, Plus, Trash2, Upload, X } from "lucide-react";
import Segmented from "../ui/Segmented";
import Spinner from "../ui/Spinner";
import { Callout } from "./PerfParts";
import PlanEditor from "./PlanEditor";
import RunReport from "./RunReport";
import { useRunSims } from "./useRunSims";

interface PerfViewProps {
  onAskClaude: (prompt: string) => void;
  /** Reps handed over from Overview; a new key starts a new unsaved plan with them. */
  seed?: { key: number; userIds: string[] } | null;
}

/** The run in flight, kept so polling resumes if the view is left and reopened. */
const ACTIVE_JOB_KEY = "lsc.studio.perfJob";
const POLL_MS = 3000;
/** Consecutive failed status checks before the view stops polling and offers to reconnect. */
const MAX_POLL_FAILURES = 5;
const FLASH_MS = 4000;

interface ActiveJob {
  jobId: string;
  /** Empty when the run was started elsewhere (chat, another window) and attached to here. */
  planId: string;
  planName: string;
}

type Selection = { kind: "plan"; id: string } | { kind: "draft" };
type RunView = { id: string; result: AssessmentResult; previous: AssessmentResult | null };
type CheckIssue = PerfCheckResult["issues"][number];
type Response = { data?: unknown & { error?: string }; error?: string };

const responseError = (res: Response) => res.error || res.data?.error;
const isGone = (error: string) => /no longer available/i.test(error);
const sameOrg = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

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

/** "Persona 1 of 2 · user 2 of 3" from a job's progress. */
function progressLabel(job: PerfJobStatus | null): string {
  const p = job?.progress;
  if (!p) return "";
  const parts = [`Persona ${p.persona} of ${p.personas}`];
  if (p.user && p.users) parts.push(`user ${p.user} of ${p.users}`);
  return parts.join(" · ");
}

function ProgressBar({ job }: { job: PerfJobStatus | null }) {
  const t = job?.progress?.tables;
  if (!t || t.total <= 0) return null;
  const pct = Math.min(100, Math.round((t.done / t.total) * 100));
  return (
    <div
      className="studio-perf-bar"
      role="progressbar"
      aria-valuenow={t.done}
      aria-valuemin={0}
      aria-valuemax={t.total}
      aria-label="Tables counted"
      title={`${t.done} of ${t.total} tables counted`}
    >
      <div className="studio-perf-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

const issueText = (i: CheckIssue) => (i.persona ? `${i.persona}: ${i.message}` : i.message);

export default function PerfView({ onAskClaude, seed }: PerfViewProps) {
  const [plans, setPlans] = useState<PerfPlanRecord[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<PerfPlan>(emptyPlan);
  const [dirty, setDirty] = useState(false);
  // Something was typed or handed in since the plan or draft opened; a fresh draft is dirty (unsaved) but not edited.
  const [edited, setEdited] = useState(false);
  const [runs, setRuns] = useState<PerfRunRecord[]>([]);
  const [runView, setRunView] = useState<RunView | null>(null);
  const [tab, setTab] = useState<"plan" | "report">("plan");
  const [job, setJob] = useState<PerfJobStatus | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(readActiveJob);
  // Set from the click until the engine hands back a job id; the org connection check takes seconds.
  const [starting, setStarting] = useState<Omit<ActiveJob, "jobId"> | null>(null);
  // Polling gave up after repeated failures; the run may still be going on the engine.
  const [lost, setLost] = useState(false);
  const [checking, setChecking] = useState(false);
  // What the org said about the plan's users and territories; cleared on edit.
  const [checkIssues, setCheckIssues] = useState<CheckIssue[]>([]);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  // Logins made through the LSC mobile app; a persona user with one gets an exact table list.
  const [mobileLogins, setMobileLogins] = useState<MobileLoginInfo[]>([]);
  const [mobileLoggingIn, setMobileLoggingIn] = useState(false);
  // Bumped to remount the editor when a different plan is loaded.
  const [editorKey, setEditorKey] = useState(0);
  // The first load has finished, so a hand-off from Overview won't be overwritten by it.
  const [loaded, setLoaded] = useState(false);
  const seededKey = useRef<number | null>(null);
  const [, tick] = useState(0);

  const runSims = useRunSims(runView);
  const selectedPlan = selection?.kind === "plan" ? plans.find((p) => p.id === selection.id) : undefined;
  const inFlight = activeJob ?? starting;
  const running = !!inFlight;

  const flash = useCallback((text: string) => {
    setNotice({ kind: "info", text });
    setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), FLASH_MS);
  }, []);

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
      setEdited(false);
      setRunView(null);
      setTab("plan");
      setNotice(null);
      setCheckIssues([]);
      setEditorKey((k) => k + 1);
      await loadRuns(record.id);
    },
    [loadRuns]
  );

  const openDraft = useCallback((plan: PerfPlan) => {
    setSelection({ kind: "draft" });
    setDraft(plan);
    setDirty(true);
    setEdited(false);
    setRuns([]);
    setRunView(null);
    setTab("plan");
    setCheckIssues([]);
    setEditorKey((k) => k + 1);
  }, []);

  /** Load the connected org's plans and open the one with a run in flight, else the first. */
  const reload = useCallback(async () => {
    const list = await loadPlans();
    const active = readActiveJob();
    const first = (active && list.find((p) => p.id === active.planId)) || list[0];
    if (first) await openPlan(first);
    else openDraft(emptyPlan());
    window.lscApi.mobileLoginList().then((res) => setMobileLogins(res.logins));
    window.lscApi.studioListProfiles().then((res) => {
      setProfiles(Array.isArray(res.data) ? (res.data as ProfileOption[]) : []);
    });
  }, [loadPlans, openPlan, openDraft]);

  /** Watch a run the engine already has (started in chat, or one this view lost track of). */
  const attachActive = useCallback(async (): Promise<boolean> => {
    const res = await window.lscApi.studioPerfActive();
    const current = responseError(res) ? null : (res.data as { job?: PerfJobStatus | null } | undefined)?.job;
    if (!current || current.state !== "running") return false;
    const active: ActiveJob = { jobId: current.jobId, planId: "", planName: "a run started elsewhere" };
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(active));
    setJob(current);
    setLost(false);
    setActiveJob(active);
    return true;
  }, []);

  useEffect(() => {
    reload().then(() => {
      setLoaded(true);
      if (!readActiveJob()) attachActive();
    });
  }, [reload, attachActive]);

  // Plans and runs belong to an org, so switching orgs in Settings swaps the list. A run in flight
  // keeps going against its own org and is filed there when it finishes.
  useEffect(
    () =>
      window.lscApi.onSfOrgChanged((org) => {
        reload().then(() => flash(`Showing test plans for ${org}.`));
      }),
    [reload, flash]
  );

  // Reps handed over from Overview become a new unsaved plan, so nothing already saved is touched.
  useEffect(() => {
    if (!seed || !loaded || seededKey.current === seed.key) return;
    seededKey.current = seed.key;
    const userIds = [...new Set(seed.userIds.map((u) => u.trim()).filter(Boolean))];
    if (!userIds.length) return;
    if (edited && !window.confirm("Discard unsaved changes to this plan?")) {
      setNotice({ kind: "info", text: "The reps from Overview weren't added because you kept your unsaved changes. Save, then send them again." });
      return;
    }
    const plan = emptyPlan();
    openDraft({ ...plan, name: "Reps from Overview", personas: [{ ...plan.personas[0], name: "Reps from Overview", users: userIds }] });
    // Handed-in reps are unsaved work too: a second hand-off asks before replacing them.
    setEdited(true);
    setNotice({
      kind: "info",
      text: `Started a new plan with ${userIds.length} ${userIds.length === 1 ? "rep" : "reps"} from Overview. Add the customer's targets, then run the test.`,
    });
  }, [seed, loaded, edited, openDraft]);

  const plansRef = useRef(plans);
  plansRef.current = plans;

  const finishJob = useCallback(
    async (status: PerfJobStatus, active: ActiveJob) => {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      setActiveJob(null);
      setLost(false);
      if (status.state === "done" && status.result) {
        const result = status.result;
        // A run attached from elsewhere is filed with the saved plan of the same name, if there is one.
        const name = result.profile.trim().toLowerCase();
        const plan = active.planId
          ? { id: active.planId, name: active.planName }
          : plansRef.current.find((p) => p.name.trim().toLowerCase() === name && sameOrg(p.org, status.org));
        if (!plan) {
          setNotice({ kind: "info", text: `A run of “${result.profile}” finished, but no saved plan here has that name, so it wasn't kept.` });
          return;
        }
        const saved = await window.lscApi.perfSaveRun({
          org: status.org,
          planId: plan.id,
          planName: plan.name,
          status: result.status,
          startedAt: status.startedAt,
          finishedAt: status.finishedAt ?? new Date().toISOString(),
          summary: runSummary(result),
          result,
        });
        setNotice(null);
        if (selection?.kind === "plan" && selection.id === plan.id) {
          const list = await loadRuns(plan.id);
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
    if (!activeJob || lost) return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let res: Response;
      try {
        res = await window.lscApi.studioPerfStatus(activeJob.jobId);
      } catch (err) {
        res = { error: err instanceof Error ? err.message : String(err) };
      }
      if (stopped) return;
      // A failed job's status carries its own `error`; only a reply without a state is a failed call.
      const error = (res.data as PerfJobStatus | undefined)?.state ? undefined : responseError(res);
      if (error) {
        if (isGone(error)) {
          localStorage.removeItem(ACTIVE_JOB_KEY);
          setActiveJob(null);
          setJob(null);
          setNotice({ kind: "error", text: error });
          return;
        }
        // Anything else may be a hiccup (engine busy or restarting): back off, and keep the job to reconnect to.
        failures++;
        if (failures >= MAX_POLL_FAILURES) {
          setLost(true);
          return;
        }
        timer = setTimeout(poll, Math.min(POLL_MS * 2 ** failures, 30_000));
        return;
      }
      failures = 0;
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
  }, [activeJob, lost]);

  const editDraft = (plan: PerfPlan) => {
    setDraft(plan);
    setDirty(true);
    setEdited(true);
    setCheckIssues([]);
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
    setEdited(false);
    return record;
  };

  const issues = validatePlan(draft);
  const checkErrors = checkIssues.filter((i) => i.level === "error");
  const checkWarnings = checkIssues.filter((i) => i.level === "warning");
  const loginNames = new Set(mobileLogins.map((l) => l.username.toLowerCase()));
  const loginPersonas = draft.personas.flatMap((p) => {
    const users = p.users.filter((u) => loginNames.has(u.trim().toLowerCase()));
    return users.length ? [`${p.name.trim() || "Persona"} (${users.join(", ")})`] : [];
  });

  /** Look the plan's users and territories up in the org; null when the check itself couldn't run. */
  const checkPlan = async (plan: PerfPlan, planOrg: string | undefined): Promise<CheckIssue[] | null> => {
    setChecking(true);
    try {
      const res = await window.lscApi.studioPerfCheck(normalizePlan(plan));
      const error = responseError(res);
      if (error) {
        setNotice({ kind: "error", text: `Couldn't check the plan: ${error}` });
        return null;
      }
      const check = res.data as PerfCheckResult;
      const found: CheckIssue[] = [...check.issues];
      if (planOrg && check.org && !sameOrg(planOrg, check.org)) {
        found.unshift({
          persona: "",
          level: "error",
          message: `This plan belongs to ${planOrg}, but Studio is connected to ${check.org}. Switch orgs in Settings, or export the plan and import it here.`,
        });
      }
      setCheckIssues(found);
      return found;
    } finally {
      setChecking(false);
    }
  };

  const checkOnly = async () => {
    setNotice(null);
    const found = await checkPlan(draft, selectedPlan?.org);
    if (found && found.length === 0) flash("Every user and territory in the plan was found.");
  };

  const run = async () => {
    if (issues.length) {
      setTab("plan");
      return;
    }
    setNotice(null);
    setJob(null);
    setLost(false);
    setStarting({ planId: selectedPlan?.id ?? "", planName: normalizePlan(draft).name });
    try {
      const record = await save();
      if (!record) return;
      setStarting({ planId: record.id, planName: record.name });
      await loadRuns(record.id);
      const found = await checkPlan(record.plan as PerfPlan, record.org);
      if (!found) return;
      if (found.some((i) => i.level === "error")) {
        setTab("plan");
        return;
      }
      // Mobile logins ride along (main process only) so their users' table lists come from their own metadata download.
      const res = mobileLogins.length
        ? await window.lscApi.studioPerfStartMobile(record.plan)
        : await window.lscApi.studioPerfStart(record.plan);
      const error = responseError(res);
      if (error) {
        if (/already in progress/i.test(error) && (await attachActive())) {
          setNotice({ kind: "info", text: "A run was already going on this org, so Studio is showing that one instead." });
        } else {
          setNotice({ kind: "error", text: error });
        }
        return;
      }
      const status = res.data as PerfJobStatus;
      const active = { jobId: status.jobId, planId: record.id, planName: record.name };
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(active));
      setJob(status);
      setActiveJob(active);
      flash("Saved and started.");
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setStarting(null);
    }
  };

  /** Open the Salesforce login for the plan's org so a persona user can be signed in through the mobile app. */
  const mobileLogin = async () => {
    setNotice(null);
    const orgName = (selectedPlan?.org || (await window.lscApi.getSettings()).sfTargetOrg || "").toLowerCase();
    const orgs = (await window.lscApi.listSfOrgs()).orgs ?? [];
    const org = orgs.find((o) => o.alias?.toLowerCase() === orgName || o.username.toLowerCase() === orgName) ?? (orgName ? undefined : orgs.find((o) => o.isDefault));
    if (!org) {
      setNotice({ kind: "error", text: "Studio couldn't find this org's login URL. Log in from First sync instead." });
      return;
    }
    setMobileLoggingIn(true);
    try {
      const res = await window.lscApi.mobileLoginStart(org.instanceUrl);
      if (!res.login) {
        if (/consumer key/i.test(res.error ?? "")) {
          setNotice({
            kind: "error",
            text: "A mobile login needs the LSC mobile app consumer key. Add it in Settings (LSC mobile app consumer key). Without it the run still works, but table lists are worked out from profile metadata instead of each rep's own download.",
          });
        } else if (res.error !== "Login window closed.") setNotice({ kind: "error", text: res.error ?? "Login failed." });
        return;
      }
      setMobileLogins((await window.lscApi.mobileLoginList()).logins);
      flash(`Logged in as ${res.login.username}. Its next run uses that user's own metadata download.`);
    } finally {
      setMobileLoggingIn(false);
    }
  };

  const cancel = async () => {
    if (!activeJob) return;
    const res = await window.lscApi.studioPerfCancel(activeJob.jobId);
    if ((res.data as PerfJobStatus | undefined)?.state) setJob(res.data as PerfJobStatus);
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

  const runFileName = (result: AssessmentResult, ext: string) =>
    planFileName({ ...draft, name: `${result.profile} ${result.generatedAt.slice(0, 10)}` }, ext);

  const exportRun = async () => {
    if (!runView) return;
    const res = await window.lscApi.perfSaveFile(runFileName(runView.result, "json"), JSON.stringify(runView.result, null, 2), "json");
    if (!res.canceled && res.path) setNotice({ kind: "info", text: `Saved ${res.path}` });
  };

  const exportReport = async () => {
    if (!runView) return;
    const report = await window.lscApi.studioPerfReport(runView.result, draft.telemetry?.days);
    const error = responseError(report);
    const markdown = (report.data as { markdown?: string } | undefined)?.markdown;
    if (error || !markdown) {
      setNotice({ kind: "error", text: `Couldn't build the report: ${error ?? "no report came back"}` });
      return;
    }
    const res = await window.lscApi.perfSaveFile(runFileName(runView.result, "md"), markdown, "md");
    if (!res.canceled && res.path) setNotice({ kind: "info", text: `Saved ${res.path}` });
  };

  /** The customer-facing report: this run, the run before it as the baseline, and First syncs of the same reps. */
  const exportSignoff = async () => {
    if (!runView) return;
    const simulations = [...new Map([...runSims.values()].map((s) => [s.id, s.result])).values()];
    const report = await window.lscApi.studioSignoffReport({
      assessment: runView.result,
      simulations: simulations.length ? simulations : undefined,
      baseline: runView.previous ?? undefined,
      days: draft.telemetry?.days,
    });
    const error = responseError(report);
    const markdown = (report.data as { markdown?: string } | undefined)?.markdown;
    if (error || !markdown) {
      setNotice({ kind: "error", text: `Couldn't build the sign-off report: ${error ?? "no report came back"}` });
      return;
    }
    const res = await window.lscApi.perfSaveFile(runFileName({ ...runView.result, profile: `${runView.result.profile} sign-off` }, "md"), markdown, "md");
    if (!res.canceled && res.path) setNotice({ kind: "info", text: `Saved ${res.path}` });
  };

  const useAsBaseline = (margin: { warnPct: number; failPct: number }) => {
    if (!runView) return;
    editDraft(applyBaseline(draft, runView.result, margin));
    setEditorKey((k) => k + 1);
    setTab("plan");
    setNotice({
      kind: "info",
      text: `Targets set from the run of ${new Date(runView.result.generatedAt).toLocaleString()} (warn at +${margin.warnPct}%, fail at +${margin.failPct}%). Review them, then save.`,
    });
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

  const inFlightHere = !!selectedPlan && inFlight?.planId === selectedPlan.id;
  // Trends end at the report being viewed, so an older report shows the history it had.
  const viewedIndex = runView ? runs.findIndex((r) => r.id === runView.id) : -1;
  const trend = viewedIndex >= 0 ? trendRows(runs.slice(viewedIndex)) : [];

  return (
    <div className="studio-perf">
      <aside className="studio-perf-sidebar">
        <div className="studio-perf-sidebar-header">
          <div className="studio-rail-title">Test plans</div>
          <button
            type="button"
            className="ui-icon-btn"
            title="New plan"
            aria-label="New plan"
            disabled={running}
            onClick={() => confirmLeave() && openDraft(emptyPlan())}
          >
            <Plus size={16} aria-hidden="true" />
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
            {inFlightHere && (
              <div className="studio-perf-run-item active" title={job?.step ?? "Checking the plan"}>
                <span className="studio-perf-run-open studio-perf-run-live">
                  <span className="studio-perf-run-line">
                    {!lost && <Spinner size={12} />}
                    <span>
                      {lost ? "Lost contact" : "Running"} · {job ? elapsed(job.startedAt) : "starting"}
                    </span>
                  </span>
                  {job?.progress && <span className="studio-perf-run-meta">{progressLabel(job)}</span>}
                  <ProgressBar job={job} />
                </span>
              </div>
            )}
            {runs.length === 0 && !inFlightHere && <div className="studio-perf-hint">No runs yet.</div>}
            {runs.map((r) => {
              const worst = asRunSummary(r.summary)?.worst;
              return (
                <div key={r.id} className={`studio-perf-run-item${runView?.id === r.id ? " active" : ""}`}>
                  <button className="studio-perf-run-open" onClick={() => openRun(runs, r.id)}>
                    <span className={`studio-perf-dot ${r.status}`} />
                    <span className="studio-perf-run-text">
                      <span>{new Date(r.startedAt).toLocaleString()}</span>
                      {worst && (
                        <span className="studio-perf-run-meta" title={`${worst.persona}: ${metricInfo(worst.metric).label}`}>
                          {worst.status === "pass" ? "Closest" : "Worst"}: {metricInfo(worst.metric).label}{" "}
                          {formatValue({ metric: worst.metric, value: worst.value })}
                        </span>
                      )}
                    </span>
                  </button>
                  <button type="button" className="ui-icon-btn sm" title="Delete run" aria-label="Delete run" onClick={() => removeRun(r.id)}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </aside>

      <div className="studio-perf-main">
        <div className="studio-perf-toolbar">
          <Segmented
            aria-label="Plan or report"
            value={tab}
            onChange={setTab}
            options={[
              { value: "plan", label: "Plan" },
              { value: "report", label: "Report", disabled: !runView },
            ]}
          />
          <div className="studio-perf-toolbar-actions">
            <button type="button" className="ui-icon-btn" onClick={importYaml} disabled={running} aria-label="Import plan file" title="Load a plan from a YAML plan file (secondary path; most plans are built here)">
              <Upload size={16} aria-hidden="true" />
            </button>
            <button type="button" className="ui-icon-btn" onClick={exportYaml} aria-label="Export plan file" title="Save the plan as a YAML file to share it or run it with run_perf_assessment or CI">
              <Download size={16} aria-hidden="true" />
            </button>
            {selectedPlan && (
              <button type="button" className="ui-icon-btn" onClick={removePlan} disabled={running} aria-label="Delete plan" title="Delete plan">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
            <span className="studio-perf-toolbar-divider" aria-hidden="true" />
            <button type="button" className="studio-btn" onClick={save} disabled={running || !dirty}>
              Save
            </button>
            <button
              type="button"
              className="studio-btn"
              onClick={checkOnly}
              disabled={running || checking || issues.length > 0}
              title="Look up the plan's users and territories in the connected org without running it"
            >
              {checking && !running && <Spinner size={14} />}
              {checking && !running ? "Checking…" : "Check plan"}
            </button>
            <button
              type="button"
              className="studio-btn primary"
              onClick={run}
              disabled={running || checking || issues.length > 0}
              title={issues.length ? issues.join("\n") : "Save the plan, check it, and run it against the connected org"}
            >
              <Play size={14} aria-hidden="true" />
              Run test
            </button>
          </div>
        </div>

        {inFlight && (
          <div className="studio-perf-body-pad">
            <Callout
              tone={lost ? "warning" : "info"}
              busy={!lost}
              className="studio-perf-progress"
              role="status"
              title={lost ? `Lost contact with “${inFlight.planName}”` : `Running “${inFlight.planName}”`}
              actions={
                <>
                  {lost && (
                    <button type="button" className="studio-btn" onClick={() => setLost(false)}>
                      Reconnect
                    </button>
                  )}
                  <button type="button" className="studio-btn" onClick={cancel} disabled={!activeJob || job?.step === "Cancelling…"}>
                    Cancel
                  </button>
                </>
              }
            >
              <div className="studio-perf-hint">
                {lost
                  ? "Studio couldn't reach the run for a while. It may still be going."
                  : job
                    ? `${job.step} · ${job.queries} queries · ${elapsed(job.startedAt)}`
                    : checking
                      ? "Checking the plan's users…"
                      : "Connecting to the org…"}
              </div>
              {!lost && job?.progress && <div className="studio-perf-hint ui-num">{progressLabel(job)}</div>}
              {!lost && <ProgressBar job={job} />}
            </Callout>
          </div>
        )}
        {notice && (
          <div className="studio-perf-body-pad">
            <Callout tone={notice.kind === "error" ? "error" : "info"} className="studio-perf-notice" role={notice.kind === "error" ? "alert" : "status"}>
              {notice.text}
            </Callout>
          </div>
        )}

        <div className="studio-perf-body">
          {tab === "report" && runView ? (
            <RunReport
              result={runView.result}
              previous={runView.previous}
              trend={trend}
              onAskClaude={() => onAskClaude(remediationPrompt(runView.result))}
              onExport={exportRun}
              onExportReport={exportReport}
              onExportSignoff={exportSignoff}
              onBaseline={running ? undefined : useAsBaseline}
              sims={runSims}
            />
          ) : (
            <div className="studio-perf-plan-stack">
              {(issues.length > 0 || checkErrors.length > 0) && (
                <Callout tone="warning" title="Before this plan can run">
                  <ul className="studio-perf-issues">
                    {issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                    {checkErrors.map((i) => (
                      <li key={issueText(i)}>{issueText(i)}</li>
                    ))}
                  </ul>
                </Callout>
              )}
              {checkWarnings.length > 0 && (
                <Callout tone="info" title="Worth a look before running">
                  <ul className="studio-perf-issues">
                    {checkWarnings.map((i) => (
                      <li key={issueText(i)}>{issueText(i)}</li>
                    ))}
                  </ul>
                </Callout>
              )}
              {!hasCustomerTargets(draft) && (
                <Callout tone="info" title="No customer targets yet">
                  <div className="studio-perf-hint">
                    This plan only has the default metadata download target. Enter the customer's targets (Targets tab) before running, or the
                    report can't say whether anything else is met.
                  </div>
                </Callout>
              )}
              <div className="studio-perf-hint studio-perf-login-row">
                {loginPersonas.length
                  ? `Exact table lists, from each user's own metadata download: ${loginPersonas.join("; ")}.`
                  : "Which tables each rep syncs is worked out from their profile's metadata and object permissions."}{" "}
                {mobileLogins.length > 0 && "Users picked by profile use a login too when the username matches. "}
                <button type="button" className="studio-btn sm" onClick={mobileLogin} disabled={running || mobileLoggingIn} title="Sign in as a persona user through the LSC mobile app, so the run reads that user's real table list">
                  {mobileLoggingIn ? <Spinner size={12} /> : <LogIn size={14} aria-hidden="true" />}
                  {mobileLoggingIn ? "Logging in…" : "Log in as mobile user…"}
                </button>
              </div>
              <PlanEditor
                key={editorKey}
                plan={draft}
                onChange={editDraft}
                profiles={profiles}
                disabled={running}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
