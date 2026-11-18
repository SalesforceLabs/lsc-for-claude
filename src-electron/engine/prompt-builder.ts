import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ToolDefinition } from "../llm/provider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The engine's own tool that hands the model a skill or command (`ConversationEngine`, `readSkillTool`). */
export const READ_SKILL_TOOL = "read_skill";

/** Skill and command names are folder and file names: never a path. */
function safeName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/i.test(name);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Top-level sections of CLAUDE.md written for the app's developers, not for the chat model. */
const DEV_SECTIONS = [/— Electron App$/, /^Architecture$/, /^Project Structure$/, /^Installation & Usage$/, /^Development Guidelines$/, /^Resources$/];
/** Sections kept even though they match DEV_SECTIONS. */
const KEEP_SECTIONS = [/^Diagram Output/];
/** Subsections describing tools the chat model can't call (Studio's, which the engine refuses). */
const HIDDEN_SUBSECTIONS = [/^LSC Studio Tools/];

/**
 * CLAUDE.md as the chat model should see it: without the developer notes and without the Studio tool
 * table, which named tools the model then tried to call (they're hidden from it and refused).
 */
export function chatInstructions(md: string): string {
  const out: string[] = [];
  let dropLevel = 0; // heading level of the section being dropped; 0 = keeping
  for (const line of md.split("\n")) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const title = h[2].trim();
      if (dropLevel && level <= dropLevel) dropLevel = 0;
      if (!dropLevel) {
        const dev = level === 2 && DEV_SECTIONS.some((r) => r.test(title)) && !KEEP_SECTIONS.some((r) => r.test(title));
        if (dev || HIDDEN_SUBSECTIONS.some((r) => r.test(title))) dropLevel = level;
      }
    }
    if (!dropLevel) out.push(line);
  }
  return out.join("\n");
}

/**
 * Builds the system prompt by loading CLAUDE.md, skills, and commands
 * from the project directory — same content Claude Code would inject.
 */
export class PromptBuilder {
  private projectDir: string;

  constructor(projectDir?: string) {
    this.projectDir = projectDir ?? path.resolve(__dirname, "..", "..");
  }

  buildSystemPrompt(): string {
    const parts: string[] = [];

    // Core identity
    parts.push(
      "You are Roz, the AI assistant in the Roz for LSC app, specialized in Salesforce LSC (LSC) for Customer Engagement implementations."
    );
    parts.push(
      "You help consultants, developers, and administrators with LSC configuration, troubleshooting, and best practices."
    );
    parts.push(
      "When the user reports an error or a symptom, the app may already have run `diagnose_lsc_issue` and its result is in the conversation: start from it, say which known causes were found in the org and the fix for each, and only if none fit investigate further with the org tools. For \"why can't <rep> see or do X\", call `check_user_access` with the rep and, when it is clear, the feature, and report the first broken link. It traces one rep and is slow, so don't run it rep by rep: when the problem is about reps in general, look at what they share (their profile's navigation tabs, DB Schema, permission sets, metadata cache) and check one rep only if it helps, asking the user which."
    );
    parts.push(
      "Tools whose names start with `studio_` belong to the app's Studio screens and are not available in chat; never call one. Use the org tools instead (for presentations: `run_soql` on `Presentation`, then `distribute_presentation` / `assign_presentation_content`)."
    );
    parts.push(
      "The user doesn't see raw tool results, only the step rows. When you say \"here are…\", put the items in your reply (a short list or table)."
    );
    parts.push(
      "When the user has to pick from things you found (which presentation, territory, profile, user, record) or answer a short either/or question, call `ask_user` with the options instead of listing them and asking in text; keep your text to what you found, and ask one question at a time. Over 12 candidates, ask something that narrows them first."
    );
    parts.push("");

    // Load CLAUDE.md project instructions (minus the parts written for the app's developers)
    const claudeMd = this.loadFile("CLAUDE.md");
    if (claudeMd) {
      parts.push("# Project Instructions\n");
      parts.push(chatInstructions(claudeMd));
      parts.push("");
    }

    // Skills and commands are listed, not inlined: the model reads one with `read_skill` when it needs it.
    const skills = this.getSkillIndex();
    if (skills.length > 0) {
      parts.push("# Skills\n");
      parts.push(
        `Each skill is a guide for one area of LSC. Before answering a question or doing a task in a skill's area, call \`${READ_SKILL_TOOL}\` with its name and follow it. Read a skill once per conversation; it stays in the history.\n`
      );
      for (const skill of skills) parts.push(`- \`${skill.name}\`: ${oneLine(skill.description)}`);
      parts.push("");
    }

    const commands = this.getCommandList();
    if (commands.length > 0) {
      parts.push("# Slash Commands\n");
      parts.push(
        `Users can type these. A typed command arrives with its instructions. When the user asks in words for what a command does, call \`${READ_SKILL_TOOL}\` with \`/lsc:<name>\` and follow it.\n`
      );
      for (const cmd of commands) parts.push(`- \`/lsc:${cmd.name}\`: ${oneLine(cmd.description)}`);
      parts.push("");
    }

    return parts.join("\n");
  }

