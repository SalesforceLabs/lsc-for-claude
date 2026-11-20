import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getModuleList,
  getModuleContent,
  searchKnowledge,
  getHelpDocList,
  getHelpDocContent,
  getExerciseList,
  getExerciseContent,
  getGuideList,
  getGuideContent,
  getTroubleshootingList,
  getTroubleshootingContent,
  formatCitation,
  formatGuideSectionCitation,
} from "../knowledge-loader.js";
import { searchGuides } from "../guide-loader.js";

/** How many of the top search results show their whole matching section. */
const SECTION_RESULTS = 3;

/**
 * Find the most relevant guide sections for a topic and return formatted citations.
 * Appended to module/concept responses so users can drill into the official guides.
 */
function getGuideSectionCitations(topic: string, max = 3): string {
  const guideResults = searchGuides(topic);
  if (guideResults.length === 0) return "";

  // Prefer results where the topic appears in the section title
  const topicLower = topic.toLowerCase();
  const sorted = [...guideResults].sort((a, b) => {
    const aTitle = a.sectionTitle.toLowerCase().includes(topicLower) ? 1 : 0;
    const bTitle = b.sectionTitle.toLowerCase().includes(topicLower) ? 1 : 0;
    return bTitle - aTitle;
  });

  const top = sorted.slice(0, max);
  let block =
    "\n\n---\n\n**IMPORTANT: Include the following source block EXACTLY as-is in your response (preserve all line breaks and links):**\n\n";
  block += "> **Official Guide References:**\n>\n";
  const lines: string[] = [];
  for (const r of top) {
    const guideLabel = r.guideSlug === "admin-guide" ? "Admin Guide" : "Developer Guide";
    const sectionUrl = `lsc-section://${r.guideSlug}/${r.sectionSlug}?page=${r.matchPage}&highlight=${encodeURIComponent(topic)}`;
    const pdfUrl = `lsc-pdf://${r.pdfFileName}?page=${r.matchPage}`;
    lines.push(
      `> **${guideLabel}:** [${r.sectionTitle}, page ${r.matchPage}](${sectionUrl}) | [Open PDF](${pdfUrl})`
    );
  }
  block += lines.join("\n>\n");
  return block;
}

