import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PublishedIpad, PublishedLayout, RecordFieldSpec } from "./published-types";
import type { Presentation } from "./ipad-fab-actions";
import { agentName } from "./ipad-fab-actions";
import { IpadStatusBar } from "./IpadChrome";
import { AstroIcon, EmptyArt } from "./IpadHome";
import { HcoIcon, NewPersonAccountIcon } from "./assets/icons";
import { autoNumber, fmtDateTime, picklistStart, visitFields, visitTimes } from "./ipad-visit-form";
import type { VisitCreateAccount } from "./screens/fabs-types";
import { useMobileLogins } from "../../hooks/useMobileLogins";
import {
  chooseAuth,
  loginUrlFor,
  myDomainOf,
  partitionFor,
  sameUserId,
  type BrowserAuth,
} from "./browser-auth";
import {
  Backdrop,
  Caret,
  Full,
  layoutsFor,
  linkBtn,
  Magnifier,
  NavBar,
  Note,
  Sections,
  type FormContext,
  type SheetContext,
} from "./ipad-sheet-ui";
import VisitEditor from "./visit/VisitEditor";
import "./action-sheets.css";

/**
 * What a ••• menu item (or the Agentforce button) opens on the device, drawn from the cache and the
 * snapshot's read data. Nothing here saves, sends or calls the org: Save / Send / Submit are inert, and
 * Cancel / Close / Back dismiss the sheet.
 */

export type { SheetContext } from "./ipad-sheet-ui";

// ── Inquiry: record type picker, then the create form ─────────────────────────