  /** The `read_skill` tool, its names limited to the skills and commands there are. */
  readSkillTool(): ToolDefinition {
    const names = [...this.getSkillIndex().map((s) => s.name), ...this.getCommandList().map((c) => `/lsc:${c.name}`)];
    return {
      name: READ_SKILL_TOOL,
      description: "Read one of the skills (or slash commands) listed in the system prompt: its full guidance, which you then follow.",
      input_schema: {
        type: "object",
        properties: { name: { type: "string", enum: names, description: "A skill name, or /lsc:<command>" } },
        required: ["name"],
      },
    };
  }

  /** A skill's (or, as `/lsc:<name>`, a command's) full text for `read_skill`, or null when there's none by that name. */
  readGuide(name: string): string | null {
    const trimmed = name.trim();
    const command = /^\/?lsc:(\S+)$/.exec(trimmed);
    if (command) return safeName(command[1]) ? this.getCommandContent(command[1]) : null;
    if (!safeName(trimmed)) return null;
    return this.loadFile(path.join("skills", trimmed, "SKILL.md"));
  }

  /** Load skills but return only names — for lazy loading */
  getSkillIndex(): Array<{ name: string; description: string }> {
    const skillsDir = path.join(this.projectDir, "skills");
    if (!fs.existsSync(skillsDir)) return [];

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const skillFile = path.join(skillsDir, e.name, "SKILL.md");
        if (!fs.existsSync(skillFile)) return null;
        const content = fs.readFileSync(skillFile, "utf-8");
        // Extract description from YAML frontmatter
        const match = content.match(
          /^---\n[\s\S]*?description:\s*["']?(.+?)["']?\n[\s\S]*?---/
        );
        return {
          name: e.name,
          description: match?.[1] ?? e.name,
        };
      })
      .filter(Boolean) as Array<{ name: string; description: string }>;
  }

  getCommandList(): Array<{ name: string; description: string }> {
    const cmdsDir = path.join(this.projectDir, "commands");
    if (!fs.existsSync(cmdsDir)) return [];

    const files = fs.readdirSync(cmdsDir).filter((f) => f.endsWith(".md"));
    return files.map((f) => {
      const content = fs.readFileSync(path.join(cmdsDir, f), "utf-8");
      const match = content.match(
        /^---\n[\s\S]*?description:\s*["']?(.+?)["']?\n[\s\S]*?---/
      );
      const name = f.replace(".md", "");
      return {
        name,
        description: match?.[1] ?? name,
      };
    });
  }

  getCommandContent(name: string): string | null {
    const filePath = path.join(this.projectDir, "commands", `${name}.md`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  }

  private loadFile(relativePath: string): string | null {
    const filePath = path.join(this.projectDir, relativePath);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  }
}