export function register(server: McpServer) {
  server.tool(
    "list_lsc_modules",
    "List all available LSC modules with documentation",
    {},
    async () => {
      const modules = getModuleList();

      if (modules.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No modules found in the knowledge base. Please run the documentation processing script.",
            },
          ],
        };
      }

      const moduleList = modules
        .map((m) => `- **${m.title}** (${m.fileCount} docs) - \`${m.slug}\``)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `# Available LSC4CE Modules\n\n${moduleList}\n\nUse \`get_lsc_module_docs\` with a module slug to get detailed documentation.`,
          },
        ],
      };
    }
  );

  // Tool: Get Module Documentation
  server.tool(
    "get_lsc_module_docs",
    "Get detailed documentation for a specific LSC module",
    {
      module: z
        .string()
        .describe(
          "The module slug (e.g., 'account-management', 'sample-management', 'visit-management')"
        ),
    },
    async ({ module }) => {
      const content = getModuleContent(module);

      if (!content) {
        const modules = getModuleList();
        const availableModules = modules.map((m) => m.slug).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Module '${module}' not found.\n\nAvailable modules: ${availableModules}`,
            },
          ],
        };
      }

      const citation = formatCitation(module, module);
      const guideCitations = getGuideSectionCitations(module.replace(/-/g, " "));
      return {
        content: [
          {
            type: "text",
            text: content + citation + guideCitations,
          },
        ],
      };
    }
  );

  // Tool: Search LSC Knowledge Base
  server.tool(
    "search_lsc_knowledge",
    "Search the LSC knowledge base for specific topics or terms",
    {
      query: z
        .string()
        .describe(
          "The search term or phrase to look for (e.g., 'sample limits', 'provider card', 'territory alignment')"
        ),
      maxResults: z
        .number()
        .optional()
        .describe("Maximum number of results to return (default: 10)"),
    },
    async ({ query, maxResults = 10 }) => {
      const results = searchKnowledge(query).slice(0, maxResults);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No results found for '${query}'.\n\nTry different search terms or use \`list_lsc_modules\` to see available documentation.`,
            },
          ],
        };
      }

      const formattedResults = results
        .map((r, i) => {
          const pageInfo = r.matchPage ? ` (page ${r.matchPage})` : "";
          // The top results carry their whole section, so a checklist or a list of steps arrives
          // complete instead of as the 300 characters around one matching line.
          const body = i < SECTION_RESULTS && r.section ? r.section : r.excerpt;
          return `### ${i + 1}. ${r.title}${pageInfo}\n**Module:** ${r.module}\n\n${body}`;
        })
        .join("\n\n---\n\n");

      // Collect all citations into a blockquote block at the end
      const citations: string[] = [];
      for (const r of results) {
        if (r.source === "guide-section" && r.guideSlug && r.sectionSlug) {
          const guideLabel = r.guideSlug === "admin-guide" ? "Admin Guide" : "Developer Guide";
          const sectionUrl = `lsc-section://${r.guideSlug}/${r.sectionSlug}?page=${r.matchPage || r.startPage}&highlight=${encodeURIComponent(query)}`;
          const pdfUrl = `lsc-pdf://${r.pdfFileName}?page=${r.matchPage || r.startPage}`;
          citations.push(
            `> **${guideLabel}:** [${r.title}, page ${r.matchPage || r.startPage}](${sectionUrl}) | [Open PDF](${pdfUrl})`
          );
        } else if (r.sourceFile) {
          const info =
            r.source === "modules"
              ? formatCitation(r.sourceFile, r.module)
              : formatCitation(r.sourceFile);
          if (info) citations.push(info.trim());
        }
      }

      // Dedupe citations
      const uniqueCitations = [...new Set(citations)];
      const citationBlock =
        uniqueCitations.length > 0
          ? `\n\n---\n\n**IMPORTANT: Include the following source block EXACTLY as-is in your response (preserve all line breaks and links):**\n\n> **Sources:**\n>\n${uniqueCitations.join("\n>\n")}`
          : "";

      return {
        content: [
          {
            type: "text",
            text: `# Search Results for '${query}'\n\nFound ${results.length} result(s):\n\n${formattedResults}${citationBlock}`,
          },
        ],
      };
    }
  );

  // Tool: Explain LSC Concept
  server.tool(
    "explain_lsc_concept",
    "Get an explanation of a LSC concept, feature, or component",
    {
      concept: z
        .string()
        .describe(
          "The concept to explain (e.g., 'ARC', 'Provider Card', 'Sample Limits', 'Territory Alignment', 'Activity Plans')"
        ),
    },
    async ({ concept }) => {
      // Search for the concept across all modules
      const results = searchKnowledge(concept);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No documentation found for '${concept}'.\n\nThis concept may not be covered in the current knowledge base, or try a different term.`,
            },
          ],
        };
      }

      // Get the full content from the most relevant module
      const topResult = results[0];
      const moduleContent = getModuleContent(topResult.module);
      const citation = topResult.sourceFile
        ? formatCitation(
            topResult.sourceFile,
            topResult.source === "modules" ? topResult.module : undefined
          )
        : formatCitation(topResult.module, topResult.module);

      const guideCitations = getGuideSectionCitations(concept);
      return {
        content: [
          {
            type: "text",
            text: `# ${concept}\n\n**Found in module:** ${topResult.module}\n\n---\n\n${moduleContent}${citation}${guideCitations}`,
          },
        ],
      };
    }
  );

  // Tool: Get Admin Setup Guide
  server.tool(
    "get_lsc_admin_setup",
    "Get admin setup and configuration guidance for an LSC feature",
    {
      feature: z
        .string()
        .describe(
          "The feature to get admin setup for (e.g., 'sample-management', 'territory-alignment', 'visit-management')"
        ),
    },
    async ({ feature }) => {
      // Try to find admin-related documentation
      const adminResults = searchKnowledge(`${feature} admin`);
      const configResults = searchKnowledge(`${feature} configuration`);
      const setupResults = searchKnowledge(`${feature} setup`);

      const allResults = [...adminResults, ...configResults, ...setupResults];

      if (allResults.length === 0) {
        const moduleContent = getModuleContent(feature);
        if (moduleContent) {
          return {
            content: [
              {
                type: "text",
                text: `# Admin Setup: ${feature}\n\n${moduleContent}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `No admin setup documentation found for '${feature}'.\n\nUse \`list_lsc_modules\` to see available modules.`,
            },
          ],
        };
      }

      // Dedupe by module
      const uniqueModules = [...new Set(allResults.map((r) => r.module))];
      let combinedContent = `# Admin Setup Guide: ${feature}\n\n`;

      for (const moduleSlug of uniqueModules.slice(0, 3)) {
        const content = getModuleContent(moduleSlug);
        if (content) {
          const citation = formatCitation(moduleSlug, moduleSlug);
          combinedContent += `\n\n---\n\n${content}${citation}`;
        }
      }

      const guideCitations = getGuideSectionCitations(feature.replace(/-/g, " "));
      combinedContent += guideCitations;

      return {
        content: [
          {
            type: "text",
            text: combinedContent,
          },
        ],
      };
    }
  );

  // ============================================================================
  // HELP DOCUMENTATION TOOLS
  // ============================================================================

  // Tool: List Help Documents
  server.tool(
    "list_lsc_help_docs",
    "List all official Salesforce help documentation for LSC",
    {},
    async () => {
      const helpDocs = getHelpDocList();
      const exercises = getExerciseList();
      const guides = getGuideList();
      const troubleshooting = getTroubleshootingList();

      let message = "# Available LSC Documentation\n\n";

      if (helpDocs.length > 0) {
        message += "## Official Help Documentation\n\n";
        message += helpDocs.map((d) => `- **${d.title}** (\`${d.slug}\`)`).join("\n");
        message += "\n\n";
      }

      if (guides.length > 0) {
        message += "## Guides\n\n";
        message += guides.map((d) => `- **${d.title}** (\`${d.slug}\`)`).join("\n");
        message += "\n\n";
      }

      if (exercises.length > 0) {
        message += "## Hands-on Exercises\n\n";
        message += exercises.map((d) => `- **${d.title}** (\`${d.slug}\`)`).join("\n");
        message += "\n\n";
      }

      if (troubleshooting.length > 0) {
        message += "## Troubleshooting\n\n";
        message += troubleshooting.map((d) => `- **${d.title}** (\`${d.slug}\`)`).join("\n");
        message += "\n\n";
      }

      const total = helpDocs.length + exercises.length + guides.length + troubleshooting.length;
      if (total === 0) {
        message = "No documentation found. Please run the documentation processing scripts.";
      } else {
        message += `\nUse \`get_lsc_help_doc\`, \`get_lsc_guide\`, or \`get_lsc_troubleshooting\` with a slug to get the full content.`;
      }

      return {
        content: [{ type: "text", text: message }],
      };
    }
  );

  // Tool: Get Help Document
  server.tool(
    "get_lsc_help_doc",
    "Get official Salesforce help documentation for a specific LSC topic",
    {
      slug: z
        .string()
        .describe(
          "The document slug (e.g., 'account-management', 'sample-management', 'activity-plans')"
        ),
    },
    async ({ slug }) => {
      const content = getHelpDocContent(slug);

      if (!content) {
        const available = getHelpDocList();
        const slugList = available.map((d) => d.slug).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Help document '${slug}' not found.\n\nAvailable documents: ${slugList || "none"}`,
            },
          ],
        };
      }

      const citation = formatCitation(slug);
      return {
        content: [{ type: "text", text: content + citation }],
      };
    }
  );

  // Tool: Get Guide
  server.tool(
    "get_lsc_guide",
    "Get LSC guide documentation (developer guide, mobile setup guide, etc.)",
    {
      slug: z.string().describe("The guide slug (e.g., 'dev-guide', 'mobile-setup')"),
    },
    async ({ slug }) => {
      const content = getGuideContent(slug);

      if (!content) {
        const available = getGuideList();
        const slugList = available.map((d) => `${d.slug} (${d.title})`).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Guide '${slug}' not found.\n\nAvailable guides: ${slugList || "none"}`,
            },
          ],
        };
      }

      const citation = formatCitation(slug);
      return {
        content: [{ type: "text", text: content + citation }],
      };
    }
  );

  // Tool: Get Troubleshooting Documentation
  server.tool(
    "get_lsc_troubleshooting",
    "Get LSC troubleshooting documentation including common issues and their resolutions",
    {
      topic: z
        .string()
        .optional()
        .describe("Optional: specific troubleshooting topic slug. Defaults to common-issues."),
    },
    async ({ topic }) => {
      const slug = topic || "common-issues";
      const content = getTroubleshootingContent(slug);

      if (!content) {
        const available = getTroubleshootingList();
        const slugList = available.map((d) => d.slug).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Troubleshooting document '${slug}' not found.\n\nAvailable documents: ${slugList || "none"}`,
            },
          ],
        };
      }

      const citation = formatCitation(slug);
      return {
        content: [{ type: "text", text: content + citation }],
      };
    }
  );

  // Tool: Get Exercise Content
  server.tool(
    "get_lsc_exercise",
    "Get hands-on exercise documentation for LSC training",
    {
      slug: z
        .string()
        .describe(
          "The exercise slug (e.g., 'life-sciences-cloud-partner-enablement-hands-on-exercises-day-1-foundations')"
        ),
    },
    async ({ slug }) => {
      const content = getExerciseContent(slug);

      if (!content) {
        const available = getExerciseList();
        const slugList = available.map((d) => `${d.slug}`).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Exercise '${slug}' not found.\n\nAvailable exercises: ${slugList || "none"}`,
            },
          ],
        };
      }

      const citation = formatCitation(slug);
      return {
        content: [{ type: "text", text: content + citation }],
      };
    }
  );
}
