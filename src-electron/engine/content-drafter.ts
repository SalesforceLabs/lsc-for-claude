import { randomUUID } from "crypto";
import type {
  ContentBlock,
  LLMProvider,
  Message,
  StreamChunk,
  ToolDefinition,
} from "../llm/provider.js";
import { getDb } from "./history.js";
import { followWrite, type StudioCall } from "./app-builder.js";
import type {
  ContentDraft,
  ContentDraftCheck,
  ContentDraftEvent,
  ContentDraftFile,
  ContentDraftStep,
  ContentDraftTurn,
} from "./content-draft-types.js";

/**
 * Roz drafts Intelligent Content pages (HTML5 ZIP pages) from a brief: the model writes slide files
 * (write_slides), Studio lays them out in the engine's CLM folder and checks them (studio_content_draft),
 * problems go back to the model, and the app draws each slide's thumbnail. Nothing reaches the org here:
 * a draft becomes a page only when it's put in a new presentation through the tray, saved inactive and
 * undistributed. Same loop shape as the LSC App Builder (app-builder.ts), with two tools.
 */

export const MAX_DRAFT_ROUNDS = 10;
export const MAX_FAILING_DRAFT_WRITES = 3;
const MAX_TOKENS = 32_000;
const MAX_FILES = 40;
const MAX_CHARS = 1_500_000;

/** What the server's studio_content_draft answers (the player is passed through to the renderer). */
export interface DraftSync {
  player: {
    root: string;
    slides: Array<{ name: string; file: string; thumbnail?: string }>;
  } & Record<string, unknown>;
  checks: ContentDraftCheck[];
  files: string[];
  thumbnails: string[];
}

export interface ContentDraftStore {
  list(org: string): ContentDraft[];
  get(id: string): ContentDraft | null;
  save(draft: ContentDraft): void;
  delete(id: string): void;
  recoverInterrupted(): number;
}

export interface ContentDrafterDeps {
  llm: () => LLMProvider | null;
  model: () => string | undefined;
  call: StudioCall;
  store: ContentDraftStore;
  emit: (draftId: string, event: ContentDraftEvent) => void;
  /** Draws the named slides' thumbnails into the draft's folder (main process); failures are ignored. */
  drawThumbnails?: (draftId: string, sync: DraftSync, slides: string[]) => Promise<void>;
}

export const DRAFT_TOOLS: ToolDefinition[] = [
  {
    name: "write_slides",
    description:
      "Write or change the page's files. Send every file you add or change in full and list files to remove in `delete`. Slides are .html files at the top level, named in order like 01_title.html, 02_benefits.html. Shared CSS, scripts and images may sit at the top or in one folder (css/style.css, img/logo.svg). The result lists problems; fix the errors with another write_slides.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          maxLength: 80,
          description:
            'Send on the first write: the page\'s name in sentence case, e.g. "Dosing overview". Later only to rename it.',
        },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "e.g. 01_title.html or css/style.css" },
              content: { type: "string", description: "The complete file contents" },
            },
            required: ["path", "content"],
          },
        },
        delete: {
          type: "array",
          items: { type: "string" },
          description: "Paths of files to remove",
        },
      },
      required: ["files"],
    },
  },
  {
    name: "finish",
    description:
      "End the turn once the slides are written and have no errors. The summary is shown to the user: say what the slides cover and list every placeholder they still have to fill in with approved copy.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    },
  },
];

