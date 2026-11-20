import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { deployMetadata, retrieveMetadata } from "../salesforce/cli.js";
import { validateOrgConnection } from "../salesforce/auth.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Total characters of retrieved file text put in the tool result; the rest is listed by path. */
export const RETRIEVED_TEXT_LIMIT = 60_000;

/**
 * The retrieved files' text, so the model can read what it asked for: chat has no tool that reads
 * local files. Files are listed in path order; once `limit` is used up the rest are named only.
 */
export function retrievedFilesText(dir: string, limit = RETRIEVED_TEXT_LIMIT): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  try {
    walk(dir);
  } catch {
    return "";
  }
  let left = limit;
  let out = "";
  const skipped: string[] = [];
  for (const f of files) {
    const rel = relative(dir, f);
    const text = readFileSync(f, "utf8");
    if (text.length > left || text.includes("\u0000")) {
      skipped.push(rel);
      continue;
    }
    left -= text.length;
    out += `### ${rel}\n\n\`\`\`xml\n${text}\n\`\`\`\n\n`;
  }
  if (skipped.length)
    out += `Not shown (too large or binary): ${skipped.join(", ")}. Retrieve them one at a time to read them.\n`;
  return out ? `## Files\n\n${out}` : "";
}

export function register(server: McpServer) {
  server.tool(
    "deploy_metadata",
    "Deploy metadata to the target Salesforce org from a local source directory. Wraps `sf project deploy start`. Use for pushing permission sets, page layouts, flows, and other metadata from a local project.",
    {
      sourcePath: z
        .string()
        .describe(
          "Path to the local source directory containing metadata to deploy (e.g., 'force-app/main/default')"
        ),
      targetOrg: z
        .string()
        .optional()
        .describe("Optional: specific org to deploy to. Uses current target org if not specified."),
    },
    async ({ sourcePath, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Deploy Metadata\n\n${validation.error}\n\nPlease connect to a Salesforce org first.`,
            },
          ],
        };
      }

      const result = await deployMetadata(sourcePath, effectiveOrg);

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Deployment Failed\n\n**Error:** ${result.error}\n\n**Raw Output:**\n\`\`\`\n${result.rawOutput || "No output"}\n\`\`\``,
            },
          ],
        };
      }

      let report = `# Deployment Successful\n\n**Source:** ${sourcePath}\n**Target Org:** ${effectiveOrg}\n\n`;

      if (result.rawOutput) {
        report += `## Details\n\n\`\`\`\n${result.rawOutput.substring(0, 2000)}\n\`\`\`\n`;
      }

      const actualDir = (result.data as { outputDir: string } | undefined)?.outputDir;
      if (actualDir) report += `\n${retrievedFilesText(actualDir)}`;

      return { content: [{ type: "text", text: report }] };
    }
  );

  server.tool(
    "retrieve_metadata",
    "Retrieve metadata from the target Salesforce org to a local directory. Wraps `sf project retrieve start`. Use for pulling permission sets, page layouts, flows, and other metadata to inspect or version control.",
    {
      metadata: z
        .string()
        .describe(
          "Metadata type and optional name (e.g., 'PermissionSet:LSC_Admin', 'Layout:Visit-Visit Layout', 'ApexClass')"
        ),
      outputDir: z
        .string()
        .optional()
        .describe(
          "Optional: local directory to write retrieved metadata. Defaults to current working directory."
        ),
      targetOrg: z
        .string()
        .optional()
        .describe(
          "Optional: specific org to retrieve from. Uses current target org if not specified."
        ),
    },
    async ({ metadata, outputDir, targetOrg }) => {
      const validation = await validateOrgConnection();
      const effectiveOrg = targetOrg || validation.targetOrg;

      if (!effectiveOrg) {
        return {
          content: [
            {
              type: "text",
              text: `# Cannot Retrieve Metadata\n\n${validation.error}\n\nPlease connect to a Salesforce org first.`,
            },
          ],
        };
      }

      const result = await retrieveMetadata("", metadata, effectiveOrg);

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `# Retrieve Failed\n\n**Error:** ${result.error}\n\n**Raw Output:**\n\`\`\`\n${result.rawOutput || "No output"}\n\`\`\``,
            },
          ],
        };
      }

      const actualOutputDir =
        (result.data as { outputDir: string } | undefined)?.outputDir || outputDir || "tmp project";
      let report = `# Metadata Retrieved\n\n**Metadata:** ${metadata}\n**Output:** ${actualOutputDir}\n**Source Org:** ${effectiveOrg}\n\n`;

      if (result.rawOutput) {
        report += `## Details\n\n\`\`\`\n${result.rawOutput.substring(0, 2000)}\n\`\`\`\n`;
      }

      const actualDir = (result.data as { outputDir: string } | undefined)?.outputDir;
      if (actualDir) report += `\n${retrievedFilesText(actualDir)}`;

      return { content: [{ type: "text", text: report }] };
    }
  );
}
