import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LogIn, TriangleAlert, UserRound } from "lucide-react";
import Spinner from "../../ui/Spinner";
import { useOrgs } from "../../../hooks/useOrgs";
import { useMobileLogins } from "../../../hooks/useMobileLogins";
import { testUserName, testUsersFor } from "../../../test-users";
import type { MobileLoginInfo } from "../../../types";
import type { AppRunAs } from "./types";

/** Who the preview's data is read as. */
export type RunAsState =
  | { kind: "admin" }
  | { kind: "user"; loginId: string; name: string }
  | { kind: "expired"; login: MobileLoginInfo; name: string }
  | { kind: "missing"; name: string };

export function resolveRunAs(runAs: AppRunAs | null | undefined, logins: MobileLoginInfo[], loaded: boolean): RunAsState {
  if (!runAs) return { kind: "admin" };
  const login = logins.find((l) => l.id === runAs.loginId);
  const name = login ? testUserName(login) : runAs.username;
  if (login) return login.status === "signedIn" ? { kind: "user", loginId: login.id, name } : { kind: "expired", login, name };
  // Logins are read asynchronously; don't call a user missing before they are.
  return loaded ? { kind: "missing", name } : { kind: "user", loginId: runAs.loginId, name };
}

export const toRunAs = (l: MobileLoginInfo): AppRunAs => ({ loginId: l.id, username: l.username, ...(l.userId ? { userId: l.userId } : {}) });

/** Renew an expired login, or sign a test user in from scratch; resolves to a message when it fails. */
export function useSignIn(onSignedIn?: (login: MobileLoginInfo) => void) {
  const { current } = useOrgs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (renew?: MobileLoginInfo) => {
    if (!current) return;
    setBusy(true);
    setError("");
    const res = renew ? await window.lscApi.mobileLoginRenew(renew.id) : await window.lscApi.mobileLoginStart(current.instanceUrl);
    setBusy(false);
    if (res.error && res.error !== "Login window closed.") setError(res.error);
    else if (res.login) onSignedIn?.(res.login);
  };
  return { busy, error, signIn: run, canSignIn: !!current?.connected };
}

/** The org's first signed-in test user, the default to run as. */
export function defaultRunAs(logins: MobileLoginInfo[], orgId: string | undefined): AppRunAs | null {
  const l = testUsersFor(logins, orgId).find((x) => x.status === "signedIn");
  return l ? toRunAs(l) : null;
}

interface RunAsControlProps {
  value: AppRunAs | null | undefined;
  onChange: (runAs: AppRunAs | null) => void;
  disabled?: boolean;
}

/** "Run as": the test user whose data the preview reads — their own mobile login, so the rep sees what they would. */
export default function RunAsControl({ value, onChange, disabled }: RunAsControlProps) {
  const { current } = useOrgs();
  const { logins, loaded } = useMobileLogins();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const users = testUsersFor(logins, current?.orgId);
  const state = resolveRunAs(value, logins, loaded);
  const { busy, error, signIn, canSignIn } = useSignIn((l) => {
    onChange(toRunAs(l));
    setOpen(false);
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = state.kind === "admin" ? "admin" : state.kind === "user" ? state.name : state.kind === "expired" ? `${state.name} (sign in again)` : `${state.name} (not signed in)`;
  const title =
    state.kind === "admin"
      ? "The preview reads data as your own Salesforce connection, not as a rep"
      : state.kind === "user"
        ? `The preview reads data as ${state.name}, so you see exactly their records`
        : "The preview won't show their data until they sign in again";

  const pick = (l: MobileLoginInfo) => {
    setOpen(false);
    if (l.status === "expired") void signIn(l);
    else onChange(toRunAs(l));
  };

  return (
    <div className="bld-runas" ref={root}>
      <button
        type="button"
        className={`studio-btn sm bld-runas-trigger ${state.kind}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Run as: ${label}. Choose who to run as`}
        title={title}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {state.kind === "expired" || state.kind === "missing" ? <TriangleAlert size={14} aria-hidden="true" /> : <UserRound size={14} aria-hidden="true" />}
        <span className="bld-runas-label">
          As <strong>{label}</strong>
        </span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="ui-menu-list bld-runas-menu" role="menu" aria-label="Run as">
          <button type="button" role="menuitem" className="ui-menu-item" onClick={() => (setOpen(false), onChange(null))}>
            <span className="bld-runas-name">Your admin login</span>
            {state.kind === "admin" && <Check size={12} aria-label="Selected" />}
          </button>
          {users.map((l) => (
            <button key={l.id} type="button" role="menuitem" className="ui-menu-item" onClick={() => pick(l)}>
              <span className="bld-runas-name">
                {testUserName(l)}
                <span className="bld-runas-sub">{l.status === "expired" ? "Login expired — sign in again" : l.username}</span>
              </span>
              {value?.loginId === l.id && <Check size={12} aria-label="Selected" />}
            </button>
          ))}
          <button type="button" role="menuitem" className="ui-menu-item" disabled={busy || !canSignIn} onClick={() => void signIn()}>
            {busy ? <Spinner size={12} /> : <LogIn size={14} aria-hidden="true" />}
            {busy ? "Waiting for sign-in…" : "Sign in a test user…"}
          </button>
          {error && (
            <div className="bld-runas-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
