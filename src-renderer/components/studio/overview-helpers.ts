import type { FeatureSummary, ReadinessCheck } from "./types";
import { needsLoad, type Revalidating } from "./fix-effects";
import { STAGES, summarize, verdictText, type ReadinessState, type ReadinessSummary, type Verdict } from "./readiness";

/** `studio_setup_overview` result. Copy of `SetupOverview` in src/studio/overview.ts. */
export interface SetupOverviewData {
  org: string;
  collectedAt: string;
  checks: ReadinessCheck[];
  /** Profiles whose iPads are behind the Admin Console. */
  unpublishedProfiles: string[];
  unpublishedChanges: number;
  /** The profile it was checked for; absent for every profile. */
  profile?: string;
}

/** Id of the org-wide check that offers "Publish to iPad". */
export const UNPUBLISHED_CHECK = "overview.mobile.unpublished";

/** Features loaded at once by the overview. */
export const LOAD_CONCURRENCY = 3;

export type CardGroupId = "attention" | "ready" | "unchecked" | "loading";

export interface FeatureCardModel {
  feature: FeatureSummary;
  state: ReadinessState | undefined;
  summary: ReadinessSummary | null;
}

export const GROUP_TITLES: Record<CardGroupId, string> = {
  attention: "Needs attention",
  loading: "Checking…",
  unchecked: "Couldn't be checked",
  ready: "Healthy",
};

/**
 * Cards grouped for scanning: features with problems first (blocked before
 * issues, most blocking first), then still-loading, unreadable, and ready ones.
 * Features not available in this build are left out.
 */
export function groupCards(
  features: FeatureSummary[],
  readiness: Record<string, ReadinessState>
): { id: CardGroupId; cards: FeatureCardModel[] }[] {
  const cards = features
    .filter((f) => f.available)
    .map((feature): FeatureCardModel => {
      const state = readiness[feature.id];
      return { feature, state, summary: state?.status === "ready" ? summarize(state.readiness.checks) : null };
    });
  const groupOf = (c: FeatureCardModel): CardGroupId =>
    !c.state || c.state.status === "loading"
      ? "loading"
      : !c.summary || c.summary.verdict === "unknown"
        ? "unchecked"
        : c.summary.verdict === "ready"
          ? "ready"
          : "attention";
  const severity = (c: FeatureCardModel) => (c.summary ? c.summary.blocking.length * 1000 + c.summary.toFix.length : 0);
  return (["attention", "loading", "unchecked", "ready"] as CardGroupId[])
    .map((id) => ({
      id,
      cards: cards.filter((c) => groupOf(c) === id).sort((a, b) => (id === "attention" ? severity(b) - severity(a) : 0)),
    }))
    .filter((g) => g.cards.length);
}

/** Feature ids to start loading now: not yet requested (or marked for refresh), up to the free slots. */
export function pickToLoad(
  ids: string[],
  readiness: Record<string, ReadinessState>,
  refresh: ReadonlySet<string> = new Set(),
  limit = LOAD_CONCURRENCY
): string[] {
  const busy = (id: string) => readiness[id]?.status === "loading" || (readiness[id] as Revalidating | undefined)?.refreshing === true;
  const inFlight = ids.filter(busy).length;
  const wanted = ids.filter((id) => !readiness[id] || (refresh.has(id) && !busy(id)) || needsLoad(readiness[id]));
  return wanted.slice(0, Math.max(0, limit - inFlight));
}

/** Every available feature has finished loading (successfully or not). */
export function allSettled(ids: string[], readiness: Record<string, ReadinessState>): boolean {
  return ids.every((id) => readiness[id] && readiness[id].status !== "loading");
}

export interface OrgVerdict {
  verdict: Verdict;
  blocking: number;
  toFix: number;
  features: number;
  featuresReady: number;
  /** Features whose readiness has loaded (or failed to). */
  featuresChecked: number;
  /** Loaded features with nothing failing whose checks mostly couldn't run, or that failed to load. */
  featuresUnverified: number;
}

/** One verdict for the org: org-wide checks plus every feature loaded so far. */
export function orgVerdict(
  overview: ReadinessCheck[],
  features: FeatureSummary[],
  readiness: Record<string, ReadinessState>
): OrgVerdict {
  const org = summarize(overview);
  const available = features.filter((f) => f.available);
  const summaries = available.map((f) => {
    const s = readiness[f.id];
    return s?.status === "ready" ? summarize(s.readiness.checks) : null;
  });
  const checked = summaries.filter((s): s is ReadinessSummary => !!s && s.verdict !== "unknown");
  const loaded = available.filter((f) => readiness[f.id] && readiness[f.id].status !== "loading").length;
  const blocking = org.blocking.length + checked.reduce((n, s) => n + s.blocking.length, 0);
  const toFix = org.toFix.length + checked.reduce((n, s) => n + s.toFix.length, 0);
  const ran = org.ran + checked.length;
  return {
    verdict: blocking ? "blocked" : toFix ? "issues" : ran === 0 ? "unknown" : "ready",
    blocking,
    toFix,
    features: available.length,
    featuresReady: checked.filter((s) => s.verdict === "ready").length,
    featuresChecked: loaded,
    featuresUnverified: loaded - checked.length,
  };
}

