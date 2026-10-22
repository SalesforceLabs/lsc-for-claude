/** Actions & Home Page readiness: its validation rules plus Studio's own checks. */

import {
  actionFindings,
  fetchKnown,
  noHomeActions,
  sortCollisions,
} from "../../collectors/actions-home.js";
import { fetchCache, noNavTabs } from "../../collectors/mobile-sync.js";
import {
  actionProfiles,
  byCategory,
  fetchCategories,
  isNavTab,
  profilesOf,
} from "../../collectors/shared.js";
import { plural } from "../../helpers.js";
import type { StudioFix } from "../../types.js";
import { runCheck, type ReadinessModule } from "../index.js";
import { cacheFreshResult, profilesWithApps, withLscUsers } from "./_mobile-sync-shared.js";
import { once } from "./_visit-shared.js";

const readiness: ReadinessModule = {
  ruleFiles: ["quick-actions-config.yaml", "home-page-config.yaml"],
  checks: async (org) => {
    const actions = once(() => fetchCategories(org, ["QuickAction", "CustomAction"], true));
    const uiSchema = once(() => fetchCategories(org, ["UISchema"], true));
    const dbSchema = once(() => fetchCategories(org, ["DbSchema"], true));
    const known = once(() => fetchKnown(org));
    const caches = once(() => fetchCache(org));
    const active = async () => (await actions()).filter((r) => r.isActive);
    const quick = async () => byCategory(await active(), "QuickAction");
    const custom = async () => byCategory(await active(), "CustomAction");
    /** Profiles that already have actions or tabs set up for them, less those with no LSC-licensed active user. */
    const profiles = once(async () => {
      const tabs = (await uiSchema()).filter((r) => isNavTab(r) && r.isActive);
      return withLscUsers(
        [
          ...new Set([...(await quick()).flatMap(actionProfiles), ...tabs.flatMap(profilesOf)]),
        ].sort(),
        org
      );
    });
    const label = (r: { label?: string; developerName: string }) => r.label || r.developerName;

    return Promise.all([
      runCheck(
        {
          id: "actions-home.access.profile-home-actions",
          stage: "access",
          title: "Each profile with actions has a home page action",
          severity: "info",
          why: "The floating button on the iPad home page is where reps start a visit or an email. A profile with record actions but none on the home page has an empty button.",
          steps: [
            "Open Admin Console > Mobile > Quick Actions",
            "Add the profile to an existing HomePage action, or create one with Location = HomePage",
          ],
          uiPath: "Admin Console > Mobile > Quick Actions",
          surface: "profileCoverage",
        },
        async () => {
          const [names, k, qa] = await Promise.all([profiles(), known(), quick()]);
          const home = qa.filter((r) => r.fields.Location === "HomePage");
          const everyone = home.some((r) => actionProfiles(r).length === 0);
          const bare = names.filter(
            (p) =>
              k.profiles.has(p.toLowerCase()) &&
              !everyone &&
              !home.some((r) => actionProfiles(r).includes(p))
          );
          if (!bare.length)
            return {
              pass: true,
              detail: `${plural(names.length, "profile")} checked; each sees a home page action.`,
            };
          const fixes: StudioFix[] = bare.flatMap((p) => noHomeActions(p, qa, true).fixes ?? []);
          return {
            pass: false,
            detail: `${plural(bare.length, "profile")} without a home page action: ${bare.join(", ")}.`,
            examples: bare,
            fixes,
          };
        }
      ),
      runCheck(
        {
          id: "actions-home.config.targets-exist",
          stage: "config",
          title: "Actions only name profiles, permission sets and record types that exist",
          severity: "warning",
          why: "An action restricted to a profile, permission set or record type that doesn't exist (a typo, or something renamed after the action was built) silently shows for nobody on that line. A record type counts only if it's active and belongs to the action's object.",
          steps: [
            "Open the action in Admin Console > Mobile > Quick Actions or Custom Actions",
            "Correct or remove the unknown name",
          ],
          uiPath: "Admin Console > Mobile > Quick Actions",
          surface: "actions",
        },
        async () => {
          const k = await known();
          const bad = (await active()).flatMap((r) =>
            actionFindings(r, k)
              .filter((f) => !f.title.startsWith("Hardcoded"))
              .map((f) => ({ r, f }))
          );
          return bad.length
            ? {
                pass: false,
                detail: `${plural(bad.length, "name")} in ${plural(new Set(bad.map((b) => b.r.developerName)).size, "action")} match nothing usable in the org.`,
                examples: bad.map((b) => `${label(b.r)}: ${b.f.title}`),
                fixes: bad.flatMap((b) => b.f.fixes ?? []),
              }
            : {
                pass: true,
                detail: `${plural((await active()).length, "action")} checked; every name exists.`,
              };
        }
      ),
      runCheck(
        {
          id: "actions-home.config.hardcoded-urls",
          stage: "config",
          title: "No action points at a hardcoded org URL",
          severity: "info",
          why: "A full lightning.force.com or my.salesforce.com address ties the action to one org. It works here, but after a sandbox refresh or when the configuration is moved to another org it still points at this one.",
          steps: [
            "Open the action in Admin Console",
            "After a refresh or migration, update the address to the new org's domain",
          ],
          uiPath: "Admin Console > Mobile > Custom Actions",
          surface: "actions",
        },
        async () => {
          const hits = (await active()).filter((r) =>
            actionFindings(r, null).some((f) => f.title.startsWith("Hardcoded"))
          );
          return hits.length
            ? {
                pass: false,
                detail: `${plural(hits.length, "action")} contain an org-specific URL. Check them after a sandbox refresh or migration.`,
                examples: hits.map(label),
              }
            : { pass: true, detail: "No active action contains an org-specific URL." };
        }
      ),
      runCheck(
        {
          id: "actions-home.config.https-urls",
          stage: "config",
          title: "URL custom actions use https",
          severity: "warning",
          why: "iOS's transport security generally blocks plain http pages in the app's browser, so a URL action pointing at http:// opens a blank page for the rep.",
          steps: [
            "Open the action in Admin Console > Mobile > Custom Actions",
            "Change the Action Target to an https:// address",
          ],
          uiPath: "Admin Console > Mobile > Custom Actions",
          surface: "recordCustomActions",
        },
        async () => {
          const urls = (await custom()).filter((r) => r.fields.ActionType === "URL");
          if (!urls.length) return { pass: true, skip: true, detail: "No URL custom actions." };
          const bad = urls.filter((r) => /^http:\/\//i.test(String(r.fields.ActionTarget ?? "")));
          return bad.length
            ? {
                pass: false,
                detail: `${plural(bad.length, "URL action")} use http://.`,
                examples: bad.map(label),
              }
            : {
                pass: true,
                detail: `${plural(urls.length, "URL action")} checked; all use https or a relative path.`,
              };
        }
      ),
      runCheck(
        {
          id: "actions-home.config.synced-objects",
          stage: "config",
          title: "Record actions are for objects that sync to the iPad",
          severity: "warning",
          why: "A quick action that creates or opens an object the iPad doesn't sync can't save offline. The button shows but the action fails or loses data.",
          steps: [
            "Open Admin Console > Mobile > DB Schema",
            "Add a record for the object, or remove the action",
          ],
          uiPath: "Admin Console > Mobile > DB Schema",
          surface: "dbSchema",
        },
        async () => {
          const synced = new Set(
            (await dbSchema())
              .filter((r) => r.isActive)
              .map((r) => String(r.fields.SObject ?? "").toLowerCase())
          );
          const targets = (await quick()).filter((r) => r.fields.SObject);
          const bad = targets.filter((r) => !synced.has(String(r.fields.SObject).toLowerCase()));
          return bad.length
            ? {
                pass: false,
                detail: `${plural(bad.length, "action")} target an object with no active DB Schema record.`,
                examples: bad.map((r) => `${label(r)} (${String(r.fields.SObject)})`),
              }
            : {
                pass: true,
                detail: `${plural(targets.length, "record action")} checked; each object syncs.`,
              };
        }
      ),
      runCheck(
        {
          id: "actions-home.config.sort-order",
          stage: "config",
          title: "Actions at one place have distinct sort orders",
          severity: "info",
          why: "Two actions with the same sort order that a rep sees together — on the same record (same location, object and record type) or both on the home page button — appear in an unpredictable order, so the button a rep expects first may move.",
          steps: [
            "Open each action in Admin Console > Mobile > Quick Actions",
            "Give each a different Sort Order",
          ],
          uiPath: "Admin Console > Mobile > Quick Actions",
          surface: "actions",
        },
        async () => {
          const clashes = sortCollisions(await quick());
          return clashes.length
            ? {
                pass: false,
                detail: `${plural(clashes.length, "group")} of actions share a sort order.`,
                examples: clashes.map((c) => c.title.replace("Same sort order: ", "")),
              }
            : { pass: true, detail: "Every action has its own position." };
        }
      ),
      runCheck(
        {
          id: "actions-home.mobile.profile-tabs",
          stage: "mobile",
          title: "Each profile with actions has a tab bar",
          severity: "info",
          why: "The iPad's tab bar comes from the profile's Lightning app; UI Settings tabs are added to it. A profile that can open no Lightning app and has no UI Settings tabs has nothing to build the bar from.",
          steps: [
            "Give the profile access to the Lightning app its reps use (Setup > Profiles > Assigned Apps)",
            "Or add tabs for it in Admin Console > Mobile > UI Settings",
          ],
          uiPath: "Setup > Profiles > Assigned Apps",
          surface: "navigationTabs",
        },
        async () => {
          const [names, ui, k] = await Promise.all([profiles(), uiSchema(), known()]);
          const tabs = ui.filter((r) => isNavTab(r) && r.isActive);
          const noTabs = names.filter(
            (p) =>
              k.profiles.has(p.toLowerCase()) &&
              !tabs.some((t) => profilesOf(t).some((n) => n.toLowerCase() === p.toLowerCase()))
          );
          const apps = await profilesWithApps(noTabs, org);
          const bare = noTabs.filter((p) => !apps.has(p.toLowerCase()));
          if (!bare.length)
            return {
              pass: true,
              detail: `${plural(names.length, "profile")} checked; each can open a Lightning app or has UI Settings tabs.`,
            };
          return {
            pass: false,
            detail: `${plural(bare.length, "profile")} with no Lightning app and no UI Settings tabs: ${bare.join(", ")}.`,
            examples: bare,
            fixes: bare.flatMap((p) => noNavTabs(p, tabs).fixes ?? []),
          };
        }
      ),
      runCheck(
        {
          id: "actions-home.mobile.cache-fresh",
          stage: "mobile",
          title: "The published cache includes your latest action and tab changes",
          severity: "warning",
          why: "Actions and tabs reach the iPad through the published metadata cache. Edits made after the last publish don't show until you publish again.",
          steps: [
            "Regenerate the cache for the profiles listed (Publish to iPad in Studio, or /lsc:generate-metadata-cache)",
          ],
          uiPath: "Admin Console > Mobile > Object Metadata Cache Configuration",
          surface: "metadataCache",
        },
        async () =>
          cacheFreshResult(
            org,
            await caches(),
            ["QuickAction", "CustomAction", "UISchema"],
            [...(await actions()), ...(await uiSchema())]
          )
      ),
    ]);
  },
};

export default readiness;