export const DRAFT_GUIDE = `You draft Intelligent Content pages for Life Sciences Cloud: HTML5 slides a pharmaceutical sales rep shows a healthcare professional on an iPad, in the LSC Mobile CLM player. One page holds one or more slides.

Slides:
- Each slide is a complete HTML file at the top level of the page, named in order: 01_title.html, 02_mechanism.html. The iPad orders slides by file name.
- Design for an iPad in landscape, 1024 by 768 CSS pixels. Put <meta name="viewport" content="width=1024"> in every slide and make the body exactly 1024 by 768 with no scrolling.
- Everything is in the page: no network at all. No CDN, web fonts, external images or analytics. Use system fonts (-apple-system, Helvetica, Arial), inline SVG or SVG files for graphics, and CSS for color. Share one stylesheet between slides.
- Plain HTML, CSS and a little JavaScript. No frameworks, no build step, no forms.
- Slides move with the player's swipe. A button that jumps to another slide calls PresentationPlayer.gotoSlide("", "03_safety.html"); next and previous are PresentationPlayer.goNextPage() and PresentationPlayer.goPreviousPage(). The player provides PresentationPlayer; don't define it.
- Large, readable type (body at least 20px), high contrast, generous spacing, one idea per slide. Touch targets at least 44px.

Content rules — these matter more than design:
- This is promotional material for a regulated industry. It goes through medical, legal and regulatory review before any rep sees it.
- Never invent claims, efficacy or safety numbers, study names, references, indications, dosing, or quotes. Never name a real product as if you knew its data.
- Where a claim, number or reference goes, write a visible placeholder in square brackets, such as [Add approved efficacy claim], [Add reference 1] or [Add ISI text], styled so a reviewer can't miss it.
- Brand names, colors and logos only when the user gives them. Otherwise use neutral colors and a "[Logo]" box.
- Leave room for important safety information and references where the brief calls for them.

Workflow: write the slides with write_slides (send a name on the first write), fix every error its result lists, then call finish with a short summary in plain words that lists the placeholders left to fill.`;

const nowIso = () => new Date().toISOString();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

class GaveUp extends Error {}

