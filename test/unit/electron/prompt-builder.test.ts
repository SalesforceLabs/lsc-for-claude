import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { chatInstructions, PromptBuilder } from "../../../src-electron/engine/prompt-builder.js";

const root = path.resolve(__dirname, "../../..");

describe("chatInstructions", () => {
  const md = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf-8");
  const out = chatInstructions(md);

  it("drops the Studio tool table so the model never names a studio_ tool", () => {
    expect(out).not.toContain("LSC Studio Tools");
    expect(out).not.toContain("studio_content_library");
  });

  it("drops developer sections but keeps diagrams, tools and modules", () => {
    expect(out).not.toContain("## Model Connections");
    expect(out).not.toContain("## Project Structure");
    expect(out).not.toContain("## Development Guidelines");
    expect(out).toContain("## Diagram Output");
    expect(out).toContain("#### Developer & Integrator Tools");
    expect(out).toContain("distribute_presentation");
    expect(out).toContain("## LSC4CE Modules");
    expect(out).toContain("CRITICAL: LSC Mobile Constraints");
  });

  it("is used by the system prompt", () => {
    const prompt = new PromptBuilder(root).buildSystemPrompt();
    expect(prompt).not.toContain("studio_content_library");
  });
});

describe("skills on demand", () => {
  const pb = new PromptBuilder(root);
  const prompt = pb.buildSystemPrompt();

  it("lists every skill and command with a description instead of their text", () => {
    const skills = pb.getSkillIndex();
    expect(skills.length).toBeGreaterThan(30);
    for (const s of skills) {
      expect(s.description, s.name).not.toBe(s.name);
      expect(prompt).toContain(`- \`${s.name}\`: `);
    }
    for (const c of pb.getCommandList()) expect(prompt).toContain(`- \`/lsc:${c.name}\`: `);
    expect(prompt).not.toContain(fs.readFileSync(path.join(root, "skills/lsc-visit-management/SKILL.md"), "utf-8"));
    expect(prompt.length).toBeLessThan(80_000);
  });

  it("reads a skill or command by name, and nothing else", () => {
    expect(pb.readGuide("lsc-visit-management")).toBe(fs.readFileSync(path.join(root, "skills/lsc-visit-management/SKILL.md"), "utf-8"));
    expect(pb.readGuide("/lsc:health-check")).toBe(fs.readFileSync(path.join(root, "commands/health-check.md"), "utf-8"));
    expect(pb.readGuide("lsc:health-check")).not.toBeNull();
    expect(pb.readGuide("nope")).toBeNull();
    expect(pb.readGuide("../CLAUDE.md")).toBeNull();
    expect(pb.readGuide("/lsc:../../CLAUDE")).toBeNull();
  });

  it("limits the tool's names to what exists", () => {
    const tool = pb.readSkillTool();
    const names = (tool.input_schema as { properties: { name: { enum: string[] } } }).properties.name.enum;
    expect(names).toContain("lsc-visit-management");
    expect(names).toContain("/lsc:health-check");
  });
});
