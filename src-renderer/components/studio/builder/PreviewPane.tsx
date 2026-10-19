import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, House, LogIn, RefreshCw, RotateCcw, RotateCwSquare, Tablet, TriangleAlert, Users, CalendarDays, X } from "lucide-react";
import Segmented from "../../ui/Segmented";
import Spinner from "../../ui/Spinner";
import StateView from "../../ui/StateView";
import LiveAppFrame from "./LiveAppFrame";
import RecordPicker, { readRecordFacts, searchRecords, type PreviewRecord } from "./RecordPicker";
import { useAppPreview } from "./useAppPreview";
import { BEZEL, DEFAULT_ORIENTATION, DEVICES, fitDevice, orientedSize, versionNumber, ZOOMS, type Orientation, type Zoom } from "./logic";
import { useSignIn, type RunAsState } from "./RunAs";
import type { AppProject } from "./types";

const DEFAULT_HEIGHT = 400;
/** A tab fills the screen (its height follows the device); an action sheet is a fixed height. Neither has a mobileHeight. */
const SHEET_HEIGHT = 580;
/** An iPad form sheet is about 540 x 620 pt (its title bar takes the difference), centered. */
const SHEET_WIDTH = 540;
/** What a tab's screen spends on the status bar, title and tab bar, in points. */
const TAB_CHROME = 160;

interface PreviewPaneProps {
  project: AppProject;
  versionId: string | null;
  building: boolean;
  /** Whose login the data is read as. */
  runAs: RunAsState;
  onOpenChecks: () => void;
  /** Where the record picker and device tools go: the workspace's second header row. Drawn in place until it exists. */
  toolsSlot?: HTMLElement | null;
}

/** The zoom choice, remembered across projects. */
function useZoom(): [Zoom, (z: Zoom) => void] {
  const [z, setZ] = useState<Zoom>(() => {
    const v = window.localStorage.getItem("bld-zoom");
    return v === "75" || v === "100" ? v : "fit";
  });
  return [z, (next) => (window.localStorage.setItem("bld-zoom", next), setZ(next))];
}

