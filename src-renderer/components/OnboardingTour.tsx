import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardCheck,
  CloudDownload,
  Copy,
  Database,
  Download,
  FileCode2,
  FlaskConical,
  Hammer,
  History,
  LayoutDashboard,
  LayoutGrid,
  Library,
  LogIn,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Presentation,
  RefreshCw,
  Sparkles,
  Stethoscope,
  Tablet,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { rozTileSrc, useAppIcon } from "../app-icon";
import { useOrgs } from "../hooks/useOrgs";
import { KIND_LABEL, orgKey } from "../orgs";
import {
  clampStep,
  ONBOARDING_GROUP_TITLES,
  ONBOARDING_STEPS,
  orgSetupState,
  SF_CLI_DOWNLOAD_URL,
  SF_CLI_INSTALL_COMMAND,
  SF_LOGIN_COMMAND,
  type OnboardingStep,
  type OnboardingStepId,
  type SetupCheck,
} from "../onboarding";
import type { StudioRequest } from "../studio-request";
import Spinner from "./ui/Spinner";
import StatusIcon from "./ui/StatusIcon";
import "./onboarding.css";

interface OnboardingTourProps {
  /** Closed at any step, by Skip, Escape, the backdrop or an action that leaves the tour; the caller marks it seen. */
  onClose: () => void;
  /** Last step: start a session that asks for a health check of the selected org. */
  onHealthCheck: () => void;
  /** A Studio step's "Open …" button, or the last step's Open Studio. */
  onOpenStudio: (request: StudioRequest) => void;
  /** Last step: an empty chat to ask anything. */
  onNewChat: () => void;
}

