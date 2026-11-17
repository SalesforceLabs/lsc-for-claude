import React, { useState } from "react";
import { Backdrop, linkBtn, NavBar, Note, type SheetContext } from "../ipad-sheet-ui";
import { useLazyStudio } from "../useLazyStudio";
import type { ConsentRow, ConsentState, ProofMethod, PublishedConsent } from "./consent-types";
import {
  globalKey,
  globalState,
  PROOF_TITLES,
  rowKey,
  setGlobal,
  showTopics,
  stateOf,
  STATE_TITLES,
  type Draft,
} from "./consent-logic";
import "./consent.css";

/**
 * Capture Consent from the ••• menu: the Communication Consent edit screen with the account's subscriptions,
 * channels and values, the global channel row and the proof section.
 * iOS: module/OPT/Consent/CommunicationConsent (OPTEditViewController, LSCCommunicationConsentViewModel,
 * LSCConsentSubscriptionCollectionViewCell). Choices are a draft in this sheet only; nothing is saved.
 */
export default function ConsentSheet({ ctx, onClose }: { ctx: SheetContext; onClose: () => void }) {
  const accountId = ctx.record?.object === "Account" ? ctx.record.id : "";
  const { state, retry } = useLazyStudio<PublishedConsent>(
    accountId,
    () =>
      accountId
        ? window.lscApi.studioConsentData(accountId)
        : Promise.resolve({ error: "No account is open." }),
    (answer) => {
      const c = (answer as { consent?: PublishedConsent } | undefined)?.consent;
      if (!c) throw new Error("No consent data came back.");
      return c;
    }
  );
  return (
    <Backdrop onClose={onClose} className="consent">
      <NavBar
        plain
        left={linkBtn("Cancel", onClose)}
        title="Edit Communication Consent"
        right={linkBtn("Save")}
      />
      <div className="studio-ipad-act-body">
        <div className="studio-ipad-con-acct">{ctx.record?.title}</div>
        {state.status === "loading" && <div className="studio-ipad-con-empty">Loading…</div>}
        {state.status === "error" && (
          <div className="studio-ipad-con-empty">
            {state.message} {linkBtn("Try again", retry)}
          </div>
        )}
        {state.status === "ready" && <Body data={state.data} />}
      </div>
    </Backdrop>
  );
}

function Body({ data }: { data: PublishedConsent }) {
  const [draft, setDraft] = useState<Draft>({});
  const [proof, setProof] = useState<ProofMethod | undefined>(data.proof[0]);
  const topics = showTopics(data);
  const subs = data.subscriptions;
  const choose = (key: string, state: ConsentState) => setDraft((d) => ({ ...d, [key]: state }));

  return (
    <>
      {data.global && (
        <>
          <div className="studio-ipad-con-h">Channels</div>
          <div className="studio-ipad-con-card">
            {data.global.length === 0 && (
              <div className="studio-ipad-con-none">No values available</div>
            )}
            {data.global.map((g) => (
              <Row
                key={globalKey(g)}
                row={g}
                state={globalState(subs, draft, g)}
                onPick={(s) => setDraft((d) => setGlobal(subs, d, g, s))}
              />
            ))}
          </div>
        </>
      )}
      {topics && (
        <>
          <div className="studio-ipad-con-h">Subscriptions</div>
          {subs.length === 0 && <div className="studio-ipad-con-empty">No subscriptions</div>}
          {subs.map((s) => (
            <div className="studio-ipad-con-card" key={s.id}>
              <header>{s.name}</header>
              {s.rows.length === 0 && (
                <div className="studio-ipad-con-none">No values available</div>
              )}
              {s.rows.map((r) => {
                const key = rowKey(s.id, r);
                return (
                  <Row
                    key={key}
                    row={r}
                    state={stateOf(draft, key, r.state)}
                    onPick={(st) => choose(key, st)}
                  />
                );
              })}
            </div>
          ))}
        </>
      )}
      {data.addable.length > 0 && (
        <Note>
          Add Channel: {data.addable.join(", ")}. Adding a value isn't available in the preview.
        </Note>
      )}
      <div className="studio-ipad-con-h">Consent Proof</div>
      {data.proof.length === 0 ? (
        <div className="studio-ipad-con-none">The org doesn't ask for proof.</div>
      ) : (
        <>
          <div className="studio-ipad-con-tabs">
            {data.proof.map((p) => (
              <button
                key={p}
                type="button"
                className={p === proof ? "on" : ""}
                onClick={() => setProof(p)}
              >
                {PROOF_TITLES[p]}
              </button>
            ))}
          </div>
          <div className="studio-ipad-con-card">
            <ProofPanel method={proof} data={data} />
          </div>
        </>
      )}
      <Note>Not in the preview: {data.gaps.join("; ")}.</Note>
    </>
  );
}

function Row({
  row,
  state,
  onPick,
}: {
  row: ConsentRow;
  state: ConsentState;
  onPick: (s: ConsentState) => void;
}) {
  return (
    <div className="studio-ipad-con-row">
      <div>
        {row.title}
        <small>{row.value}</small>
      </div>
      <div className="studio-ipad-con-seg" role="group" aria-label={row.title}>
        {state === "Partial" && (
          <button type="button" className="partial">
            {STATE_TITLES.Partial}
          </button>
        )}
        {(["OptIn", "OptOut"] as ConsentState[]).map((s) => (
          <button
            key={s}
            type="button"
            className={state === s ? "on" : ""}
            onClick={() => onPick(s)}
          >
            {STATE_TITLES[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProofPanel({ method, data }: { method?: ProofMethod; data: PublishedConsent }) {
  const [ref, setRef] = useState("");
  const [verbal, setVerbal] = useState(false);
  if (method === "DigitalSignature")
    return (
      <div className="studio-ipad-con-proof">
        {data.settings.signature === "Required" ? "Signature required" : "Signature (optional)"}
        <div className="studio-ipad-con-pad" />
      </div>
    );
  if (method === "Attachment")
    return (
      <div className="studio-ipad-con-proof">
        {data.settings.attachment === "Required"
          ? "An attachment is required."
          : "Attach a file (optional)."}
      </div>
    );
  if (method === "DocumentReference")
    return (
      <div className="studio-ipad-con-proof">
        <input
          type="text"
          placeholder="Enter document reference"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
      </div>
    );
  if (method === "VerbalConsent")
    return (
      <div className="studio-ipad-con-proof">
        <label>
          <input type="checkbox" checked={verbal} onChange={(e) => setVerbal(e.target.checked)} /> I
          received verbal consent for the chosen communication preferences.
        </label>
      </div>
    );
  return null;
}
