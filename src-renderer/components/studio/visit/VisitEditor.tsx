import React, { useMemo, useRef, useState } from "react";
import type { RecordFieldSpec } from "../published-types";
import { HcoIcon, NewPersonAccountIcon } from "../assets/icons";
import {
  autoNumber,
  fmtDateTime,
  picklistStart,
  visitFields,
  visitTimes,
} from "../ipad-visit-form";
import type { VisitCreateAccount } from "../screens/fabs-types";
import {
  Caret,
  Control,
  Full,
  layoutsFor,
  linkBtn,
  Mic,
  NavBar,
  Note,
  type SheetContext,
} from "../ipad-sheet-ui";
import { CheckFeedback, type CheckFeedbackHandle } from "./checks/CheckFeedback";
import { emptyDraft, useVisit, VisitDraftProvider, type VisitDraft } from "./draft";
import {
  copyDetails,
  endFromStart,
  fieldLocked,
  headerFields,
  navState,
  recordTypeOptions,
} from "./structure/logic";
import { Alert, DocumentIdSheet, OptionSheet, SignaturePad, useToast } from "./structure/parts";
import { RelatedSections } from "./sections/RelatedSections";
import { VisitSidebar } from "./sections/VisitSidebar";
import { strictestSignatureLevel } from "./sections/logic";
import "../action-sheets.css";

// ── New Visit: the Visit Engagement editor ────────────────────────────────────

export const Lock = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <rect x="4" y="9.5" width="14" height="10" rx="2" fill="currentColor" />
    <path d="M7 9.5V7a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const Shield = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1 2 3v4.5c0 3.4 2.5 6 6 7.5 3.5-1.5 6-4.1 6-7.5V3z" fill="currentColor" />
    <path d="m5.2 8 2 2 3.6-3.8" fill="none" stroke="#fff" strokeWidth="1.6" />
  </svg>
);

export const BADGES: [keyof NonNullable<VisitCreateAccount["licenses"]>, string][] = [
  ["state", "State"],
  ["dea", "DEA"],
  ["sdl", "SDL"],
];

/** "5/15/26, 11:37 AM" (the record collector's format) to a Date; undefined when it does not parse. */
export function parseRecordDate(text: string | undefined): Date | undefined {
  const m = /^(\d+)\/(\d+)\/(\d+),\s+(\d+):(\d+)\s*([AP]M)/i.exec(
    (text ?? "").replace(/\u202f/g, " ")
  );
  if (!m) return undefined;
  const hour = (Number(m[4]) % 12) + (/p/i.test(m[6]) ? 12 : 0);
  return new Date(2000 + Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]));
}

/** lifesciences-ios kIsSignatureAlertDisabled: "Don't Show Again" lasts for the session of the preview. */
let signatureAlertDisabled = false;

const ISO = (d: Date | null | undefined): string => (d ? d.toISOString() : "");
const toDate = (v: string | null | undefined): Date | undefined => {
  const d = v ? new Date(v) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};

type Pending =
  | { kind: "alert-sign" }
  | { kind: "pad" }
  | { kind: "docid" }
  | { kind: "menu" }
  | { kind: "rt"; to: string }
  | { kind: "rt-pick" }
  | { kind: "acct-pick" }
  | { kind: "acct"; to: string }
  | { kind: "pick"; spec: RecordFieldSpec };