/** A dialog that walks through what Roz does and where things are, one step at a time. ← and → move; Escape closes. */
export default function OnboardingTour({ onClose, onHealthCheck, onOpenStudio, onNewChat }: OnboardingTourProps) {
  const [index, setIndex] = useState(0);
  const step = ONBOARDING_STEPS[index];
  const last = index === ONBOARDING_STEPS.length - 1;
  const go = useCallback((i: number) => setIndex(clampStep(i)), []);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Arrows move between steps unless a control that uses them has focus.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, go, onClose]);

  // Next takes focus on open, so Enter and Space move on.
  useEffect(() => nextRef.current?.focus(), []);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={(e) => e.stopPropagation()}
      >
        <StepList index={index} onGo={go} />

        <div className="onboarding-main">
          <div className="onboarding-header">
            <button className="ui-icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close the tour">
              <X size={16} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
          <div key={step.id} className="onboarding-body ui-enter">
            {step.id !== "start" && step.id !== "org" && <Figure id={step.id} />}
            <h2 id="onboarding-title">{step.title}</h2>
            <StepText id={step.id} onHealthCheck={onHealthCheck} onOpenStudio={onOpenStudio} onNewChat={onNewChat} />
            {step.open && <OpenInStudio step={step} onOpenStudio={onOpenStudio} />}
          </div>
          <div className="onboarding-footer">
            {!last && (
              <button className="studio-btn ghost" onClick={onClose}>
                Skip tour
              </button>
            )}
            <span className="onboarding-count" aria-live="polite">
              {index + 1} of {ONBOARDING_STEPS.length}
            </span>
            <span className="onboarding-spacer" />
            {index > 0 && (
              <button className="studio-btn lg" onClick={() => go(index - 1)}>
                <ArrowLeft size={14} aria-hidden="true" />
                Back
              </button>
            )}
            {last ? (
              <button ref={nextRef} className="studio-btn primary lg" onClick={onClose}>
                Done
              </button>
            ) : (
              <button ref={nextRef} className="studio-btn primary lg" onClick={() => go(index + 1)}>
                Next
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The steps by group, with a heading over each group that has one. */
function StepList({ index, onGo }: { index: number; onGo: (i: number) => void }) {
  const groups: { group: OnboardingStep["group"]; steps: { step: OnboardingStep; i: number }[] }[] = [];
  ONBOARDING_STEPS.forEach((step, i) => {
    const tail = groups[groups.length - 1];
    if (tail?.group === step.group) tail.steps.push({ step, i });
    else groups.push({ group: step.group, steps: [{ step, i }] });
  });
  return (
    <nav className="onboarding-steps" aria-label="Tour steps">
      {groups.map(({ group, steps }) => {
        const title = ONBOARDING_GROUP_TITLES[group];
        return (
          <div key={group} className="onboarding-steps-group">
            {title && <div className="onboarding-steps-title">{title}</div>}
            <ol start={steps[0].i + 1}>
              {steps.map(({ step, i }) => (
                <li key={step.id}>
                  <button
                    type="button"
                    className={`onboarding-step${i === index ? " active" : ""}${i < index ? " done" : ""}`}
                    aria-current={i === index ? "step" : undefined}
                    onClick={() => onGo(i)}
                  >
                    <span className="onboarding-step-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="onboarding-step-label">{step.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </nav>
  );
}

/** A Studio step's way to go and look; it needs an org, since Studio shows one. */
function OpenInStudio({ step, onOpenStudio }: { step: OnboardingStep; onOpenStudio: (request: StudioRequest) => void }) {
  const { current, chosen } = useOrgs();
  if (!step.open) return null;
  const hasOrg = !!(current || chosen);
  return (
    <div className="onboarding-open">
      <button className="studio-btn" disabled={!hasOrg} onClick={() => onOpenStudio(step.open!.request)}>
        {step.open.label}
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
      {!hasOrg && <span className="onboarding-open-hint">Connect an org first (step 2).</span>}
    </div>
  );
}

function StepText({
  id,
  onHealthCheck,
  onOpenStudio,
  onNewChat,
}: { id: OnboardingStepId } & Pick<OnboardingTourProps, "onHealthCheck" | "onOpenStudio" | "onNewChat">) {
  switch (id) {
    case "welcome":
      return (
        <>
          <p>
            Roz helps you set up and support Life Sciences Cloud for Customer Engagement. It connects to your Salesforce org
            through the Salesforce CLI, checks the configuration against problems seen on real projects, and answers LSC
            questions from the product documentation.
          </p>
          <p>
            You'll use it in two ways: chat, to ask questions and diagnose problems, and Studio, to look through and change the
            org's LSC setup. The next steps cover both. You can open this tour again from Help at the bottom of the window.
          </p>
        </>
      );
    case "org":
      return <ConnectOrg />;
    case "chat":
      return (
        <>
          <p>
            Describe the problem in your own words or paste the error message. Roz runs read-only checks against the org and
            tells you what it found and how to fix it.
          </p>
          <ul className="onboarding-examples" aria-label="Things you can ask">
            <li>
              <MessageSquare size={14} aria-hidden="true" />
              Why can't Carmen see the Samples tab on her iPad?
            </li>
            <li>
              <MessageSquare size={14} aria-hidden="true" />
              Which reps have slow or failing syncs?
            </li>
            <li>
              <MessageSquare size={14} aria-hidden="true" />
              How do sample limits work, and how do I set them up?
            </li>
          </ul>
          <p className="onboarding-note">
            Type <kbd>/</kbd> in the message box to see commands such as <code>/lsc:health-check</code>.
          </p>
        </>
      );
    case "review":
      return (
        <>
          <p>
            Roz never writes to the org on its own. When it wants to change a setting it can show in Studio, the change goes to
            Studio's list of pending changes for you to review and apply. Anything else stops in the chat with Allow and Deny.
          </p>
          <p>Production orgs follow the same rules, and Studio asks you to confirm again before it changes production.</p>
        </>
      );
    case "studio":
      return (
        <>
          <p>
            Chat answers one question at a time. Studio lays out the selected org's LSC configuration as pages you can look
            through, check and change. Open it from the sidebar. Its menu has four sections:
          </p>
          <dl className="onboarding-areas">
            <Area icon={ClipboardCheck} name="Setup">
              Go-live checks for the org and for each feature, and what changed lately.
            </Area>
            <Area icon={Tablet} name="iPad">
              A rep's iPad as published, the metadata cache, and which objects sync.
            </Area>
            <Area icon={Hammer} name="Build">
              Custom scripts, LSC apps for the iPad, and Intelligent Content presentations.
            </Area>
            <Area icon={FlaskConical} name="Testing">
              Sync health from real iPads, test plans, and first sync simulations.
            </Area>
          </dl>
          <p className="onboarding-note">
            Reading the org never changes it. Edits you make in Studio wait in a list until you review and apply them. Studio
            works best with a login that has the LSC admin permission set.
          </p>
        </>
      );
    case "studio-setup":
      return (
        <>
          <p>
            Setup opens on the <strong>Overview</strong>: a verdict for the org, the steps to do first, org-wide checks such as
            license capacity, the territory model and out-of-date metadata caches, and a card for each feature.
          </p>
          <p>
            Open a feature to see its readiness in order: switched on, access, data, settings, then iPad. Each check passes,
            fails or says why it couldn't check, and many failures come with a fix you can queue. Pick a profile in{" "}
            <strong>Readiness for</strong> to check the setup as that profile's reps get it.
          </p>
          <dl className="onboarding-areas">
            <Area icon={LayoutDashboard} name="All configuration">
              Every part of a feature on one board: objects, layouts, scripts, validation rules, flows, trigger handlers, DB
              Schema and actions.
            </Area>
            <Area icon={History} name="What changed">
              Compare the org with a saved snapshot, or list recent changes and who made them.
            </Area>
          </dl>
        </>
      );
    case "studio-ipad":
      return (
        <>
          <p>
            The iPad preview draws one rep's iPad from their profile's published metadata cache: the tab bar, Home page,
            record pages, list views and actions. Click anything on it to see why the rep sees it and where to change it.
          </p>
          <dl className="onboarding-areas">
            <Area name="On iPads now">What reps have today.</Area>
            <Area name="Next publish">
              What they get after you apply and publish. Move, add or remove fields, components, tabs and list view columns
              here.
            </Area>
            <Area name="Compare">The two side by side.</Area>
          </dl>
          <dl className="onboarding-areas">
            <Area icon={Archive} name="Metadata cache">
              Each profile's published cache, publish history, and the log when a publish fails.
            </Area>
            <Area icon={Database} name="Object sync">
              The DB Schema records that decide which objects and records sync, and for whom.
            </Area>
          </dl>
        </>
      );
    case "studio-build":
      return (
        <>
          <dl className="onboarding-areas">
            <Area icon={FileCode2} name="Custom scripts">
              Edit visit, workflow and checklist scripts with live checks, and test one against a real record without saving
              anything.
            </Area>
            <Area icon={Sparkles} name="LSC apps">
              Describe an app for the iPad and Roz writes it. It runs in a device frame, with the org's data, before you
              deploy it.
            </Area>
            <Area icon={Presentation} name="Intelligent Content">
              Order a presentation's pages, set its topics and territories, or draft new pages with Roz.
            </Area>
          </dl>
          <p className="onboarding-note">
            Pages Roz drafts need medical, legal and regulatory review before anyone switches the presentation on.
          </p>
        </>
      );
    case "studio-testing":
      return (
        <>
          <dl className="onboarding-areas">
            <Area icon={Activity} name="Sync health">
              How reps' iPads are syncing, from the org's device records, and which reps need attention.
            </Area>
            <Area icon={ClipboardCheck} name="Test plans">
              The customer's sync targets checked with chosen reps, and a sign-off report to export.
            </Area>
            <Area icon={CloudDownload} name="First sync">
              Downloads what a rep's iPad would on its first sync, and times it.
            </Area>
            <Area icon={UsersRound} name="Test users">
              Reps you sign in with the LSC mobile app's login, for the preview, first sync and test plans.
            </Area>
          </dl>
          <p className="onboarding-note">Testing only reads the org. It never creates or changes records.</p>
        </>
      );
    case "release":
      return (
        <>
          <p>A change in Studio is always in one of three places, shown in the bar at the bottom of Studio.</p>
          <dl className="onboarding-areas">
            <Area name="Your changes">Only on this computer. Review them, then apply.</Area>
            <Area name="In the org">Applied. Desktop users see it straight away.</Area>
            <Area name="On iPads">Reps get it after you publish their profile to the iPad.</Area>
          </dl>
          <p className="onboarding-note">You can undo the last apply, and Studio shows what will happen before each step.</p>
        </>
      );
    case "start":
      return (
        <>
          <div className="onboarding-actions">
            <StartAction
              icon={Stethoscope}
              title="Run a health check"
              detail="Roz checks the selected org and says what to fix first."
              onClick={onHealthCheck}
              needsOrg
            />
            <StartAction
              icon={LayoutGrid}
              title="Open Studio"
              detail="Start with the Overview of the org's go-live checks."
              onClick={() => onOpenStudio({ kind: "overview" })}
              needsOrg
            />
            <StartAction icon={MessageSquarePlus} title="Ask a question" detail="Start a new chat and ask anything about LSC." onClick={onNewChat} />
          </div>
          <p className="onboarding-note">
            Save answers, tables and diagrams you want to keep to the Library. Settings, bottom left, has the model connection,
            appearance and updates.
          </p>
        </>
      );
  }
}

function Area({ icon: Icon, name, children }: { icon?: LucideIcon; name: string; children: React.ReactNode }) {
  return (
    <div className={`onboarding-area${Icon ? "" : " plain"}`}>
      <dt>
        {Icon && <Icon size={16} aria-hidden="true" />}
        {name}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The connect step: Roz uses the Salesforce CLI's logins, so check the CLI, a login, and the chosen org, live. */
function ConnectOrg() {
  const { current, chosen, orgs, loading, error, waitingLogin, notice, login, refresh } = useOrgs();
  const state = orgSetupState({ loading, error, connections: orgs.length, hasOrg: !!(current || chosen) });
  const [checking, setChecking] = useState(false);
  const checkAgain = async () => {
    setChecking(true);
    try {
      await refresh({ recheckRoles: false });
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <p>
        Roz reaches Salesforce through the Salesforce CLI (<code>sf</code>). It uses the logins the CLI already has, so it
        never asks for your Salesforce password, and every org you log in to with the CLI shows up in Roz.
      </p>
      <ol className="onboarding-setup" aria-live="polite">
        <SetupRow state={state.cli} title="Install the Salesforce CLI">
          {state.cli === "pass" && "Found it."}
          {state.cli === "checking" && "Looking for it…"}
          {state.cli === "fail" && (
            <>
              <div>Roz couldn't run sf. Install it in Terminal (it needs Node.js), or download the installer.</div>
              <CommandLine command={SF_CLI_INSTALL_COMMAND} />
              <div className="onboarding-setup-buttons">
                <button className="studio-btn sm" onClick={() => void window.lscApi.openExternal(SF_CLI_DOWNLOAD_URL)}>
                  <Download size={14} aria-hidden="true" />
                  Download the installer
                </button>
                <button className="studio-btn sm" onClick={() => void checkAgain()} disabled={checking}>
                  {checking ? <Spinner size={12} /> : <RefreshCw size={14} aria-hidden="true" />}
                  Check again
                </button>
              </div>
              <div className="onboarding-setup-hint">If Check again still can't find it, quit and reopen Roz.</div>
            </>
          )}
        </SetupRow>
        <SetupRow state={state.login} title="Log in to your org">
          {state.login === "pass" && `${orgs.length} ${orgs.length === 1 ? "login" : "logins"} found.`}
          {state.login === "checking" && "Looking for your logins…"}
          {state.login === "blocked" && "After the CLI is installed."}
          {state.login === "todo" && (
            <>
              {waitingLogin ? (
                <div className="onboarding-setup-waiting">
                  <Spinner size={12} />
                  Finish logging in in your browser. Roz picks the org when you're done.
                </div>
              ) : (
                <>
                  <div>Log in with your Salesforce username in the browser. Use a login with the LSC admin permission set.</div>
                  <div className="onboarding-setup-buttons">
                    <button className="studio-btn sm primary" onClick={() => void login({})}>
                      <LogIn size={14} aria-hidden="true" />
                      Log in to production…
                    </button>
                    <button
                      className="studio-btn sm"
                      onClick={() => void login({ instanceUrl: "https://test.salesforce.com" })}
                    >
                      <LogIn size={14} aria-hidden="true" />
                      Log in to a sandbox…
                    </button>
                  </div>
                  <div className="onboarding-setup-hint">
                    Or in Terminal: <code>{SF_LOGIN_COMMAND}</code>
                  </div>
                </>
              )}
              {notice && <div className="onboarding-setup-notice">{notice}</div>}
            </>
          )}
        </SetupRow>
        <SetupRow state={state.chosen} title="Choose the org to work in">
          {state.chosen === "pass" && (
            <span>
              Working in <strong>{current ? orgKey(current) : chosen}</strong>
              {current ? ` · ${KIND_LABEL[current.kind]}` : ""}
            </span>
          )}
          {state.chosen === "todo" && "Pick one from the menu at the top of the sidebar."}
          {(state.chosen === "blocked" || state.chosen === "checking") && "After you've logged in."}
        </SetupRow>
      </ol>
      <p className="onboarding-note">
        Use the menu at the top of the sidebar to switch orgs or log in to another. Chat sessions, Studio and the Library
        follow the org you pick, and each session stays in the org it started in.
      </p>
    </>
  );
}

const SETUP_TONE: Record<Exclude<SetupCheck, "checking">, "pass" | "error" | "info" | "skipped"> = {
  pass: "pass",
  fail: "error",
  todo: "info",
  blocked: "skipped",
};

function SetupRow({ state, title, children }: { state: SetupCheck; title: string; children: React.ReactNode }) {
  return (
    <li className={`onboarding-setup-row ${state}`}>
      <span className="onboarding-setup-icon">
        {state === "checking" ? <Spinner size={14} /> : <StatusIcon tone={SETUP_TONE[state]} size={16} />}
      </span>
      <div className="onboarding-setup-text">
        <div className="onboarding-setup-title">{title}</div>
        <div className="onboarding-setup-detail">{children}</div>
      </div>
    </li>
  );
}

/** A Terminal command with a Copy button. */
function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Nothing to do: the command is on screen to select.
    }
  };
  return (
    <div className="onboarding-command">
      <code>{command}</code>
      <button className="ui-icon-btn" onClick={() => void copy()} title={copied ? "Copied" : "Copy"} aria-label="Copy the command">
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

function StartAction({
  icon: Icon,
  title,
  detail,
  onClick,
  needsOrg,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  onClick: () => void;
  needsOrg?: boolean;
}) {
  const { current, chosen } = useOrgs();
  const disabled = needsOrg && !current && !chosen;
  return (
    <button
      type="button"
      className="onboarding-action"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Connect an org first (step 2)" : undefined}
    >
      <span className="onboarding-action-icon">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="onboarding-action-text">
        <span className="onboarding-action-title">{title}</span>
        <span className="onboarding-action-detail">{disabled ? "Connect an org first (step 2)." : detail}</span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className="onboarding-action-chevron" />
    </button>
  );
}

/** A small picture of the part of the app a step is about, drawn from the app's own pieces. */
function Figure({ id }: { id: OnboardingStepId }) {
  const appIcon = useAppIcon();
  return (
    <div className="onboarding-figure" aria-hidden="true">
      {id === "welcome" && (
        <div className="ob-welcome">
          <img src={rozTileSrc(appIcon)} alt="" className="ob-logo" />
          <div className="ob-chips">
            <span className="ob-chip">
              <MessagesSquare size={14} /> Chat
            </span>
            <span className="ob-chip">
              <LayoutGrid size={14} /> Studio
            </span>
            <span className="ob-chip">
              <Library size={14} /> Library
            </span>
          </div>
        </div>
      )}
      {id === "chat" && (
        <div className="ob-chat">
          <div className="ob-bubble user">Carmen can't see the Samples tab on her iPad.</div>
          <div className="ob-card ob-diagnosis">
            <div className="ob-diagnosis-head">
              <StatusIcon tone="warning" size={16} />
              <span>Found in this org</span>
            </div>
            <div className="ob-row">
              <StatusIcon tone="error" size={14} />
              <span>Samples tab isn't assigned to her profile</span>
            </div>
            <div className="ob-row">
              <StatusIcon tone="pass" size={14} />
              <span>Sample permission set assigned</span>
            </div>
          </div>
        </div>
      )}
      {id === "review" && (
        <div className="ob-card ob-approval">
          <div className="ob-approval-text">Turn on the DCR trigger handler in this org.</div>
          <div className="ob-approval-tool">toggle_trigger_handler</div>
          <div className="ob-approval-buttons">
            <span className="studio-btn sm">Deny</span>
            <span className="studio-btn sm primary">Allow</span>
          </div>
        </div>
      )}
      {id === "studio" && (
        <div className="ob-card ob-rail">
          {(
            [
              ["Setup", LayoutDashboard, "Overview"],
              ["iPad", Tablet, "Preview"],
              ["Build", Sparkles, "LSC apps"],
              ["Testing", Activity, "Sync health"],
            ] as [string, LucideIcon, string][]
          ).map(([section, Icon, item], i) => (
            <div key={section} className="ob-rail-group">
              <span className="ob-rail-title">{section}</span>
              <div className={`ob-row${i === 0 ? " active" : ""}`}>
                <Icon size={14} />
                <span>{item}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {id === "studio-setup" && (
        <div className="ob-card ob-readiness">
          <div className="ob-diagnosis-head">
            <span>Visit Management</span>
            <span className="ui-pill warning">Works, with 1 issue</span>
          </div>
          <div className="ob-row">
            <StatusIcon tone="pass" size={14} />
            <span>Switched on</span>
          </div>
          <div className="ob-row">
            <StatusIcon tone="pass" size={14} />
            <span>Reps have access</span>
          </div>
          <div className="ob-row">
            <StatusIcon tone="error" size={14} />
            <span>Visit DB Schema record not assigned to Sales Rep</span>
            <span className="studio-btn sm">Fix</span>
          </div>
        </div>
      )}
      {id === "studio-ipad" && (
        <div className="ob-ipad-scene">
          <div className="ob-ipad">
            <div className="ob-ipad-head">
              <span className="ob-ipad-name">Dr. Ana Lopez</span>
              <span className="ob-ipad-sub">Cardiology · Boston</span>
            </div>
            <div className="ob-ipad-fields">
              <div className="ob-ipad-field">
                <span>Specialty</span>
                <span>Cardiology</span>
              </div>
              <div className="ob-ipad-field selected">
                <span>NPI</span>
                <span>1497758544</span>
              </div>
              <div className="ob-ipad-field">
                <span>Segment</span>
                <span>Tier 1</span>
              </div>
            </div>
            <div className="ob-ipad-tabs">
              <span>Home</span>
              <span className="active">Accounts</span>
              <span>Calendar</span>
              <span>Samples</span>
            </div>
          </div>
          <div className="ob-card ob-inspector">
            <span className="ui-pill info">Field</span>
            <div className="ob-inspector-name">NPI</div>
            <div className="ob-inspector-why">On HCP Layout, assigned to Sales Rep</div>
          </div>
        </div>
      )}
      {id === "studio-build" && (
        <div className="ob-tiles">
          {(
            [
              [FileCode2, "Custom scripts", "Visit validation"],
              [Sparkles, "LSC apps", "HCP timeline"],
              [Presentation, "Intelligent Content", "Cardio launch deck"],
            ] as [LucideIcon, string, string][]
          ).map(([Icon, name, sample]) => (
            <div key={name} className="ob-tile">
              <Icon size={16} />
              <span className="ob-tile-name">{name}</span>
              <span className="ob-tile-sample">{sample}</span>
            </div>
          ))}
        </div>
      )}
      {id === "studio-testing" && (
        <div className="ob-tiles">
          {(
            [
              ["warning", "Slowest first syncs", "6 min 40 s"],
              ["pass", "Slowest later syncs", "22 s"],
              ["pass", "Failed syncs", "0.8%"],
            ] as ["warning" | "pass", string, string][]
          ).map(([tone, name, value]) => (
            <div key={name} className="ob-tile">
              <StatusIcon tone={tone} size={16} />
              <span className="ob-tile-value">{value}</span>
              <span className="ob-tile-sample">{name}</span>
            </div>
          ))}
        </div>
      )}
      {id === "release" && (
        <div className="ob-card ob-release">
          <span className="ob-release-stage">
            Your changes <span className="ob-count">2</span>
          </span>
          <ChevronRight size={14} className="ob-release-sep" />
          <span className="ob-release-stage">
            In the org <span className="ob-count">1</span>
          </span>
          <ChevronRight size={14} className="ob-release-sep" />
          <span className="ob-release-stage">On iPads</span>
          <span className="studio-btn sm primary ob-release-btn">Review & apply…</span>
        </div>
      )}
    </div>
  );
}
