import React, { useState } from "react";
import { LogIn, UserRound } from "lucide-react";
import Spinner from "../ui/Spinner";
import { useOrgs } from "../../hooks/useOrgs";
import { testUserFor } from "../../test-users";
import type { MobileLoginInfo } from "../../types";
import "./test-users.css";

/**
 * Whose login live data comes from, for a rep Studio previews or tests: the rep's own test user when
 * signed in, else the admin connection — with a button to sign in as the rep.
 */
export default function TestUserChip({
  logins,
  userId,
  name,
  signedInTitle,
  adminTitle,
}: {
  logins: MobileLoginInfo[];
  userId: string;
  name: string;
  /** What acting as the rep covers, shown on hover. */
  signedInTitle: string;
  /** What the admin connection is used for instead, shown on hover. */
  adminTitle: string;
}) {
  const { current } = useOrgs();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const login = testUserFor(logins, userId);

  if (login?.status === "signedIn") {
    return (
      <span className="ui-pill pass studio-test-user-chip" title={signedInTitle}>
        <UserRound size={12} strokeWidth={2} aria-hidden="true" />
        As {name}
      </span>
    );
  }

  const signIn = async () => {
    if (!current) return;
    setSigningIn(true);
    setError("");
    const res = login ? await window.lscApi.mobileLoginRenew(login.id) : await window.lscApi.mobileLoginStart(current.instanceUrl);
    setSigningIn(false);
    if (res.error && res.error !== "Login window closed.") setError(res.error);
    else if (res.login?.userId && res.login.userId.slice(0, 15) !== userId.slice(0, 15)) {
      setError(`That was ${res.login.displayName || res.login.username}, not ${name}. It's kept in Test users.`);
    }
  };

  const expired = login?.status === "expired";
  return (
    <span className="studio-test-user-chip-wrap">
      <span className={`ui-pill ${expired ? "warning" : "info"} studio-test-user-chip`} title={expired ? `${name}'s login expired. ${adminTitle}` : adminTitle}>
        {expired ? `${name}'s login expired` : "As your admin login"}
      </span>
      <button className="studio-btn ghost sm" onClick={signIn} disabled={signingIn || !current?.connected}>
        {signingIn ? <Spinner size={12} /> : <LogIn aria-hidden="true" />}
        {signingIn ? "Waiting for sign-in…" : expired ? "Sign in again" : `Sign in as ${name}…`}
      </button>
      {error && (
        <span className="studio-test-user-chip-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