export default function VisitEditor({
  ctx,
  edit,
  onClose,
}: {
  ctx: SheetContext;
  edit?: string;
  onClose: () => void;
}) {
  const { snapshot, record } = ctx;
  const existing = edit ? snapshot.records?.byId[edit] : undefined;
  const create = snapshot.screens?.fabs?.visitCreate;
  const structure = snapshot.screens?.visit?.structure;
  const rts = snapshot.objects.Visit?.recordTypes ?? [];
  const [rtName, setRtName] = useState<string>(
    () => existing?.recordType ?? rts[rts.length - 1]?.name ?? ""
  );
  const rt = rts.find((r) => r.name === rtName) ?? rts[rts.length - 1];
  const layouts = rt ? layoutsFor(snapshot, "Visit", rt.name) : [];
  const times = useMemo(
    () =>
      visitTimes(
        new Date(),
        structure?.durationMinutes ?? create?.durationMinutes ?? 30,
        create?.blankStart ?? false
      ),
    [structure?.durationMinutes, create?.durationMinutes, create?.blankStart]
  );
  const seedDraft = (): VisitDraft => {
    const d = emptyDraft();
    const val = (name: string): string | undefined =>
      existing?.values.Visit?.[name.toLowerCase()] ||
      existing?.values.ProviderVisit?.[name.toLowerCase()] ||
      undefined;
    if (existing) {
      const row = snapshot.screens?.home?.visits?.items.find((v) => v.id === edit);
      const name = row?.account ?? existing.values.Visit?.accountid;
      const acct = name
        ? Object.entries(snapshot.records?.byId ?? {}).find(
            ([, r]) => r.object === "Account" && r.title === name
          )?.[0]
        : undefined;
      d.values = {
        AccountId: acct ?? "",
        PlaceId: row?.address ?? val("PlaceId") ?? "",
        PlannedVisitStartTime: ISO(parseRecordDate(val("PlannedVisitStartTime"))),
        PlannedVisitEndTime: ISO(parseRecordDate(val("PlannedVisitEndTime"))),
        TerritoryId: val("TerritoryId") ?? "",
        Status: val("Status") ?? "",
        Channel: (row?.channel || val("Channel")) ?? "",
        PreProviderVisitNotes: val("PreProviderVisitNotes") ?? "",
      };
      for (const f of visitFields(layouts, { edit: true }))
        if (f.type !== "blank" && d.values[f.name] === undefined && f.name !== "Name")
          d.values[f.name] = val(f.name) ?? "";
      d.status = d.values.Status;
      d.signature = val("SignatureType")
        ? {
            type: /physical/i.test(val("SignatureType") ?? "") ? "physical" : "digital",
            documentId: val("PhysicalFormIdentifier"),
          }
        : undefined;
    } else {
      const accountId = record?.object === "Account" ? record.id : "";
      d.values = {
        AccountId: accountId,
        PlaceId: create?.accounts[accountId]?.place?.text ?? "",
        PlannedVisitStartTime: ISO(times.start),
        PlannedVisitEndTime: ISO(times.end),
        TerritoryId: create?.territory ?? "",
        Status: "Planned",
      };
      d.status = "Planned";
    }
    d.recordTypeName = rt?.name;
    return d;
  };
  return (
    <VisitDraftProvider sheet={ctx} editId={edit} layouts={layouts} initial={seedDraft}>
      <Shell ctx={ctx} edit={edit} onClose={onClose} rtName={rtName} setRtName={setRtName} />
    </VisitDraftProvider>
  );
}

