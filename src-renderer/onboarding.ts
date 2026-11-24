/**
 * The first-run tour: which steps it has, and whether to show it.
 *
 * It shows once, after Roz first connects to a model, and again when `ONBOARDING_VERSION`
 * goes up (bump it when the tour changes enough that people who saw the old one should see it
 * again). Help → Take the tour in the status bar opens it any time. Closing it at any step
 * counts as seen; the version seen is `onboardingSeen` in settings.json.
 */

import type { StudioRequest } from "./studio-request";

export const ONBOARDING_VERSION = 1;

export type OnboardingStepId =
  | "welcome"
  | "org"
  | "chat"
  | "review"
  | "studio"
  | "studio-setup"
  | "studio-ipad"
  | "studio-build"
  | "studio-testing"
  | "release"
  | "start";

/** The step list's headings; a step under no heading sits apart at the end. */
export type OnboardingGroup = "basics" | "studio" | "end";

export const ONBOARDING_GROUP_TITLES: Record<OnboardingGroup, string | null> = {
  basics: "Getting started",
  studio: "Studio",
  end: null,
};

export interface OnboardingStep {
  id: OnboardingStepId;
  group: OnboardingGroup;
  /** Short name for the step list. */
  label: string;
  title: string;
  /** Where the step's "Open … in Studio" button goes, and its label. */
  open?: { label: string; request: StudioRequest };
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: "welcome", group: "basics", label: "Welcome", title: "Welcome to Roz" },
  { id: "org", group: "basics", label: "Connect an org", title: "Connect Roz to your Salesforce org" },
  { id: "chat", group: "basics", label: "Ask in chat", title: "Ask in chat" },
  { id: "review", group: "basics", label: "Reviewed changes", title: "Roz asks before it changes your org" },
  {
    id: "studio",
    group: "studio",
    label: "Studio at a glance",
    title: "Studio: the org's LSC setup in one place",
    open: { label: "Open Studio", request: { kind: "overview" } },
  },
  {
    id: "studio-setup",
    group: "studio",
    label: "Setup and readiness",
    title: "Find what's missing before go-live",
    open: { label: "Open the Overview", request: { kind: "overview" } },
  },
  {
    id: "studio-ipad",
    group: "studio",
    label: "iPad preview",
    title: "See the iPad the way a rep sees it",
    open: { label: "Open the iPad preview", request: { kind: "section", section: "preview" } },
  },
  {
    id: "studio-build",
    group: "studio",
    label: "Build",
    title: "Build scripts, apps and presentations",
    open: { label: "Open LSC apps", request: { kind: "section", section: "apps" } },
  },
  {
    id: "studio-testing",
    group: "studio",
    label: "Testing",
    title: "Test mobile sync before reps do",
    open: { label: "Open Sync health", request: { kind: "section", section: "sync" } },
  },
  { id: "release", group: "studio", label: "From change to iPad", title: "From your change to a rep's iPad" },
  { id: "start", group: "end", label: "Where to start", title: "Where to start" },
];

/** Whether to open the tour on its own: never seen, or seen in an older version. */
export function shouldShowOnboarding(seen: unknown): boolean {
  return typeof seen !== "number" || !Number.isFinite(seen) || seen < ONBOARDING_VERSION;
}

/** The step index after a move, kept inside the tour. */
export function clampStep(index: number): number {
  return Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, Math.trunc(index)));
}

/** The starter question the last step can send; the same text as the welcome screen's. */
export const HEALTH_CHECK_PROMPT = "Run a health check on this org and tell me what to fix first.";

/** The Salesforce CLI's install command and download page, shown when `sf` can't be run. */
export const SF_CLI_INSTALL_COMMAND = "npm install --global @salesforce/cli";
export const SF_CLI_DOWNLOAD_URL = "https://developer.salesforce.com/tools/salesforcecli";
export const SF_LOGIN_COMMAND = "sf org login web --alias my-org";
export const SF_SANDBOX_LOGIN_COMMAND = "sf org login web --alias my-sandbox --instance-url https://test.salesforce.com";

export type SetupCheck = "pass" | "todo" | "fail" | "checking" | "blocked";

/** The connect step's three checks: the CLI runs, there's a login, an org is chosen. */
export interface OrgSetupState {
  cli: SetupCheck;
  login: SetupCheck;
  chosen: SetupCheck;
}

export function orgSetupState(o: {
  loading: boolean;
  /** Set when `sf org list` couldn't run. */
  error: string;
  connections: number;
  hasOrg: boolean;
}): OrgSetupState {
  if (o.loading && !o.connections && !o.error) return { cli: "checking", login: "checking", chosen: "checking" };
  if (o.error) return { cli: "fail", login: "blocked", chosen: "blocked" };
  if (!o.connections) return { cli: "pass", login: "todo", chosen: "blocked" };
  return { cli: "pass", login: "pass", chosen: o.hasOrg ? "pass" : "todo" };
}