/** The frame's orientation, remembered per project for the session. */
function useOrientation(projectId: string): [Orientation, () => void] {
  const key = `bld-orientation:${projectId}`;
  const read = (): Orientation => (window.sessionStorage.getItem(key) === "portrait" ? "portrait" : DEFAULT_ORIENTATION);
  const [o, setO] = useState<Orientation>(read);
  useEffect(() => setO(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const rotate = () => {
    const next: Orientation = o === "landscape" ? "portrait" : "landscape";
    window.sessionStorage.setItem(key, next);
    setO(next);
  };
  return [o, rotate];
}

interface Layer {
  key: string;
  script: string;
}

/** The app as the iPad would show it, live: the last good version stays until the next one compiles, then crossfades in. */
export default function PreviewPane({ project, versionId, building, runAs, onOpenChecks, toolsSlot }: PreviewPaneProps) {
  const { state, reload, nonce } = useAppPreview(project.id, versionId);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [notes, setNotes] = useState<{ text: string; tone: "info" | "error" }[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [record, setRecord] = useState<PreviewRecord | null>(null);
  const [recordState, setRecordState] = useState<"loading" | "none" | "error" | "ready">("loading");
  const [facts, setFacts] = useState<{ label: string; value: string }[]>([]);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const wrap = useRef<HTMLDivElement>(null);

  const isRecord = project.target === "record" || project.target === "action";
  const isAction = project.target === "action";
  const isTab = project.target === "tab";
  const [closed, setClosed] = useState(false);
  const device = DEVICES.ipad;
  const [orientation, rotate] = useOrientation(project.id);
  const screen = orientedSize(device, orientation);
  const [zoom, setZoom] = useZoom();
  const fit = fitDevice(device, orientation, room, zoom);
  const tabHeight = screen.height - TAB_CHROME;
  const loginId = runAs.kind === "user" ? runAs.loginId : undefined;
  const blocked = runAs.kind === "expired" || runAs.kind === "missing";
  const { busy: signingIn, error: signInError, signIn, canSignIn } = useSignIn();
  const object = project.objectApiName ?? "Account";

  // The device is laid out in points and scaled whole into the room the pane has.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      setRoom((r) => (Math.abs(r.width - w) < 1 && Math.abs(r.height - h) < 1 ? r : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A record to start from: the first the org returns.
  const [findNonce, setFindNonce] = useState(0);
  useEffect(() => {
    if (!isRecord) return;
    let live = true;
    setRecord(null);
    setRecordState("loading");
    searchRecords(object, "").then(
      (r) => {
        if (!live) return;
        setRecord(r[0] ?? null);
        setRecordState(r[0] ? "ready" : "none");
      },
      () => live && setRecordState("error")
    );
    return () => {
      live = false;
    };
  }, [isRecord, object, findNonce]);
  useEffect(() => {
    if (record && recordState === "none") setRecordState("ready");
  }, [record, recordState]);

  // What the page behind an action sheet shows: a few of the record's own fields, read as the same login as the app.
  useEffect(() => {
    if (!isAction || !record) return setFacts([]);
    let live = true;
    readRecordFacts(record.id, loginId).then(
      (f) => live && setFacts(f),
      () => live && setFacts([])
    );
    return () => {
      live = false;
    };
  }, [isAction, record, loginId]);

  useEffect(() => {
    if (state.status !== "ready" || (isRecord && !record)) return;
    const key = `${versionId}:${nonce}:${record?.id ?? ""}:${loginId ?? ""}`;
    setHeight(isTab ? tabHeight : isAction ? SHEET_HEIGHT : state.check?.mobileHeight ?? DEFAULT_HEIGHT);
    setClosed(false);
    setFailure(null);
    setNotes([]);
    setLayers((l) => (l[l.length - 1]?.key === key ? l : [...l.slice(-1), { key, script: state.script }]));
  }, [state, versionId, nonce, record, isRecord, isTab, isAction, loginId, tabHeight]);
  useEffect(() => {
    if (layers.length < 2) return;
    const t = setTimeout(() => setLayers((l) => l.slice(-1)), 500);
    return () => clearTimeout(t);
  }, [layers]);

  const addNote = (text: string, tone: "info" | "error") => setNotes((n) => (n.some((x) => x.text === text) ? n : [...n.slice(-2), { text, tone }]));
  const ctx = isRecord ? { objectApiName: object, recordId: record?.id } : {};
  const shownNumber = versionNumber(project, versionId);
  const loadingNew = state.status === "loading";

  const body = () => {
    if (!versionId) {
      return building ? (
        <StateView kind="loading" layout="inline" title="Roz is writing the first version" detail="It shows up here as soon as it compiles." />
      ) : (
        <StateView kind="empty" layout="inline" icon={Tablet} title="Nothing to preview yet" detail="Ask Roz to build something." />
      );
    }
    if (blocked) {
      return (
        <StateView
          kind="error"
          layout="inline"
          icon={LogIn}
          title={runAs.kind === "expired" ? `${runAs.name}'s login expired` : `${runAs.name} isn't signed in here`}
          detail={signInError || "Sign in again to preview with their data. The preview won't fall back to your admin login."}
          actions={
            <button className="studio-btn" disabled={signingIn || !canSignIn} onClick={() => void signIn(runAs.kind === "expired" ? runAs.login : undefined)}>
              {signingIn ? <Spinner size={14} /> : <LogIn size={14} aria-hidden="true" />}
              {signingIn ? "Waiting for sign-in…" : runAs.kind === "expired" ? "Sign in again" : "Sign in a test user…"}
            </button>
          }
        />
      );
    }
    if (isRecord && !record) {
      if (recordState === "none") return <StateView kind="empty" layout="inline" icon={Tablet} title={`No ${object} records to preview with`} detail="Pick one with the record picker, or create a record first." />;
      if (recordState === "error")
        return <StateView kind="error" layout="inline" title="Couldn't find a record" detail="The preview needs a record to open the app on." actions={<button className="studio-btn" onClick={() => setFindNonce((n) => n + 1)}>Retry</button>} />;
      return <StateView kind="loading" layout="inline" title="Finding a record to preview with" detail="The app opens on a real record." />;
    }
    if (layers.length === 0) {
      if (state.status === "error") return <StateView kind="error" layout="inline" title="Couldn't load the preview" detail={state.error} actions={<button className="studio-btn" onClick={reload}>Retry</button>} />;
      if (state.status === "broken")
        return (
          <StateView
            kind="error"
            layout="inline"
            title="This version doesn't compile"
            detail={state.error ?? `${state.check?.issues.filter((i) => i.severity === "error").length ?? "Some"} errors stop it from running.`}
            actions={<button className="studio-btn" onClick={onOpenChecks}>See the checks</button>}
          />
        );
      return (
        <div className="bld-device-body" aria-busy="true" aria-label="Loading the preview">
          <div className="ui-skeleton" style={{ height: 14, width: "40%" }} />
          <div className="ui-skeleton" style={{ height: 220, width: "100%" }} />
        </div>
      );
    }
    return null;
  };

  const stack = (
    <div className="bld-stack" style={{ height }}>
      {layers.map((l, i) => (
        <LiveAppFrame
          key={l.key}
          script={l.script}
          name={project.name}
          context={ctx}
          loginId={loginId}
          height={height}
          enter={i === layers.length - 1 && layers.length > 1}
          onNote={addNote}
          onClose={() => i === layers.length - 1 && setClosed(true)}
          onReload={reload}
          onFail={(m) => i === layers.length - 1 && setFailure(m)}
        />
      ))}
      {(building || loadingNew) && layers.length > 0 && (
        <div className="bld-building ui-pop" role="status">
          <Spinner size={12} />
          {building ? "Building the next version…" : `Loading v${shownNumber}…`}
        </div>
      )}
    </div>
  );

  const placeholder = body();
  const failureView = (
    <StateView kind="error" layout="inline" title="The app stopped before it drew anything" detail={failure ?? ""} actions={<button className="studio-btn" onClick={onOpenChecks}>See the checks</button>} />
  );
  const broken = state.status === "broken" && layers.length > 0 && !building;

  const picker = isRecord ? <RecordPicker object={object} record={record} onPick={setRecord} /> : null;
  const viewTools = (
    <div className="bld-foot-tools">
      <Segmented<Zoom> aria-label="Preview size" size="sm" value={zoom} onChange={setZoom} options={ZOOMS} />
      <div className="bld-preview-tools" role="group" aria-label="Preview controls">
        <button type="button" className="ui-icon-btn" onClick={rotate} aria-label="Rotate the device" title="Rotate" disabled={device.orientations.length < 2}>
          <RotateCwSquare size={14} aria-hidden="true" />
        </button>
        <button type="button" className="ui-icon-btn" onClick={reload} aria-label="Reload the preview" title="Reload the preview">
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
  const caption = isTab ? "Full screen" : isAction ? "Opens from the action menu" : `${height} pt tall on the iPad`;

  return (
    <div className="bld-preview">
      {picker && (toolsSlot ? createPortal(picker, toolsSlot) : <div className="bld-preview-bar">{picker}</div>)}

      {broken && (
        <div className="bld-banner warning" role="status">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>v{shownNumber} doesn't compile, so this is the last version that ran.</span>
          <button className="studio-btn sm" onClick={onOpenChecks}>
            See the checks
          </button>
        </div>
      )}

      <div className="bld-device-wrap" ref={wrap}>
        <div className="bld-device-fit" style={{ width: fit.width * fit.scale, height: fit.height * fit.scale }}>
        <div
          className="bld-device"
          role="region"
          aria-label={`${device.label} preview, ${orientation}`}
          style={{ width: fit.width, height: fit.height, padding: BEZEL, transform: `scale(${fit.scale})` }}
        >
          <div className="bld-device-screen">
            <div className="bld-ipad-status" aria-hidden="true" style={{ minHeight: device.safe.top }}>
              <span>9:41</span>
              <span>LSC</span>
            </div>
            {isTab ? (
              <div className="bld-ipad-navtitle" aria-hidden="true">
                {project.label}
              </div>
            ) : isRecord ? (
              <div className="bld-ipad-record">
                <div className="bld-ipad-record-title">
                  <span className="bld-ipad-kicker">{object}</span>
                  <span className="bld-ipad-name">{record?.name ?? "Record"}</span>
                </div>
                <div className="bld-ipad-tabs" aria-hidden="true">
                  <span>Details</span>
                  <span className={isAction ? "" : "active"}>{isAction ? "Activity" : project.label}</span>
                  <span>Related</span>
                </div>
              </div>
            ) : (
              <div className="bld-ipad-home-title" aria-hidden="true">
                Good morning
              </div>
            )}
            <div className={`bld-ipad-body${isTab ? " flush" : ""}`}>
              {isAction ? (
                <div className="bld-ipad-facts" aria-hidden="true">
                  {facts.length > 0 ? (
                    facts.map((f) => (
                      <div key={f.label} className="bld-ipad-fact">
                        <span>{f.label}</span>
                        <strong>{f.value}</strong>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="bld-ghost" />
                      <div className="bld-ghost" />
                      <div className="bld-ghost" />
                    </>
                  )}
                </div>
              ) : (
                placeholder ?? (failure ? failureView : <div className={isTab ? "bld-tab-slot" : "bld-card-slot"}>{stack}</div>)
              )}
              {!isRecord && !isTab && (
                <div className="bld-ipad-ghosts" aria-hidden="true">
                  <div className="bld-ghost" />
                  <div className="bld-ghost" />
                </div>
              )}
            </div>
            {isAction && (
              <>
                <div className="bld-scrim" aria-hidden="true" />
                {closed ? (
                  <div className="bld-sheet-closed" role="status">
                    <span>Closed</span>
                    <button type="button" className="studio-btn sm" onClick={() => (setClosed(false), reload())}>
                      <RotateCcw size={14} aria-hidden="true" />
                      Reopen
                    </button>
                  </div>
                ) : (
                  <div className="bld-sheet" role="dialog" aria-label={project.label} style={{ width: SHEET_WIDTH }}>
                    <div className="bld-sheet-bar">
                      <span className="bld-sheet-title">{project.label}</span>
                      <button type="button" className="ui-icon-btn" onClick={() => setClosed(true)} aria-label="Close the action">
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                    {placeholder ?? (failure ? failureView : stack)}
                  </div>
                )}
              </>
            )}
            {isTab && (
              <nav className="bld-ipad-tabbar" aria-hidden="true" style={{ paddingBottom: device.safe.bottom / 2 }}>
                <span>
                  <House size={16} />
                  Home
                </span>
                <span>
                  <Users size={16} />
                  Accounts
                </span>
                <span>
                  <CalendarDays size={16} />
                  Calendar
                </span>
                <span className="active">
                  <Tablet size={16} />
                  {project.label}
                </span>
              </nav>
            )}
          </div>
        </div>
        </div>
      </div>

      {notes.length > 0 && (
        <ul className="bld-notes" aria-label="From the preview">
          {notes.map((n) => (
            <li key={n.text} className={n.tone}>
              {n.tone === "error" ? <CircleAlert size={14} aria-hidden="true" /> : null}
              {n.text}
            </li>
          ))}
        </ul>
      )}
      <div className="bld-preview-foot">
      <span className="bld-foot-text">
        <span className="ui-num">{caption}</span> ·{" "}
        {runAs.kind === "user" ? `Data as ${runAs.name} sees it (live, not their iPad's offline copy).` : "Data as your Salesforce connection sees it (live, not the iPad's offline copy)."}
      </span>
        {viewTools}
      </div>
    </div>
  );
}