function Shell({
  ctx,
  edit,
  onClose,
  rtName,
  setRtName,
}: {
  ctx: SheetContext;
  edit?: string;
  onClose: () => void;
  rtName: string;
  setRtName: (n: string) => void;
}) {
  const { snapshot, layouts, draft, update, openAttendee } = useVisit();
  const create = snapshot.screens?.fabs?.visitCreate;
  const structure = snapshot.screens?.visit?.structure;
  const existing = edit ? snapshot.records?.byId[edit] : undefined;
  const rts = snapshot.objects.Visit?.recordTypes ?? [];
  const checks = useRef<CheckFeedbackHandle | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, say] = useToast();
  const [attendeeValues, setAttendeeValues] = useState<Record<string, Record<string, string>>>({});
  const seed = useMemo(() => crypto.randomUUID().toUpperCase(), []);

  const serverAttendees = (edit && structure?.attendees[edit]) || [];
  const attendees = [
    ...serverAttendees,
    ...(draft.rows.Visit ?? [])
      .filter((r) => !serverAttendees.some((a) => a.id === r.id))
      .map((r) => ({
        id: r.id,
        name: r.values.AccountName || "Attendee",
        account: r.values.AccountName || undefined,
        status: undefined as string | undefined,
      })),
  ];
  const globalMsgs = draft.checkMessages.filter((m) => m.where === "global");
  const complianceMsgs = draft.checkMessages.filter((m) => m.where === "compliance");
  const msgList = (list: typeof globalMsgs) =>
    list.map((m, i) => (
      <div key={i} className={`visit-msg ${m.severity}`} role="alert">
        {m.text}
      </div>
    ));
  const child = attendees.find((a) => a.id === draft.attendeeId);
  const v = (name: string): string => draft.values[name] ?? "";
  const setV = (name: string, value: string) =>
    update((d) => ({
      values: { ...d.values, [name]: value },
      fieldErrors: { ...d.fieldErrors, [name]: "" },
    }));

  const accountId = v("AccountId");
  const account = accountId ? create?.accounts[accountId] : undefined;
  const accountRec = accountId ? snapshot.records?.byId[accountId] : undefined;
  const accountTitle = accountRec?.title ?? (accountId === ctx.record?.id ? ctx.record?.title : "");
  const organisation = !!account && !account.person;
  const status = draft.status ?? v("Status");
  const signed = !!draft.signature;
  const nav = navState({
    level: strictestSignatureLevel(draft.rows, snapshot.screens?.visit?.sections?.products ?? []),
    signed,
    isNew: !existing,
    status,
    remote: /remote|video/i.test(v("Channel")),
    child: !!child,
    showDocumentId: structure?.showDocumentId ?? true,
  });
  const rt = rts.find((r) => r.name === rtName);
  const rtOptions = recordTypeOptions(
    structure?.recordTypeMap,
    accountRec?.recordType,
    rts.map((r) => r.name)
  );
  const fields = useMemo(
    () =>
      headerFields(visitFields(layouts, { edit: !!existing }), { organisation, isNew: !existing }),
    [layouts, existing, organisation]
  );
  const badgeAccount = account;
  const hasLicense = !!badgeAccount?.licenses && BADGES.some(([k]) => badgeAccount.licenses?.[k]);
  const readOnlyHeader = !!child;
  const start = toDate(v("PlannedVisitStartTime"));

  const nextVisit = useMemo(() => {
    const items = snapshot.screens?.home?.visits?.items ?? [];
    const name = accountTitle;
    return name ? items.find((x) => x.id !== edit && x.account === name) : undefined;
  }, [snapshot, edit, accountTitle]);

  const signWith = (type: "digital" | "physical", documentId?: string) => {
    update((d) => ({
      signature: { type, documentId },
      values: {
        ...d.values,
        SignatureType: type,
        ...(documentId ? { PhysicalFormIdentifier: documentId } : {}),
      },
    }));
    say(type === "physical" ? "Document ID was saved" : "Signature Captured");
    setPending(null);
  };

  const onPassed = (mode: string) => {
    if (mode === "sign") {
      setPending(signatureAlertDisabled ? { kind: "pad" } : { kind: "alert-sign" });
    } else if (mode === "submit") {
      update({ status: "Completed" });
      say("Visit submitted");
    } else if (mode === "save") say("Visit saved");
  };

  const pickAccount = (id: string) => {
    const a = create?.accounts[id];
    update((d) => ({
      values: { ...d.values, AccountId: id, PlaceId: a?.place?.text ?? "" },
    }));
    setPending(null);
  };

  const control = (s: RecordFieldSpec): React.ReactNode => {
    const locked = readOnlyHeader || fieldLocked(s.name, signed) || s.readOnly;
    switch (s.name) {
      case "AccountId":
        return (
          <div className={`studio-ipad-act-box tall acct${accountId ? "" : " none"}`}>
            {accountId ? (
              <>
                <span
                  className="studio-ipad-act-acctico"
                  style={{ background: account?.person === false ? "#4a8fdb" : "#5867e8" }}
                >
                  {account?.person === false ? <HcoIcon /> : <NewPersonAccountIcon />}
                </span>
                <span className="studio-ipad-act-acctname">{accountTitle}</span>
                <span className="studio-ipad-act-acctsub">{account?.subLabel ?? ""}</span>
              </>
            ) : (
              <span className="studio-ipad-act-acctnone">None</span>
            )}
            {!locked && (
              <span
                className="studio-ipad-act-switch visit-pill-btn"
                onClick={() => setPending({ kind: "acct-pick" })}
              >
                Switch Account
              </span>
            )}
          </div>
        );
      case "PlaceId":
        return (
          <div className={`studio-ipad-act-box tall place${v("PlaceId") ? "" : " none"}`}>
            <div className="studio-ipad-act-placetext">{v("PlaceId") || "None"}</div>
            {hasLicense && (
              <div className="studio-ipad-act-badges">
                {BADGES.map(([k, label]) =>
                  badgeAccount?.licenses?.[k] ? (
                    <span key={k} className={`studio-ipad-act-badge ${badgeAccount.licenses[k]}`}>
                      <Shield />
                      {label}
                    </span>
                  ) : null
                )}
              </div>
            )}
            <Caret />
          </div>
        );
      case "PlannedVisitStartTime":
      case "PlannedVisitEndTime": {
        const d = toDate(v(s.name));
        return <Control spec={{ ...s, readOnly: false }} value={d ? fmtDateTime(d) : ""} />;
      }
      case "TerritoryId":
        return <div className="studio-ipad-act-static">{v("TerritoryId")}</div>;
      case "Status":
        return <div className="studio-ipad-act-static">{status}</div>;
      case "OwnerId":
        return <div className="studio-ipad-act-static">{snapshot.viewer?.name ?? ""}</div>;
      case "RecordTypeId":
        return (
          <div
            className="studio-ipad-act-box visit-pill-btn"
            onClick={() => !locked && setPending({ kind: "rt-pick" })}
          >
            <span>{rt?.label ?? ""}</span>
            <Caret />
          </div>
        );
      case "Name":
        if (!existing) return <div className="studio-ipad-act-static">{autoNumber(seed)}</div>;
        return <Control spec={s} value={existing.title} />;
      case "External_ID__c":
        return (
          <div className="studio-ipad-act-box">
            <span className="studio-ipad-act-grow" />
            <Mic />
          </div>
        );
    }
    if (/^(double|int|currency|percent)$/.test(s.type))
      return <div className="studio-ipad-act-static">{v(s.name)}</div>;
    if (locked) return <div className="studio-ipad-act-static">{v(s.name)}</div>;
    if (s.type === "picklist") {
      const label =
        s.picklist?.[v(s.name)] ?? v(s.name) ?? picklistStart(s, rt?.picklistDefaults) ?? "";
      return (
        <div
          className="studio-ipad-act-box visit-pill-btn"
          onClick={() => setPending({ kind: "pick", spec: s })}
        >
          <span>{label || picklistStart(s, rt?.picklistDefaults) || ""}</span>
          <Caret />
        </div>
      );
    }
    if (/^(string|text|textarea|url|email|phone)$/.test(s.type)) {
      return s.type === "textarea" ? (
        <textarea
          className="studio-ipad-act-input area"
          aria-label={s.label}
          value={v(s.name)}
          onChange={(e) => setV(s.name, e.target.value)}
        />
      ) : (
        <input
          className="studio-ipad-act-input"
          aria-label={s.label}
          value={v(s.name)}
          onChange={(e) => setV(s.name, e.target.value)}
        />
      );
    }
    return <Control spec={s} value={v(s.name)} />;
  };

  const header = (
    <div className="studio-ipad-act-main">
      {msgList(globalMsgs)}
      <div className="studio-ipad-act-mainhead">
        <span>
          <span className="studio-ipad-act-chev down">›</span>
          {layouts[0]?.sections[0]?.label ?? "Visit Information"}
        </span>
        {!readOnlyHeader && (
          <span className="studio-ipad-act-reqnote">
            <span className="studio-ipad-act-req">*</span> Required
          </span>
        )}
      </div>
      {layouts.length ? (
        <div className="studio-ipad-act-grid two">
          {fields.map((s, i) =>
            s.type === "blank" ? (
              <div key={i} />
            ) : (
              <div
                key={s.name}
                className={`studio-ipad-act-field vfield${s.name === "AccountId" || s.name === "PlaceId" ? " tall" : ""}`}
              >
                <div className="studio-ipad-act-label">
                  {s.required && !readOnlyHeader && <span className="studio-ipad-act-req">*</span>}
                  {s.label}
                </div>
                {control(s)}
                {draft.fieldErrors[s.name] && (
                  <div className="visit-fielderr">{draft.fieldErrors[s.name]}</div>
                )}
              </div>
            )
          )}
        </div>
      ) : (
        <Note>The Visit layout isn't in the cache.</Note>
      )}
      {!child && v("PreProviderVisitNotes") && (
        <div className="visit-block">
          <div className="visit-block-head">Pre Provider Visit Notes</div>
          <div className="visit-notes">{v("PreProviderVisitNotes")}</div>
        </div>
      )}
      {!child && nextVisit && (
        <div className="visit-block">
          <div className="visit-block-head">Next Scheduled Visit</div>
          <div className="visit-notes">
            {nextVisit.dateLabel} {nextVisit.time}
            {nextVisit.address ? ` · ${nextVisit.address}` : ""}
          </div>
        </div>
      )}
      {!child && !!structure?.compliance.length && (
        <div className="visit-block">
          <div className="visit-block-head">Compliance Statements</div>
          {msgList(complianceMsgs)}
          {structure.compliance.map((c) => (
            <div key={c.id} className="visit-compliance">
              {c.note ? (
                <span>{c.label}</span>
              ) : (
                <>
                  <button
                    type="button"
                    className={`visit-check${draft.compliance[c.id] ? " on" : ""}`}
                    aria-label={c.label}
                    aria-pressed={!!draft.compliance[c.id]}
                    disabled={isCompletedStatus(status)}
                    onClick={() =>
                      update((d) => ({
                        compliance: { ...d.compliance, [c.id]: !d.compliance[c.id] },
                      }))
                    }
                  >
                    {draft.compliance[c.id] ? "✓" : ""}
                  </button>
                  <span>
                    {c.required && <span className="studio-ipad-act-req">*</span>}
                    {c.label}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <RelatedSections />
    </div>
  );

  return (
    <Full>
      <NavBar
        left={linkBtn(nav.leftLabel, onClose)}
        title={nav.title}
        right={
          <>
            {nav.startRemote && (
              <span className="studio-ipad-act-pill">Start Remote Engagement</span>
            )}
            {nav.getSignature && (
              <span
                className={`studio-ipad-act-pill visit-pill-btn${nav.signEnabled ? "" : " disabled"}`}
                onClick={() => nav.signEnabled && checks.current?.request("sign")}
              >
                <Lock />
                Get Signature
              </span>
            )}
            <span
              className="studio-ipad-act-pill visit-pill-btn"
              onClick={() => checks.current?.request("save")}
            >
              Save
            </span>
            <span
              className={`studio-ipad-act-pill split visit-pill-btn${nav.submitEnabled ? "" : " disabled"}`}
              onClick={() => nav.submitEnabled && checks.current?.request("submit")}
            >
              Submit
              <span
                className="studio-ipad-act-split"
                onClick={(e) => {
                  e.stopPropagation();
                  setPending(nav.documentId ? { kind: "menu" } : null);
                }}
              >
                <Caret />
              </span>
            </span>
          </>
        }
      />
      {attendees.length > 1 && (
        <div className="visit-carousel">
          {attendees.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`visit-attendee${draft.attendeeId === a.id ? " on" : ""}`}
              onClick={() => openAttendee?.(draft.attendeeId === a.id ? undefined : a.id)}
            >
              {a.account ?? a.name}
              {a.status && <small>{a.status}</small>}
            </button>
          ))}
          {!child && (
            <button
              type="button"
              className="visit-copy"
              onClick={() => {
                setAttendeeValues((prev) =>
                  Object.fromEntries(
                    attendees.map((a) => [a.id, copyDetails(draft.values, prev[a.id] ?? {})])
                  )
                );
                say("Details copied");
              }}
            >
              Copy Details
            </button>
          )}
        </div>
      )}
      <div className="studio-ipad-act-visit">
        <VisitSidebar organisation={organisation} />
        {header}
      </div>
      <CheckFeedback handle={checks} onPassed={onPassed} />
      {toast}

      {pending?.kind === "alert-sign" && (
        <Alert
          title="Just a heads-up..."
          message="Navigating from the next screen is limited. You'll need to authenticate to go back to the Visit screen."
          actions={[
            { label: "Ok", onClick: () => setPending({ kind: "pad" }) },
            {
              label: "Don't Show Again",
              onClick: () => {
                signatureAlertDisabled = true;
                setPending({ kind: "pad" });
              },
            },
          ]}
        />
      )}
      {pending?.kind === "pad" && (
        <SignaturePad onCancel={() => setPending(null)} onDone={() => signWith("digital")} />
      )}
      {pending?.kind === "menu" && (
        <div className="visit-alert-scrim" onClick={() => setPending(null)}>
          <div
            className="visit-options"
            style={{ top: 56, right: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="visit-option"
              onClick={() => setPending({ kind: "docid" })}
            >
              Document ID
            </button>
          </div>
        </div>
      )}
      {pending?.kind === "docid" && (
        <DocumentIdSheet
          initial={draft.signature?.documentId}
          onCancel={() => setPending(null)}
          onSave={(id) => signWith("physical", id)}
        />
      )}
      {pending?.kind === "rt-pick" && (
        <OptionSheet
          title="Record Type"
          value={rtName}
          options={rtOptions.map((n) => ({
            value: n,
            label: rts.find((r) => r.name === n)?.label ?? n,
          }))}
          onClose={() => setPending(null)}
          onPick={(n) => (n === rtName ? setPending(null) : setPending({ kind: "rt", to: n }))}
        />
      )}
      {pending?.kind === "rt" && (
        <Alert
          title="Update record type?"
          message="Updating the record type can remove fields and their values."
          row
          actions={[
            { label: "Cancel", onClick: () => setPending(null) },
            {
              label: "Update",
              strong: true,
              onClick: () => {
                setRtName(pending.to);
                update({ recordTypeName: pending.to });
                setPending(null);
              },
            },
          ]}
        />
      )}
      {pending?.kind === "acct-pick" && (
        <OptionSheet
          title="Switch Account"
          value={accountId}
          options={Object.keys(create?.accounts ?? {}).map((id) => ({
            value: id,
            label: snapshot.records?.byId[id]?.title ?? id,
          }))}
          onClose={() => setPending(null)}
          onPick={(id) => {
            if (id === accountId) return setPending(null);
            const next = create?.accounts[id];
            const allowed = recordTypeOptions(
              structure?.recordTypeMap,
              snapshot.records?.byId[id]?.recordType,
              rts.map((r) => r.name)
            );
            // The device asks first when the new account can't use this visit type (VisitDynamicLayoutController).
            if (next && !allowed.includes(rtName)) setPending({ kind: "acct", to: id });
            else pickAccount(id);
          }}
        />
      )}
      {pending?.kind === "acct" && (
        <Alert
          title="Change account?"
          message="The selected account doesn't have access to this visit type. If you continue, fields and their values may be lost."
          row
          actions={[
            { label: "Cancel", onClick: () => setPending(null) },
            { label: "Continue", strong: true, onClick: () => pickAccount(pending.to) },
          ]}
        />
      )}
      {pending?.kind === "pick" && (
        <OptionSheet
          title={pending.spec.label}
          value={v(pending.spec.name)}
          options={Object.entries(pending.spec.picklist ?? {}).map(([value, label]) => ({
            value,
            label,
          }))}
          onClose={() => setPending(null)}
          onPick={(val) => {
            setV(pending.spec.name, val);
            setPending(null);
          }}
        />
      )}
    </Full>
  );
}

const isCompletedStatus = (s: string | null | undefined): boolean =>
  /^(completed|submitted)$/i.test(s ?? "");