/** The page name the model sent, trimmed to what the org takes; null when there isn't one. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  return name || null;
}

/** `files` merged into `current`: changed files replaced, new ones added, `remove` dropped. */
export function mergeFiles(
  current: ContentDraftFile[],
  files: ContentDraftFile[],
  remove: string[] = []
): ContentDraftFile[] {
  const out = new Map(current.map((f) => [f.path, f]));
  for (const p of remove) out.delete(p);
  for (const f of files) out.set(f.path, { path: f.path, content: f.content });
  return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The write_slides input, checked for shape; throws with a message for the model. */
export function parseWrite(input: Record<string, unknown>): {
  name: string | null;
  files: ContentDraftFile[];
  remove: string[];
} {
  const files = Array.isArray(input.files) ? input.files : [];
  if (files.length > MAX_FILES) throw new Error(`Send at most ${MAX_FILES} files in one write.`);
  const out: ContentDraftFile[] = [];
  let chars = 0;
  for (const f of files) {
    const path = (f as { path?: unknown })?.path;
    const content = (f as { content?: unknown })?.content;
    if (typeof path !== "string" || typeof content !== "string")
      throw new Error("Each file needs a path and its content.");
    chars += content.length;
    out.push({ path: path.trim(), content });
  }
  if (chars > MAX_CHARS)
    throw new Error(
      "The files are too large. Keep slides small: no embedded images over a few hundred KB."
    );
  const remove = Array.isArray(input.delete)
    ? input.delete.filter((p): p is string => typeof p === "string")
    : [];
  if (!out.length && !remove.length) throw new Error("Send at least one file.");
  return { name: cleanName(input.name), files: out, remove };
}

/** The tool result the model reads after a write. */
export function writeResult(sync: DraftSync): string {
  const errors = sync.checks.filter((c) => c.level === "error");
  const warnings = sync.checks.filter((c) => c.level === "warning");
  const lines = [
    `Saved. The page has ${sync.player.slides.length} slide(s): ${sync.player.slides.map((s) => s.name).join(", ") || "none"}.`,
  ];
  if (errors.length)
    lines.push(
      "Errors to fix:",
      ...errors.map((c) => `- ${c.file ? `${c.file}: ` : ""}${c.message}`)
    );
  if (warnings.length)
    lines.push("Warnings:", ...warnings.map((c) => `- ${c.file ? `${c.file}: ` : ""}${c.message}`));
  if (!errors.length) lines.push("No errors. Call finish when the slides are done.");
  return lines.join("\n");
}

interface Run {
  abort: { aborted: boolean };
  abortNow: () => void;
  draft: ContentDraft;
}

export class ContentDrafter {
  private runs = new Map<string, Run>();

  constructor(private deps: ContentDrafterDeps) {}

  list(org: string): ContentDraft[] {
    return this.deps.store.list(org).map((d) => this.runs.get(d.id)?.draft ?? d);
  }

  get(id: string): ContentDraft | null {
    const live = this.runs.get(id)?.draft;
    return live ? structuredClone(live) : this.deps.store.get(id);
  }

  isRunning(id: string): boolean {
    return this.runs.has(id);
  }

  create(org: string, prompt: string): ContentDraft | { error: string } {
    const text = prompt.trim();
    if (!text) return { error: "Say what the slides should cover." };
    const at = nowIso();
    const draft: ContentDraft = {
      id: randomUUID(),
      org: org.toLowerCase(),
      name: "New page",
      createdAt: at,
      updatedAt: at,
      files: [],
      checks: [],
      revision: 0,
      turns: [],
    };
    this.deps.store.save(draft);
    this.startTurn(draft, text);
    return structuredClone(draft);
  }

  send(id: string, prompt: string): ContentDraft | { error: string } {
    const draft = this.deps.store.get(id);
    if (!draft) return { error: "That draft is gone." };
    if (this.runs.has(id)) return { error: "Roz is still working on this draft." };
    const text = prompt.trim();
    if (!text) return { error: "Say what to change." };
    this.startTurn(draft, text);
    return structuredClone(draft);
  }

  stop(id: string): void {
    this.runs.get(id)?.abortNow();
  }

  rename(id: string, name: string): ContentDraft | { error: string } {
    const draft = this.get(id);
    const clean = cleanName(name);
    if (!draft) return { error: "That draft is gone." };
    if (!clean) return { error: "The page needs a name." };
    if (this.runs.has(id)) return { error: "Wait for Roz to finish first." };
    draft.name = clean;
    draft.updatedAt = nowIso();
    this.deps.store.save(draft);
    return draft;
  }

  async delete(id: string): Promise<void> {
    this.stop(id);
    this.deps.store.delete(id);
    try {
      await this.deps.call("studio_content_draft", { draftId: id, remove: true }, 30_000);
    } catch {
      // the temp folder is cleaned up by the system anyway
    }
  }

  /**
   * Lays the draft's files out in the CLM folder again (the temp folder may have been cleaned since) and
   * draws missing thumbnails; returns the player and checks.
   */
  async preview(id: string): Promise<DraftSync> {
    const draft = this.get(id);
    if (!draft) throw new Error("That draft is gone.");
    if (!draft.files.length) throw new Error("Roz hasn't written any slides yet.");
    return this.sync(draft);
  }

  private async sync(draft: ContentDraft): Promise<DraftSync> {
    const args = { draftId: draft.id, name: draft.name, files: draft.files, replace: true };
    let out = (await this.deps.call("studio_content_draft", args, 60_000)) as DraftSync;
    if (out.thumbnails?.length && this.deps.drawThumbnails) {
      try {
        await this.deps.drawThumbnails(draft.id, out, out.thumbnails);
        out = (await this.deps.call(
          "studio_content_draft",
          { draftId: draft.id, name: draft.name },
          60_000
        )) as DraftSync;
      } catch {
        // thumbnails are nice to have; the slides still play
      }
    }
    return out;
  }

  private persist(draft: ContentDraft): void {
    draft.updatedAt = nowIso();
    this.deps.store.save(draft);
  }

  private startTurn(draft: ContentDraft, prompt: string): void {
    const turn: ContentDraftTurn = {
      id: randomUUID(),
      prompt,
      at: nowIso(),
      status: "running",
      reply: "",
      steps: [],
    };
    draft.turns.push(turn);
    let abortNow = () => {};
    const abort = { aborted: false };
    const aborted = new Promise<never>((_, reject) => {
      abortNow = () => {
        abort.aborted = true;
        reject(new Error("aborted"));
      };
    });
    aborted.catch(() => {});
    this.runs.set(draft.id, { abort, abortNow, draft });
    this.persist(draft);
    this.deps.emit(draft.id, { type: "turn", turn: structuredClone(turn) });
    void this.runTurn(draft, turn, abort, aborted).finally(() => {
      this.runs.delete(draft.id);
      this.persist(draft);
    });
  }

  private async runTurn(
    draft: ContentDraft,
    turn: ContentDraftTurn,
    abort: { aborted: boolean },
    aborted: Promise<never>
  ): Promise<void> {
    const emit = (event: ContentDraftEvent) => {
      if (!abort.aborted || event.type === "turn") this.deps.emit(draft.id, event);
    };
    const startStep = (label: string): ContentDraftStep => {
      const step: ContentDraftStep = { id: randomUUID(), label, status: "running" };
      turn.steps.push(step);
      emit({ type: "step", turnId: turn.id, step: { ...step } });
      return step;
    };
    const endStep = (step: ContentDraftStep, status: "done" | "failed", detail?: string) => {
      Object.assign(step, { status, ...(detail ? { detail } : {}) });
      emit({ type: "step", turnId: turn.id, step: { ...step } });
    };
    const setStatus = (status: ContentDraftTurn["status"], error?: string) => {
      turn.status = status;
      if (error) turn.error = error;
      this.persist(draft);
      this.deps.emit(draft.id, { type: "turn", turn: structuredClone(turn) });
    };
    const appendReply = (text: string) => {
      turn.reply += text;
      emit({ type: "reply-delta", turnId: turn.id, text });
    };

    const llm = this.deps.llm();
    if (!llm) return setStatus("failed", "The model connection isn't ready.");

    let lastOk: boolean | null = null;
    let failing = 0;
    let finished = false;
    let summary = "";
    try {
      const messages: Message[] = [{ role: "user", content: this.contextMessage(draft, turn) }];
      for (let round = 0; round < MAX_DRAFT_ROUNDS && !finished; round++) {
        if (abort.aborted) throw new Error("aborted");
        const calls = new Map<string, { name: string; json: string }>();
        let currentId = "";
        let lastEmit = 0;
        let textThisRound = false;
        const onChunk = (chunk: StreamChunk) => {
          if (abort.aborted) return;
          if (chunk.type === "text_delta" && chunk.text) {
            if (!textThisRound && turn.reply && !/\s$/.test(turn.reply)) appendReply("\n\n");
            textThisRound = true;
            appendReply(chunk.text);
          } else if (chunk.type === "tool_use_start" && chunk.id) {
            currentId = chunk.id;
            calls.set(chunk.id, { name: chunk.name ?? "", json: "" });
          } else if (chunk.type === "tool_use_delta" && chunk.input_json && currentId) {
            const call = calls.get(currentId);
            if (!call) return;
            call.json += chunk.input_json;
            const t = Date.now();
            if (call.name === "write_slides" && t - lastEmit > 150) {
              lastEmit = t;
              const { path, chars } = followWrite(call.json);
              emit({ type: "writing", turnId: turn.id, path: path ?? "", chars });
            }
          }
        };
        const response = await Promise.race([
          llm.chat(
            DRAFT_GUIDE,
            messages,
            DRAFT_TOOLS,
            {
              model: this.deps.model(),
              maxTokens: MAX_TOKENS,
              cache: process.env.LSC_BUILDER_CACHE !== "0",
            },
            onChunk
          ),
          aborted,
        ]);
        if (abort.aborted) throw new Error("aborted");
        messages.push(response);
        const content = (
          typeof response.content === "string"
            ? [{ type: "text", text: response.content } as ContentBlock]
            : response.content
        ) as ContentBlock[];
        const toolCalls = content.filter((b) => b.type === "tool_use");
        if (!toolCalls.length) break;

        const results: ContentBlock[] = [];
        for (const call of toolCalls) {
          const input = (call.input ?? {}) as Record<string, unknown>;
          let text: string;
          let isError = false;
          if (call.name === "write_slides") {
            const step = startStep("Writing slides");
            try {
              const parsed = parseWrite(input);
              const next: ContentDraft = {
                ...draft,
                name: parsed.name ?? draft.name,
                files: mergeFiles(draft.files, parsed.files, parsed.remove),
              };
              const sync = await Promise.race([this.sync(next), aborted]);
              draft.name = next.name;
              draft.files = next.files;
              draft.checks = sync.checks ?? [];
              draft.revision++;
              this.persist(draft);
              emit({ type: "draft", draft: structuredClone(draft) });
              const errors = draft.checks.filter((c) => c.level === "error").length;
              lastOk = errors === 0;
              failing = lastOk ? 0 : failing + 1;
              const n = sync.player.slides.length;
              endStep(
                step,
                lastOk ? "done" : "failed",
                lastOk
                  ? `${n} ${n === 1 ? "slide" : "slides"}`
                  : `${errors} ${errors === 1 ? "problem" : "problems"}`
              );
              text = writeResult(sync);
            } catch (error) {
              if (abort.aborted) throw error;
              lastOk = false;
              failing++;
              endStep(step, "failed", message(error));
              text = `Not saved: ${message(error)}`;
              isError = true;
            }
            if (failing >= MAX_FAILING_DRAFT_WRITES) {
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: text,
                is_error: isError,
              });
              throw new GaveUp();
            }
          } else if (call.name === "finish") {
            if (lastOk === false) {
              text = "The slides still have errors. Fix them with write_slides first.";
              isError = true;
            } else {
              finished = true;
              summary = typeof input.summary === "string" ? input.summary.trim() : "";
              text = "Done.";
            }
          } else {
            text = `Unknown tool ${call.name}.`;
            isError = true;
          }
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: text,
            is_error: isError,
          });
        }
        messages.push({ role: "user", content: results });
      }
      if (summary && !turn.reply.includes(summary))
        appendReply(`${turn.reply ? "\n\n" : ""}${summary}`);
      if (lastOk === false)
        setStatus("failed", "Roz stopped before the slides were free of errors.");
      else setStatus("done");
    } catch (error) {
      for (const s of turn.steps) if (s.status === "running") s.status = "failed";
      if (error instanceof GaveUp)
        setStatus("failed", `The slides still had errors after ${MAX_FAILING_DRAFT_WRITES} tries.`);
      else if (abort.aborted) setStatus("stopped");
      else setStatus("failed", message(error));
    }
  }

  private contextMessage(draft: ContentDraft, turn: ContentDraftTurn): string {
    if (!draft.files.length) return `Draft a new page named by you. The brief:\n\n${turn.prompt}`;
    const files = draft.files.map((f) => `--- ${f.path}\n${f.content}`).join("\n\n");
    const errors = draft.checks
      .filter((c) => c.level === "error")
      .map((c) => `- ${c.file ? `${c.file}: ` : ""}${c.message}`);
    return [
      `The page "${draft.name}" has these files now:`,
      files,
      errors.length ? `Problems found in them:\n${errors.join("\n")}` : "",
      `The user asks:\n\n${turn.prompt}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

// --- storage ---

export const INTERRUPTED_DRAFT = "Roz was closed while drafting";

export function stopInterruptedDraft(draft: ContentDraft): boolean {
  let changed = false;
  for (const t of draft.turns) {
    if (t.status !== "running") continue;
    t.status = "stopped";
    t.error = INTERRUPTED_DRAFT;
    for (const s of t.steps) if (s.status === "running") s.status = "failed";
    changed = true;
  }
  return changed;
}

let ready = false;
function db() {
  const d = getDb();
  if (!ready) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS content_drafts (
        id TEXT PRIMARY KEY,
        org TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_content_drafts_org ON content_drafts(org, updated_at);
    `);
    ready = true;
  }
  return d;
}

