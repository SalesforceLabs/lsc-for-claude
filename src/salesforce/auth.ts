/**
 * Salesforce authentication and org management
 */

import type { SfOrg } from "./cli.js";
import { isSfCliInstalled, getSfCliVersion, listOrgs, SfOrgListResult } from "./cli.js";
import { cacheInvalidateOrg } from "../cache.js";

export interface SetupStatus {
  cliInstalled: boolean;
  cliVersion?: string;
  hasAuthenticatedOrgs: boolean;
  orgs: SfOrg[];
  defaultOrg?: SfOrg;
  setupComplete: boolean;
  nextStep?: SetupStep;
}

export type SetupStep = "install_cli" | "authenticate_org" | "select_default_org" | "ready";

export interface SetupInstructions {
  step: SetupStep;
  title: string;
  description: string;
  command?: string;
  options?: string[];
}

// Store the current target org for the session
let currentTargetOrg: string | undefined;

/**
 * Get the current target org
 */
export function getTargetOrg(): string | undefined {
  return currentTargetOrg;
}

/**
 * Set the current target org.
 * Invalidates the metadata cache for the previous org so stale data
 * is never returned after an org switch.
 */
export function setTargetOrg(orgAliasOrUsername: string): void {
  if (currentTargetOrg && currentTargetOrg !== orgAliasOrUsername) {
    cacheInvalidateOrg(currentTargetOrg);
  }
  currentTargetOrg = orgAliasOrUsername;
}

/**
 * Clear the current target org
 */
export function clearTargetOrg(): void {
  currentTargetOrg = undefined;
}

interface CliProbe {
  cliInstalled: boolean;
  cliVersion?: string;
  orgs?: SfOrg[];
}

/**
 * `sf org list` takes several seconds and every tool call validates the
 * connection, so a probe that found authenticated orgs is reused for a few
 * minutes. Probes that found no CLI or no orgs aren't kept, so installing the
 * CLI or logging in takes effect on the next call.
 */
const PROBE_TTL_MS = 5 * 60 * 1000;
let cachedProbe: { at: number; promise: Promise<CliProbe> } | undefined;

async function probeCli(): Promise<CliProbe> {
  // Three CLI spawns of a few seconds each: run them together rather than one after another.
  const [installed, versionResult, orgsResult] = await Promise.all([isSfCliInstalled(), getSfCliVersion(), listOrgs()]);
  if (!installed) return { cliInstalled: false };
  return {
    cliInstalled: true,
    cliVersion: versionResult.success ? versionResult.data : undefined,
    orgs:
      orgsResult.success && orgsResult.data
        ? [...(orgsResult.data.nonScratchOrgs || []), ...(orgsResult.data.scratchOrgs || [])]
        : undefined,
  };
}

let refreshing: Promise<unknown> | undefined;

function probe(fresh: boolean): Promise<CliProbe> {
  if (!fresh && cachedProbe && Date.now() - cachedProbe.at < PROBE_TTL_MS) return cachedProbe.promise;
  // An old probe that found orgs is served while a new one runs in the background, so no call waits on `sf org list`.
  if (!fresh && cachedProbe) {
    if (!refreshing) {
      const old = cachedProbe;
      refreshing = probeCli()
        .then((p) => {
          if (cachedProbe === old) {
            if (p.orgs?.length) cachedProbe = { at: Date.now(), promise: Promise.resolve(p) };
            else cachedProbe = undefined;
          }
        })
        .catch(() => undefined)
        .finally(() => (refreshing = undefined));
    }
    return cachedProbe.promise;
  }
  const promise = probeCli();
  const entry = { at: Date.now(), promise };
  cachedProbe = entry;
  const drop = () => {
    if (cachedProbe === entry) cachedProbe = undefined;
  };
  promise.then((p) => {
    if (!p.orgs?.length) drop();
  }, drop);
  return promise;
}

/** Forget the cached CLI/org probe so the next check runs `sf org list` again. */
export function invalidateSetupStatus(): void {
  cachedProbe = undefined;
}

/**
 * Check the full setup status. Reuses a recent probe unless `fresh` is set.
 */
export async function checkSetupStatus(options: { fresh?: boolean } = {}): Promise<SetupStatus> {
  const status: SetupStatus = {
    cliInstalled: false,
    hasAuthenticatedOrgs: false,
    orgs: [],
    setupComplete: false,
  };

  const cli = await probe(options.fresh ?? false);
  status.cliInstalled = cli.cliInstalled;

  if (!status.cliInstalled) {
    status.nextStep = "install_cli";
    return status;
  }

  status.cliVersion = cli.cliVersion;

  if (cli.orgs) {
    const allOrgs = cli.orgs;

    status.orgs = allOrgs;
    status.hasAuthenticatedOrgs = allOrgs.length > 0;

    // Find default org
    status.defaultOrg = allOrgs.find((org) => org.isDefaultUsername);

    // If we have a current target org set, validate it still exists
    if (currentTargetOrg) {
      const targetExists = allOrgs.some(
        (org) => org.alias === currentTargetOrg || org.username === currentTargetOrg
      );
      if (!targetExists) {
        clearTargetOrg();
      }
    }
  }

  if (!status.hasAuthenticatedOrgs) {
    status.nextStep = "authenticate_org";
    return status;
  }

  // Determine if setup is complete
  if (currentTargetOrg || status.defaultOrg) {
    status.setupComplete = true;
    status.nextStep = "ready";
  } else if (status.orgs.length === 1) {
    // Auto-select if only one org
    const singleOrg = status.orgs[0];
    setTargetOrg(singleOrg.alias || singleOrg.username);
    status.setupComplete = true;
    status.nextStep = "ready";
  } else {
    status.nextStep = "select_default_org";
  }

  return status;
}

