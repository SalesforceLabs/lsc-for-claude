import React, { useEffect, useState } from "react";
import { LogIn, RefreshCw, UserPlus, UserRound, UsersRound, X } from "lucide-react";
import StateView from "../ui/StateView";
import Spinner from "../ui/Spinner";
import { useOrgs } from "../../hooks/useOrgs";
import { useMobileLogins } from "../../hooks/useMobileLogins";
import { orgKey } from "../../orgs";
import { sameOrgId, testUserName, testUsersFor, testUserStatus } from "../../test-users";
import type { MobileLoginInfo } from "../../types";
import "./readiness.css";
import "./test-users.css";

/**
 * Test users — reps signed in through the LSC mobile app on the selected org, as their iPad would be.
 * The iPad preview, First sync and test plans act as them.
 */
export default function TestUsersView() {
  const { current } = useOrgs();
  const mobile = useMobileLogins();
  // A sign-in window is open: "new", or the id of the login being renewed.
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const check = async () => {
    setChecking(true);
    await mobile.check();
    setChecking(false);
  };

  // Logins not used lately are renewed when the page opens, so their status is current.
  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (login?: MobileLoginInfo) => {
    if (!current) return;
    setSigningIn(login?.id ?? "new");
    setError("");
    try {
      const res = login ? await window.lscApi.mobileLoginRenew(login.id) : await window.lscApi.mobileLoginStart(current.instanceUrl);
      if (res.error && res.error !== "Login window closed.") setError(res.error);
    } finally {
      setSigningIn(null);
    }
  };

  const users = testUsersFor(mobile.logins, current?.orgId);
  const elsewhere = mobile.logins.filter((l) => !sameOrgId(l.orgId, current?.orgId)).length;
  const orgName = current ? orgKey(current) : "this org";

  const addButton = (
    <button className="studio-btn primary" onClick={() => signIn()} disabled={!current?.connected || !!signingIn}>
      {signingIn === "new" ? <Spinner size={14} /> : <UserPlus aria-hidden="true" />}
      {signingIn === "new" ? "Waiting for sign-in…" : "Sign in a test user…"}
    </button>
  );

  let body: React.ReactNode;
  if (!current?.connected) {
    body = (
      <StateView
        kind="empty"
        layout="inline"
        icon={UsersRound}
        title="Connect to an org first"
        detail="Test users belong to one org. Choose or log in to an org in the sidebar's org menu."
      />
    );
  } else if (!mobile.loaded) {
    body = <StateView kind="loading" layout="inline" title="Loading test users…" />;
  } else if (users.length === 0) {
    body = (
      <StateView
        kind="empty"
        layout="inline"
        icon={UsersRound}
        title={`No test users on ${orgName} yet`}
        detail="Sign in as a rep with their own username and password. Until then, Studio reads data as your admin connection, which can see more than a rep's iPad."
        actions={addButton}
      />
    );
  } else {
    body = (
      <section>
        <h3 className="ui-section-title">
          Signed in on {orgName} <span className="count">{users.length}</span>
        </h3>
        <ul className="studio-test-users">
          {users.map((l) => {
            const status = testUserStatus(l);
            const name = testUserName(l);
            return (
              <li key={l.id} className="studio-test-user">
                <span className="studio-test-user-avatar" aria-hidden="true">
                  <UserRound size={16} strokeWidth={1.9} />
                </span>
                <span className="studio-test-user-text">
                  <span className="studio-test-user-name">{name}</span>
                  <span className="studio-test-user-sub" title={l.username}>
                    {l.username}
                  </span>
                </span>
                <span className={`ui-pill ${status.tone}`} title={status.detail}>
                  {status.label}
                </span>
                {l.status === "expired" && (
                  <button className="studio-btn sm" onClick={() => signIn(l)} disabled={!!signingIn}>
                    {signingIn === l.id ? <Spinner size={12} /> : <LogIn aria-hidden="true" />}
                    Sign in again
                  </button>
                )}
                <button
                  className="ui-icon-btn sm"
                  onClick={() => window.lscApi.mobileLoginRemove(l.id)}
                  title={`Forget ${name}'s login`}
                  aria-label={`Forget ${name}'s login`}
                >
                  <X size={14} strokeWidth={1.9} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div className="studio-page ui-enter">
      <header className="studio-page-head">
        <div>
          <h2>Test users</h2>
          <p>
            Reps signed in through the LSC mobile app, as their iPad would be. The iPad preview, First sync and test plans act as
            them; their logins are remembered in this Mac's keychain until you forget them or Salesforce ends them.
          </p>
        </div>
        {current?.connected && (
          <div className="studio-page-actions">
            {users.length > 0 && addButton}
            <button className="ui-icon-btn" onClick={check} disabled={checking} title="Check the logins again" aria-label="Check the logins again">
              {checking ? <Spinner size={14} /> : <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />}
            </button>
          </div>
        )}
      </header>
      {error && <div className="studio-test-users-error" role="alert">{error}</div>}
      {body}
      {elsewhere > 0 && (
        <p className="studio-test-users-note">
          {elsewhere} more {elsewhere === 1 ? "test user is" : "test users are"} signed in on other orgs; switch org to see them.
        </p>
      )}
    </div>
  );
}