export const sqliteDraftStore: ContentDraftStore = {
  list(org) {
    const rows = db()
      .prepare("SELECT data FROM content_drafts WHERE org = ? ORDER BY updated_at DESC")
      .all(org.toLowerCase()) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ContentDraft);
  },
  get(id) {
    const row = db().prepare("SELECT data FROM content_drafts WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as ContentDraft) : null;
  },
  save(draft) {
    db()
      .prepare(
        `INSERT INTO content_drafts (id, org, updated_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET org = excluded.org, updated_at = excluded.updated_at, data = excluded.data`
      )
      .run(draft.id, draft.org.toLowerCase(), draft.updatedAt, JSON.stringify(draft));
  },
  delete(id) {
    db().prepare("DELETE FROM content_drafts WHERE id = ?").run(id);
  },
  recoverInterrupted() {
    const rows = db()
      .prepare('SELECT data FROM content_drafts WHERE data LIKE \'%"status":"running"%\'')
      .all() as Array<{ data: string }>;
    let n = 0;
    for (const r of rows) {
      const draft = JSON.parse(r.data) as ContentDraft;
      if (stopInterruptedDraft(draft)) {
        this.save(draft);
        n++;
      }
    }
    return n;
  },
};

export function memoryDraftStore(): ContentDraftStore {
  const rows = new Map<string, string>();
  return {
    list: (org) =>
      [...rows.values()]
        .map((r) => JSON.parse(r) as ContentDraft)
        .filter((d) => d.org === org.toLowerCase())
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => (rows.has(id) ? (JSON.parse(rows.get(id)!) as ContentDraft) : null),
    save: (d) => void rows.set(d.id, JSON.stringify(d)),
    delete: (id) => void rows.delete(id),
    recoverInterrupted() {
      let n = 0;
      for (const [id, r] of rows) {
        const d = JSON.parse(r) as ContentDraft;
        if (stopInterruptedDraft(d)) {
          rows.set(id, JSON.stringify(d));
          n++;
        }
      }
      return n;
    },
  };
}