function InquirySheet({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const { snapshot, record } = ctx;
  const rts = snapshot.objects.Inquiry?.recordTypes ?? [];
  const [picked, setPicked] = useState(rts.length ? rts.length - 1 : 0);
  const [step, setStep] = useState<"pick" | "form">("pick");
  const rt = rts[picked];
  const layouts = rt ? layoutsFor(snapshot, "Inquiry", rt.name) : [];
  const account = record?.object === "Account" ? record.title : "";
  // The linked Case layout has no Case record type in the cache; its Priority and Status start like the Inquiry's.
  const seed = useMemo(() => crypto.randomUUID().toUpperCase(), []);
  const form: FormContext = {
    seed,
    defaults: rt?.picklistDefaults,
    values: (spec) => (/^Account/.test(spec.name) && account ? account : undefined),
    nullLabels: ["Case Information", "Web Information"],
    staticNames: ["Status"],
  };
  if (step === "pick") {
    return (
      <Backdrop onClose={onClose} className="inquiry">
        <NavBar
          plain
          left={linkBtn("Cancel", onClose)}
          title="New Inquiry"
          right={linkBtn("Next", () => setStep("form"), !rts.length)}
        />
        <div className="studio-ipad-act-body">
          {rts.map((r, i) => (
            <div
              key={r.name}
              className={`studio-ipad-act-radio${i === picked ? " on" : ""}`}
              onClick={() => setPicked(i)}
              role="radio"
              aria-checked={i === picked}
            >
              {r.label}
              {i === picked && <span className="studio-ipad-act-tick" />}
            </div>
          ))}
          {!rts.length && <Note>The Inquiry object has no record types in the cache.</Note>}
        </div>
      </Backdrop>
    );
  }
  return (
    <Backdrop onClose={onClose} className="inquiry">
      <NavBar
        plain
        left={
          <button
            type="button"
            className="studio-ipad-act-link back"
            onClick={() => setStep("pick")}
          >
            <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden="true">
              <path
                d="M10 2 2 10l8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            New Inquiry
          </button>
        }
        title="New Inquiry"
        right={linkBtn("Save")}
      />
      <div className="studio-ipad-act-body form">
        {layouts.map((l) => (
          <Sections
            key={l.name}
            layout={l}
            firstNull={0}
            form={l.name.startsWith("Inquiry-") ? form : { ...form, staticNames: [] }}
          />
        ))}
        {!layouts.length && <Note>The layout for this record type isn't in the cache.</Note>}
        <Note>The form is not saved. Case ID and Case Number are assigned when the app saves.</Note>
      </div>
    </Backdrop>
  );
}

// ── Email: provider picker, then the template picker ──────────────────────────

function ProviderPicker({
  ctx,
  onClose,
  onPick,
}: {
  ctx: SheetContext;
  onClose: () => void;
  onPick: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const cards = [...(ctx.snapshot.screens?.accounts?.cards ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const shown = cards.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Backdrop onClose={onClose} className="providers">
      <NavBar plain left={linkBtn("Cancel", onClose)} title="Choose provider" />
      <div className="studio-ipad-act-search">
        <Magnifier />
        <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="studio-ipad-act-list">
        {shown.map((c) => (
          <div key={c.id} className="studio-ipad-act-prov" onClick={() => onPick(c.name)}>
            <span className={`studio-ipad-act-avatar${c.hco ? " hco" : ""}`} aria-hidden="true">
              {c.hco ? <HcoIcon /> : <NewPersonAccountIcon />}
            </span>
            {c.name}
          </div>
        ))}
      </div>
    </Backdrop>
  );
}

function EmailTemplates({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const [q, setQ] = useState("");
  const all = ctx.snapshot.screens?.fabs?.emailTemplates;
  const shown = (all ?? []).filter((t) =>
    `${t.name}${t.product ?? ""}${t.description ?? ""}`.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <Full>
      <NavBar
        left={linkBtn("Cancel", onClose)}
        title="Send Email"
        right={linkBtn("Next", undefined, true)}
      />
      <div className="studio-ipad-act-tplbar">
        <div className="studio-ipad-act-search wide">
          <Magnifier />
          <input
            placeholder="Search templates..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="studio-ipad-act-filter">
          Product: <b>All</b>
        </span>
        <span className="studio-ipad-act-filter">
          Topics: <b>All</b>
        </span>
      </div>
      <h3 className="studio-ipad-act-tplhead">Email Templates ({shown.length})</h3>
      <div className="studio-ipad-act-body tpls">
        {all === undefined && (
          <Note>This snapshot predates the email template list; publish again to read it.</Note>
        )}
        {shown.map((t) => (
          <div key={t.id} className="studio-ipad-act-tpl">
            <div className="studio-ipad-act-tplrow">
              <div className="studio-ipad-act-tplthumb">
                <span className="studio-ipad-act-tplimg" />
                <span className="studio-ipad-act-tplprev">
                  <Magnifier /> Preview
                </span>
              </div>
              <div className="studio-ipad-act-tplcol name">
                <label>Email Template Name</label>
                <div>{t.name}</div>
              </div>
              <div className="studio-ipad-act-tplcol product">
                <label>Product</label>
                <div>{t.product}</div>
              </div>
              <div className="studio-ipad-act-tplcol desc">
                <label>Description</label>
                <div>{t.description ?? "-"}</div>
              </div>
              <div className="studio-ipad-act-tplcol attach">
                <label>Attachments</label>
              </div>
            </div>
            <div className="studio-ipad-act-tplsel">Select</div>
          </div>
        ))}
      </div>
    </Full>
  );
}

function EmailFlow({
  ctx,
  pickProvider,
  onClose,
}: {
  ctx: SheetContext;
  pickProvider: boolean;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<string | null>(
    pickProvider ? null : (ctx.record?.title ?? "")
  );
  return provider === null ? (
    <ProviderPicker ctx={ctx} onClose={onClose} onPick={setProvider} />
  ) : (
    <EmailTemplates ctx={ctx} onClose={onClose} />
  );
}

// ── Next Best Customer and Survey ─────────────────────────────────────────────

/** The "Why" sheet writes the address street, city, state, country, postal code with two spaces after each comma; the card text has the postal code second. */
function nbcAddress(address: string): string {
  const parts = address.split(", ");
  if (parts.length === 5 && /\d/.test(parts[1])) parts.push(parts.splice(1, 1)[0]);
  return parts.join(",  ");
}

function NbcSheet({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const card = ctx.snapshot.screens?.accounts?.cards.find((c) => c.id === ctx.record?.id);
  const title = ctx.record?.title ?? "";
  return (
    <Backdrop onClose={onClose} className="nbc">
      <div className="studio-ipad-act-grabber" />
      <NavBar plain left={null} title={`Why ${title}?`} right={linkBtn("Close", onClose)} />
      <div className="studio-ipad-act-body nbc">
        <div className="studio-ipad-act-white">
          <div className="studio-ipad-act-prov plain">
            <span className="studio-ipad-act-avatar" aria-hidden="true">
              {card?.hco ? <HcoIcon /> : <NewPersonAccountIcon />}
            </span>
            <span className="studio-ipad-act-blue">{title}</span>
          </div>
          {card?.address && <div className="studio-ipad-act-addr">{nbcAddress(card.address)}</div>}
          <span className="studio-ipad-act-outline">Visit</span>
        </div>
        <div className="studio-ipad-act-white empty">
          <EmptyArt height={188} />
          <div className="studio-ipad-act-emptyt">Nothing to see here... yet</div>
          <div className="studio-ipad-act-emptyd">
            After your admin adds rationales, you'll see them here. Make sure you're connected to
            the internet to sync the latest changes.
          </div>
        </div>
        <Note>
          The rationales are read from the org by the app; the preview shows the empty state.
        </Note>
      </div>
    </Backdrop>
  );
}

function SurveySheet({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"Open" | "Completed">("Open");
  return (
    <Backdrop onClose={onClose} className="survey">
      <NavBar left={linkBtn("Close", onClose)} title="Surveys" />
      <div className="studio-ipad-act-seg">
        {(["Open", "Completed"] as const).map((t) => (
          <span key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
            {t}
          </span>
        ))}
      </div>
      <div className="studio-ipad-act-search">
        <Magnifier />
        <input placeholder="Search..." />
      </div>
      <div className="studio-ipad-act-empty">
        <EmptyArt height={188} />
        <div className="studio-ipad-act-emptyt">No data available</div>
      </div>
      <Note>Surveys are read from the org by the app; the preview doesn't list them.</Note>
    </Backdrop>
  );
}

// ── Custom actions: in-app browser, Safari, placeholder ───────────────────────

/** The parts of Electron's <webview> element the preview browser uses. */
interface WebviewEl extends HTMLElement {
  getWebContentsId(): number;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
}

/** The sign-in picked for a rep's pages when Studio held no login for them, kept for the app session. */
const rememberedAuth = new Map<string, BrowserAuth>();

type BrowserStatus = { signedInAs?: string; note?: string; error?: string };

/**
 * The in-app browser, live: the page loads in a <webview> with an in-memory session per identity. Salesforce
 * pages are signed in as the previewed rep through their mobile login — the same logins First sync uses — so
 * they show what the rep sees; until Studio holds one, the sheet offers to sign in as the rep, or to continue
 * as the sf CLI connection. Pages outside Salesforce load signed out. Only https pages load.
 */
function Browser({
  url,
  hideSafari,
  ctx,
  onClose,
}: {
  url: string;
  hideSafari: boolean;
  ctx: SheetContext;
  onClose: () => void;
}) {
  const ref = useRef<WebviewEl>(null);
  const viewer = ctx.snapshot.viewer;
  const live = /^https:\/\//i.test(url);
  const host = live ? new URL(url).hostname : "";
  const memoKey = `${myDomainOf(host) ?? host}|${viewer?.userId ?? ""}`;
  const mobile = useMobileLogins();
  const logins = mobile.loaded ? mobile.logins : null;
  const [picked, setPicked] = useState<BrowserAuth | null>(null);
  const [asking, setAsking] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [nav, setNav] = useState({ back: false, forward: false });

  const choice = logins
    ? chooseAuth(url, logins, viewer?.userId ?? null, rememberedAuth.get(memoKey) ?? null)
    : null;
  const auth = asking ? null : (picked ?? choice?.auth ?? null);
  const authLogin =
    auth && "loginId" in auth ? logins?.find((l) => l.id === auth.loginId) : undefined;
  const isRep = !!authLogin && !!viewer && sameUserId(authLogin.userId, viewer.userId);
  const partition = auth ? partitionFor(auth) : null;

  const use = (next: BrowserAuth) => {
    rememberedAuth.set(memoKey, next);
    setPicked(next);
    setAsking(false);
    setStatus(null);
  };
  const logIn = async () => {
    setLoggingIn(true);
    setLoginError(null);
    const res = await window.lscApi.mobileLoginStart(
      loginUrlFor(host) ?? "https://login.salesforce.com"
    );
    setLoggingIn(false);
    if (!res.login) {
      setLoginError(res.error ?? "The login didn't finish.");
      return;
    }
    use({ loginId: res.login.id });
  };

  useEffect(() => {
    const wv = ref.current;
    if (!wv || !auth) return;
    let opened = false;
    const onReady = () => {
      if (opened) return;
      opened = true;
      window.lscApi.studioBrowserOpen(wv.getWebContentsId(), url, auth).then(setStatus);
    };
    const onNavigate = () => setNav({ back: wv.canGoBack(), forward: wv.canGoForward() });
    wv.addEventListener("dom-ready", onReady);
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavigate);
    return () => {
      wv.removeEventListener("dom-ready", onReady);
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavigate);
    };
    // A new identity remounts the webview (keyed by partition), so re-run only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, partition]);

  const ico = (label: string, glyph: string, enabled: boolean, act: () => void) => (
    <button
      type="button"
      className={`studio-ipad-act-ico${enabled ? "" : " disabled"}`}
      aria-label={label}
      title={label}
      disabled={!enabled}
      onClick={act}
    >
      {glyph}
    </button>
  );

  const rep = viewer?.name ?? "a rep";
  const statusText = !status
    ? null
    : status.error
      ? `Couldn't load the page: ${status.error}`
      : status.note
        ? status.note
        : status.signedInAs
          ? isRep
            ? `Signed in as ${authLogin?.displayName ?? status.signedInAs}, the previewed rep`
            : auth && "cli" in auth
              ? `Signed in as ${status.signedInAs} — Studio's sf CLI connection, not ${rep}`
              : `Signed in as ${authLogin?.displayName ?? status.signedInAs}, not ${rep}`
          : null;
  const offerSwitch = !!status && !isRep && !!auth && !("public" in auth);

  return (
    <Full className="browser">
      <NavBar
        left={linkBtn("Close", onClose)}
        title="External URL"
        right={
          <>
            {ico("Back", "‹", nav.back, () => ref.current?.goBack())}
            {ico("Forward", "›", nav.forward, () => ref.current?.goForward())}
            {ico("Reload", "↻", !!auth, () => ref.current?.reload())}
            {!hideSafari &&
              ico("Open in browser", "◎", live, () =>
                window.lscApi.openExternal(ref.current?.getURL() || url)
              )}
          </>
        }
      />
      {!live ? (
        <div className="studio-ipad-act-webplaceholder">
          <div className="studio-ipad-act-weburl">{url}</div>
          <div className="studio-ipad-act-webnote">
            The app loads this page in a full-screen browser. Studio only loads https pages; it
            shows the address instead.
          </div>
        </div>
      ) : auth && partition ? (
        <div className="studio-ipad-act-web">
          <webview
            key={partition}
            ref={ref}
            className="studio-ipad-act-webview"
            src="about:blank"
            partition={partition}
          />
          {statusText && (
            <div className={`studio-ipad-act-webstatus${status?.error ? " error" : ""}`}>
              {statusText}
              {offerSwitch && (
                <button type="button" onClick={() => setAsking(true)}>
                  {viewer ? `Sign in as ${viewer.name}…` : "Switch user…"}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="studio-ipad-act-webplaceholder">
          {!logins ? (
            <div className="studio-ipad-act-webnote">Checking Studio's test users…</div>
          ) : (
            <div className="studio-ipad-act-signin">
              <div className="studio-ipad-act-signint">See this page as {rep}</div>
              <div className="studio-ipad-act-webnote">
                The app opens it signed in as the rep. Sign in as {rep} once and Studio keeps them
                as a test user for this page, inline components and First sync.
              </div>
              <button
                type="button"
                className="studio-ipad-act-signinbtn"
                onClick={logIn}
                disabled={loggingIn}
              >
                {loggingIn
                  ? "Waiting for sign-in…"
                  : viewer
                    ? `Sign in as ${viewer.name}…`
                    : "Sign in a test user…"}
              </button>
              {loginError && <div className="studio-ipad-act-signinerr">{loginError}</div>}
              {(choice?.candidates ?? []).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="studio-link-btn"
                  onClick={() => use({ loginId: l.id })}
                >
                  Use {l.displayName ?? l.username} instead
                </button>
              ))}
              <button type="button" className="studio-link-btn" onClick={() => use({ cli: true })}>
                Continue as Studio's sf CLI connection
              </button>
              <div className="studio-ipad-act-weburl">{url}</div>
            </div>
          )}
        </div>
      )}
    </Full>
  );
}

function Placeholder({
  p,
  onClose,
}: {
  p: Extract<Presentation, { kind: "placeholder" | "safari" }>;
  onClose: () => void;
}) {
  const safari = p.kind === "safari";
  return (
    <Backdrop onClose={onClose} className="placeholder">
      <NavBar
        plain
        left={null}
        title={safari ? "Opens in Safari" : p.title}
        right={linkBtn("Close", onClose)}
      />
      <div className="studio-ipad-act-body">
        <dl className="studio-ipad-act-facts">
          <dt>Action</dt>
          <dd>{safari ? "URL (external target)" : p.title}</dd>
          <dt>Type</dt>
          <dd>{safari ? "URL" : p.type}</dd>
          <dt>Target</dt>
          <dd>{safari ? p.url : p.target}</dd>
        </dl>
        <Note>
          {safari
            ? "The app leaves for Safari with this address. Studio doesn't open it."
            : p.detail}
        </Note>
      </div>
    </Backdrop>
  );
}

// ── Agentforce panel ──────────────────────────────────────────────────────────

function AgentPanel({
  ctx,
  utterance,
  onClose,
}: {
  ctx: SheetContext;
  utterance: string;
  onClose: () => void;
}) {
  const name = agentName(ctx.snapshot.viewer?.permissionSets);
  return (
    <Full className="agent">
      <div className="studio-ipad-act-agentnav">
        <button
          type="button"
          className="studio-ipad-act-circle"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        <div className="studio-ipad-act-agentt">{name}</div>
        <span className="studio-ipad-act-circle" aria-label="Clear chat">
          <AstroIcon size={24} />
        </span>
      </div>
      <div className="studio-ipad-act-chat">
        {utterance && <div className="studio-ipad-act-bubble">{utterance}</div>}
        {!utterance && (
          <Note>
            The app opens a chat with {name}. Studio doesn't talk to the agent
            {utterance ? "" : " or show earlier messages"}; nothing is sent.
          </Note>
        )}
        {utterance && (
          <Note>
            The app sends this message to {name} and shows its reply. The preview doesn't send it.
          </Note>
        )}
      </div>
      <div className="studio-ipad-act-composer">
        <div className="studio-ipad-act-ask">Ask me anything</div>
        <div className="studio-ipad-act-composer-row">
          <span className="studio-ipad-act-agentpill">
            <AstroIcon size={24} />
            {name} <Caret />
          </span>
          <span className="studio-ipad-act-mic" aria-hidden="true">
            <svg width="18" height="24" viewBox="0 0 18 24">
              <rect x="5.5" y="1" width="7" height="13" rx="3.5" fill="#fff" />
              <path
                d="M2 11a7 7 0 0 0 14 0M9 18v4"
                fill="none"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </div>
      </div>
      <div className="studio-ipad-act-disclaimer">Agentforce is AI and can make mistakes</div>
    </Full>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

export default function IpadActionSheet({
  presentation,
  ctx,
  onClose,
}: {
  presentation: Presentation;
  ctx: SheetContext;
  onClose: () => void;
}) {
  switch (presentation.kind) {
    case "visit":
      return <VisitEditor ctx={ctx} edit={presentation.edit} onClose={onClose} />;
    case "inquiry":
      return <InquirySheet ctx={ctx} onClose={onClose} />;
    case "email":
      return <EmailFlow ctx={ctx} pickProvider={presentation.pickProvider} onClose={onClose} />;
    case "nbc":
      return <NbcSheet ctx={ctx} onClose={onClose} />;
    case "survey":
      return <SurveySheet onClose={onClose} />;
    case "browser":
      return (
        <Browser
          url={presentation.url}
          hideSafari={presentation.hideSafari}
          ctx={ctx}
          onClose={onClose}
        />
      );
    case "agent":
      return <AgentPanel ctx={ctx} utterance={presentation.utterance} onClose={onClose} />;
    case "safari":
    case "placeholder":
      return <Placeholder p={presentation} onClose={onClose} />;
  }
}
