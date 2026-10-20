import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    parts.push("");

    // Load CLAUDE.md project instructions
    const claudeMd = this.loadFile("CLAUDE.md");
    if (claudeMd) {
      parts.push("# Project Instructions\n");
      parts.push(claudeMd);
      parts.push("");
    }

    // Load skills as context about capabilities
    const skills = this.loadSkills();
    if (skills.length > 0) {
      parts.push("# Available Skills\n");
      parts.push(
        "The following skills describe your areas of expertise. When the user's question matches a skill, follow its guidance.\n"
      );
      for (const skill of skills) {
        parts.push(`## Skill: ${skill.name}\n`);
        parts.push(skill.content);
        parts.push("");
      }
    }

    // Load commands
    const commands = this.loadCommands();
    if (commands.length > 0) {
      parts.push("# Slash Commands\n");
      parts.push(
        "Users can type these commands. When you see one, follow its instructions.\n"
      );
      for (const cmd of commands) {
        parts.push(`## /lsc:${cmd.name}\n`);
        parts.push(cmd.content);
        parts.push("");
      }
    }

    return parts.join("\n");
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

  private loadSkills(): Array<{ name: string; content: string }> {
    const skillsDir = path.join(this.projectDir, "skills");
    if (!fs.existsSync(skillsDir)) return [];

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const skillFile = path.join(skillsDir, e.name, "SKILL.md");
        if (!fs.existsSync(skillFile)) return null;
        return {
          name: e.name,
          content: fs.readFileSync(skillFile, "utf-8"),
        };
      })
      .filter(Boolean) as Array<{ name: string; content: string }>;
  }

  private loadCommands(): Array<{ name: string; content: string }> {
    const cmdsDir = path.join(this.projectDir, "commands");
    if (!fs.existsSync(cmdsDir)) return [];

    const files = fs.readdirSync(cmdsDir).filter((f) => f.endsWith(".md"));
    return files.map((f) => ({
      name: f.replace(".md", ""),
      content: fs.readFileSync(path.join(cmdsDir, f), "utf-8"),
    }));
  }
}
