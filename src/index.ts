#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { electronParentPort, ParentPortServerTransport } from "./parent-port-transport.js";
import {
  getModuleList,
  getHelpDocList,
  getGuideList,
  getExerciseList,
  getTroubleshootingList,
} from "./knowledge-loader.js";

// Import tool modules
import { register as registerKnowledge } from "./tools/knowledge.js";
import { register as registerSalesforceOrg } from "./tools/salesforce-org.js";
import { register as registerActions } from "./tools/actions.js";
import { register as registerAdminConsole } from "./tools/admin-console.js";
import { register as registerConfigChecks } from "./tools/config-checks.js";
import { register as registerVisits } from "./tools/visits.js";
import { register as registerValidation } from "./tools/validation.js";
import { register as registerDbSchema } from "./tools/db-schema.js";
import { register as registerNavigation } from "./tools/navigation.js";
import { register as registerResources } from "./tools/resources.js";
import { register as registerPresentations } from "./tools/presentations.js";
import { register as registerDiff } from "./tools/diff.js";
import { register as registerUserManagement } from "./tools/user-management.js";
import { register as registerHealthCheck } from "./tools/health-check.js";
import { register as registerConfigExport } from "./tools/config-export.js";
import { register as registerReleaseNotes } from "./tools/release-notes.js";
import { register as registerApex } from "./tools/apex.js";
import { register as registerBulkOperations } from "./tools/bulk-operations.js";
import { register as registerMetadata } from "./tools/metadata.js";
import { register as registerBriefings } from "./tools/briefings.js";
import { register as registerStudio } from "./tools/studio.js";
import { register as registerPerf } from "./tools/perf.js";
import { register as registerPerfSimulate } from "./tools/perf-simulate.js";

// A FORCE_COLOR inherited from the user's terminal makes `sf ... --json`
// colour its JSON, which then fails to parse. Every sf call inherits this env.
delete process.env.FORCE_COLOR;

// Create the MCP server
const server = new McpServer({
  name: "LSC-for-Claude",
  version: "0.1.0",
});

// Register all tool modules
registerKnowledge(server);
registerSalesforceOrg(server);
registerActions(server);
registerAdminConsole(server);
registerConfigChecks(server);
registerVisits(server);
registerValidation(server);
registerDbSchema(server);
registerNavigation(server);
registerResources(server);
registerPresentations(server);
registerDiff(server);
registerUserManagement(server);
registerHealthCheck(server);
registerConfigExport(server);
registerReleaseNotes(server);
registerApex(server);
registerBulkOperations(server);
registerMetadata(server);
registerBriefings(server);
registerStudio(server);
registerPerf(server);
registerPerfSimulate(server);

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Log available documentation on startup
  const modules = getModuleList();
  const helpDocs = getHelpDocList();
  const guides = getGuideList();
  const exercises = getExerciseList();
  const troubleshooting = getTroubleshootingList();

  console.error(`LSC for Claude MCP server starting...`);
  console.error(`Knowledge base loaded:`);
  console.error(`  - ${modules.length} modules (PM enablement)`);
  console.error(`  - ${helpDocs.length} help documents`);
  console.error(`  - ${guides.length} guides`);
  console.error(`  - ${exercises.length} exercises`);
  console.error(`  - ${troubleshooting.length} troubleshooting docs`);

  const port = electronParentPort();
  await server.connect(port ? new ParentPortServerTransport(port) : new StdioServerTransport());
  console.error(`LSC for Claude MCP server running on ${port ? "the app's parent port" : "stdio"}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