export function orgVerdictText(v: OrgVerdict): string {
  const progress = v.featuresChecked < v.features ? ` (${v.featuresChecked} of ${v.features} features checked so far)` : "";
  switch (v.verdict) {
    case "blocked":
      return `${v.blocking} problem${v.blocking === 1 ? "" : "s"} to fix now${v.toFix ? `, ${v.toFix} more worth fixing` : ""}${progress}`;
    case "issues":
      return `Nothing urgent, ${v.toFix} issue${v.toFix === 1 ? "" : "s"} worth fixing${progress}`;
    case "ready":
      if (v.featuresChecked < v.features) return `No problems found yet${progress}`;
      return v.featuresUnverified
        ? `No problems found, but ${v.featuresUnverified} feature${v.featuresUnverified === 1 ? "" : "s"} couldn't be verified`
        : `Healthy: ${v.featuresReady} of ${v.features} features pass every check, no org-wide issues`;
    case "unknown":
      return v.featuresChecked < v.features ? "Checking your org…" : "Couldn't check your org";
  }
}

export interface NextStep {
  key: string;
  title: string;
  detail: string;
  /** Feature to open, or undefined for an org-wide check on this page. */
  featureId?: string;
}

/** "Do this first": org-wide blockers, then the blocking checks of the worst features. */
export function nextSteps(
  overview: ReadinessCheck[],
  features: FeatureSummary[],
  readiness: Record<string, ReadinessState>,
  max = 4
): NextStep[] {
  const steps: NextStep[] = [];
  for (const c of overview.filter((c) => c.status === "fail" && c.severity === "error")) {
    steps.push({ key: c.id, title: c.title, detail: c.detail ?? "Org-wide" });
  }
  const groups = groupCards(features, readiness).find((g) => g.id === "attention")?.cards ?? [];
  for (const card of groups) {
    const first = card.summary?.blocking[0] ?? card.summary?.toFix[0];
    if (first) steps.push({ key: `${card.feature.id}:${first.id}`, title: first.title, detail: card.feature.title, featureId: card.feature.id });
  }
  return steps.slice(0, max);
}

// ─── Health check report ────────────────────────────────────────────────────

const MARK: Record<ReadinessCheck["status"], string> = { pass: "PASS", fail: "FAIL", unknown: "UNKNOWN", skipped: "SKIPPED" };

function severityWord(c: ReadinessCheck): string {
  return c.status !== "fail" ? "" : c.severity === "error" ? " (fix now)" : c.severity === "warning" ? " (worth fixing)" : " (suggestion)";
}

function checkLines(checks: ReadinessCheck[]): string[] {
  const lines: string[] = [];
  for (const stage of STAGES) {
    const inStage = checks.filter((c) => c.stage === stage.id && c.status !== "pass" && c.status !== "skipped");
    if (!inStage.length) continue;
    lines.push(`**${stage.title}**`, "");
    for (const c of inStage) {
      lines.push(`- ${MARK[c.status]}${severityWord(c)}: ${c.title}${c.detail ? ` — ${c.detail.replace(/\s+/g, " ")}` : ""}`);
      if (c.examples?.length) lines.push(`  - Examples: ${c.examples.join(", ")}`);
      if (c.status === "fail" && c.steps?.length) lines.push(`  - How to fix: ${c.steps.join(" ")}`);
      else if (c.status === "fail" && c.uiPath) lines.push(`  - Where: ${c.uiPath}`);
    }
    lines.push("");
  }
  return lines;
}

/** Markdown health check report: org verdict, org-wide checks, then every feature (problems in full, passing ones counted). */
export function buildReport(
  overview: SetupOverviewData,
  features: FeatureSummary[],
  readiness: Record<string, ReadinessState>,
  now = new Date()
): string {
  const v = orgVerdict(overview.checks, features, readiness);
  const out: string[] = [
    `# LSC health check: ${overview.org}`,
    "",
    `Generated ${now.toLocaleString()}. Read-only checks against the org${overview.profile ? `, for the ${overview.profile} profile` : ""}.`,
    "",
    `**${orgVerdictText(v)}**`,
    "",
    "## Org-wide",
    "",
  ];
  const org = summarize(overview.checks);
  out.push(`${verdictText(org)} (${org.passed} of ${org.ran} checks passing).`, "");
  out.push(...checkLines(overview.checks));

  out.push("## Features", "", "| Feature | Verdict | Fix now | Worth fixing | Passing |", "| --- | --- | --- | --- | --- |");
  const rows = features.filter((f) => f.available);
  const details: string[] = [];
  for (const f of rows) {
    const state = readiness[f.id];
    if (state?.status !== "ready") {
      out.push(`| ${f.title} | ${state?.status === "error" ? "Couldn't check" : "Not checked"} | – | – | – |`);
      if (state?.status === "error") details.push(`### ${f.title}`, "", `Couldn't check: ${state.error}`, "");
      continue;
    }
    const s = summarize(state.readiness.checks);
    const label = { ready: "Healthy", issues: "Worth fixing", blocked: "Fix now", unknown: "Couldn't check" }[s.verdict];
    out.push(`| ${f.title} | ${label} | ${s.blocking.length} | ${s.toFix.length} | ${s.passed}/${s.ran} |`);
    if (s.verdict !== "ready") details.push(`### ${f.title}`, "", ...checkLines(state.readiness.checks));
  }
  out.push("", ...details);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function reportFileName(org: string, now = new Date()): string {
  return `lsc-health-check-${org.replace(/[^\w.-]+/g, "_")}-${now.toISOString().slice(0, 10)}.md`;
}