/**
 * Get setup instructions for the current step
 */
export function getSetupInstructions(step: SetupStep): SetupInstructions {
  switch (step) {
    case "install_cli":
      return {
        step,
        title: "Install Salesforce CLI",
        description: "The Salesforce CLI is required to connect to your org. Install it using npm:",
        command: "npm install -g @salesforce/cli",
        options: [
          "Run the command above in your terminal",
          "Or download from: https://developer.salesforce.com/tools/salesforcecli",
        ],
      };

    case "authenticate_org":
      return {
        step,
        title: "Authenticate to Your Org",
        description: "Connect to your Salesforce org using web-based authentication:",
        command: "sf org login web --alias my-lsc-org",
        options: [
          "For sandbox: sf org login web --alias my-lsc-sandbox --instance-url https://test.salesforce.com",
          "For production: sf org login web --alias my-lsc-prod",
          "This will open a browser window for you to log in",
        ],
      };

    case "select_default_org":
      return {
        step,
        title: "Select Target Org",
        description: "Multiple orgs found. Please select which org to work with.",
        options: [
          "Use the set_target_org tool to select an org",
          "Or set a default: sf config set target-org <alias>",
        ],
      };

    case "ready":
      return {
        step,
        title: "Ready",
        description: "Setup complete! You can now use LSC tools to work with your org.",
      };
  }
}

/**
 * Format org list for display
 */
export function formatOrgList(orgs: SfOrg[]): string {
  if (orgs.length === 0) {
    return "No authenticated orgs found.";
  }

  const lines = orgs.map((org) => {
    const parts = [];
    if (org.alias) {
      parts.push(`**${org.alias}**`);
    }
    parts.push(org.username);
    if (org.isDefaultUsername) {
      parts.push("(default)");
    }
    if (org.connectedStatus && org.connectedStatus !== "Connected") {
      parts.push(`[${org.connectedStatus}]`);
    }
    return `- ${parts.join(" ")} - ${org.instanceUrl}`;
  });

  return lines.join("\n");
}

/**
 * Get the effective target org (session override or default)
 */
export async function getEffectiveTargetOrg(): Promise<string | undefined> {
  if (currentTargetOrg) {
    return currentTargetOrg;
  }

  const status = await checkSetupStatus();
  if (status.defaultOrg) {
    return status.defaultOrg.alias || status.defaultOrg.username;
  }

  if (status.orgs.length === 1) {
    const singleOrg = status.orgs[0];
    return singleOrg.alias || singleOrg.username;
  }

  return undefined;
}

/**
 * Validate that we have a usable org connection
 */
export async function validateOrgConnection(): Promise<{
  valid: boolean;
  targetOrg?: string;
  error?: string;
  availableOrgs?: string[];
  setupInstructions?: SetupInstructions;
}> {
  const status = await checkSetupStatus();

  if (!status.cliInstalled) {
    return {
      valid: false,
      error: "Salesforce CLI is not installed",
      setupInstructions: getSetupInstructions("install_cli"),
    };
  }

  if (!status.hasAuthenticatedOrgs) {
    return {
      valid: false,
      error: "No authenticated Salesforce orgs found",
      setupInstructions: getSetupInstructions("authenticate_org"),
    };
  }

  const targetOrg = await getEffectiveTargetOrg();

  if (!targetOrg) {
    const orgNames = status.orgs.map((o) => o.alias || o.username);
    return {
      valid: false,
      error: `No target org selected. Multiple orgs available: ${orgNames.join(", ")}. Ask the user ONCE which org to use, then call set_target_org. The choice persists for the entire session — do not ask again.`,
      availableOrgs: orgNames,
      setupInstructions: getSetupInstructions("select_default_org"),
    };
  }

  return {
    valid: true,
    targetOrg,
  };
}

/**
 * Identify if an org has LSC installed (heuristic check)
 */
export async function checkLscInstalled(targetOrg: string): Promise<{
  installed: boolean;
  indicators: string[];
}> {
  // This is a placeholder - in a real implementation, we'd query for
  // LSC-specific objects or check installed packages
  // For now, return a basic check structure
  return {
    installed: true, // Assume true for now
    indicators: ["Check for HealthCloudGA package", "Check for LSC-specific objects like Visit__c"],
  };
}
