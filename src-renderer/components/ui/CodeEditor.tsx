import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { unifiedMergeView } from "@codemirror/merge";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, StateEffect, StateField, Transaction, type ChangeSpec, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";
import { editorTheme, highlightTheme } from "./code-editor-theme";
import "./code-editor.css";

/** A problem to show in the gutter and underline. Offsets are characters into the code; (0, 0) means the whole script. */
export interface CodeDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  /** Why it matters; shown under the message. */
  detail?: string;
  from: number;
  to: number;
  fix?: { label: string; changes: { from: number; to: number; insert: string }[] };
}

/** One thing autocomplete can offer. Methods name the global or class they belong to in `parent`. */
export interface CodeCompletion {
  label: string;
  kind: "variable" | "method" | "class" | "function" | "property";
  parent?: string;
  signature?: string;
  doc?: string;
}

export interface CodeEditorHandle {
  focus(): void;
  /** Moves the cursor to a 1-based line and column and scrolls it into view. */
  jumpTo(line: number, column?: number): void;
  /** Moves the cursor to a character offset. */
  jumpToOffset(offset: number): void;
  /** Applies changes as one undo step. */
  applyChanges(changes: ChangeSpec): void;
  getValue(): string;
  /** Takes the proposal into the code as one undo step. */
  acceptProposal(): void;
  /** Puts the code back as it was before the proposal. */
  rejectProposal(): void;
}

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  diagnostics?: readonly CodeDiagnostic[];
  completions?: readonly CodeCompletion[];
  /** Proposed replacement for the code, shown as an inline diff against the current code until accepted or rejected. */
  proposal?: string | null;
  "aria-label": string;
  className?: string;
}

/** How long a jumped-to line stays lit. */
const FLASH_MS = 1500;

/** Lights one line (by its start offset) until cleared with null. */
const flashLine = StateEffect.define<number | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashLine)) next = e.value === null ? Decoration.none : Decoration.set([Decoration.line({ class: "code-editor-flash" }).range(e.value)]);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const KEYWORDS = ["async", "await", "return", "const", "let", "var", "function", "if", "else", "try", "catch", "for", "of", "new", "typeof", "true", "false", "null", "undefined"];

function completionInfo(c: CodeCompletion): (() => Node) | undefined {
  if (!c.signature && !c.doc) return undefined;
  return () => {
    const root = document.createElement("div");
    root.className = "code-editor-doc";
    if (c.signature) {
      const sig = document.createElement("code");
      sig.textContent = c.signature;
      root.appendChild(sig);
    }
    if (c.doc) {
      const p = document.createElement("p");
      p.textContent = c.doc;
      root.appendChild(p);
    }
    return root;
  };
}

function toCompletion(c: CodeCompletion, boost = 0): Completion {
  return {
    label: c.label,
    type: c.kind,
    info: completionInfo(c),
    boost,
  };
}

/** Globals and keywords at the start of a word; the methods of a known global or class after `name.`. */
function completionSource(get: () => readonly CodeCompletion[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const all = get();
    const dotted = ctx.matchBefore(/[A-Za-z_$][\w$]*\.[\w$]*/);
    if (dotted) {
      const dot = dotted.text.indexOf(".");
      const receiver = dotted.text.slice(0, dot);
      const from = dotted.from + dot + 1;
      const own = all.filter((c) => c.parent === receiver);
      if (own.length) return { from, options: own.map((c) => toCompletion(c)), validFor: /^[\w$]*$/ };
      // Unknown receiver (a result, an array item): offer every method, quietly.
      const methods = all.filter((c) => c.kind === "method");
      if (!methods.length) return null;
      return { from, options: methods.map((c) => toCompletion(c, -50)), validFor: /^[\w$]*$/ };
    }
    const word = ctx.matchBefore(/[A-Za-z_$][\w$]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const top = all.filter((c) => !c.parent && c.kind !== "method" && c.kind !== "property");
    const options: Completion[] = [
      ...top.map((c) => toCompletion(c, c.kind === "variable" ? 10 : 0)),
      ...KEYWORDS.map((k) => ({ label: k, type: "keyword", boost: -20 })),
    ];
    return { from: word.from, options, validFor: /^[\w$]*$/ };
  };
}

function toLintDiagnostics(diags: readonly CodeDiagnostic[], docLength: number): Diagnostic[] {
  return diags.map((d) => {
    let from = Math.max(0, Math.min(d.from, docLength));
    let to = Math.max(from, Math.min(d.to, docLength));
    // A whole-script finding has no position: mark the first character.
    if (from === to) to = Math.min(from + 1, docLength);
    if (from === to) from = Math.max(0, to - 1);
    return {
      from,
      to,
      severity: d.severity,
      message: d.message,
      renderMessage: () => {
        const root = document.createElement("div");
        const msg = document.createElement("div");
        msg.className = "code-editor-diag-message";
        msg.textContent = d.message;
        root.appendChild(msg);
        if (d.detail) {
          const detail = document.createElement("div");
          detail.className = "code-editor-diag-detail";
          detail.textContent = d.detail;
          root.appendChild(detail);
        }
        return root;
      },
      actions: d.fix
        ? [
            {
              name: d.fix.label,
              apply(view: EditorView) {
                const len = view.state.doc.length;
                view.dispatch({
                  changes: d.fix!.changes.map((c) => ({ from: Math.min(c.from, len), to: Math.min(c.to, len), insert: c.insert })),
                  userEvent: "input.quickfix",
                });
              },
            },
          ]
        : undefined,
    };
  });
}

/**
 * A code editor for JavaScript built on CodeMirror 6: line numbers, folding, search, history, autocomplete from the
 * `completions` prop, problems from `diagnostics`, and a proposal mode that shows a replacement as an inline diff.
 * Heavy (CodeMirror is a few hundred KB): import it with React.lazy.
 */
const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, onChange, readOnly = false, diagnostics, completions, proposal = null, className, ...rest },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const completionsRef = useRef<readonly CodeCompletion[]>(completions ?? []);
  completionsRef.current = completions ?? [];
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const merge = useRef(new Compartment());
  const locked = useRef(new Compartment());
  /** Set while the editor shows a proposal: the code as it was before. */
  const original = useRef<string | null>(null);
  /** Programmatic changes that the parent must not hear about. */
  const quiet = useRef(false);
  const flashTimer = useRef<number | undefined>(undefined);

  const dispatchQuiet = (v: EditorView, spec: Parameters<EditorView["dispatch"]>[0]) => {
    quiet.current = true;
    try {
      v.dispatch(spec);
    } finally {
      quiet.current = false;
    }
  };

  const replaceAll = (v: EditorView, text: string, history: boolean) => {
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: text },
      annotations: history ? undefined : Transaction.addToHistory.of(false),
    });
  };

  const startProposal = (v: EditorView, proposed: string) => {
    const before = v.state.doc.toString();
    if (before === proposed) return;
    original.current = before;
    dispatchQuiet(v, {
      effects: [
        merge.current.reconfigure(unifiedMergeView({ original: before, gutter: true, highlightChanges: true, syntaxHighlightDeletions: true, mergeControls: false })),
        locked.current.reconfigure(EditorState.readOnly.of(true)),
      ],
    });
    dispatchQuiet(v, {
      changes: { from: 0, to: v.state.doc.length, insert: proposed },
      annotations: Transaction.addToHistory.of(false),
    });
  };

  /** Back to the code as it was. Returns what the proposal said. */
  const endProposal = (v: EditorView): string | null => {
    const before = original.current;
    if (before === null) return null;
    const proposed = v.state.doc.toString();
    original.current = null;
    dispatchQuiet(v, {
      changes: { from: 0, to: v.state.doc.length, insert: before },
      annotations: Transaction.addToHistory.of(false),
      effects: [merge.current.reconfigure([]), locked.current.reconfigure(EditorState.readOnly.of(readOnlyRef.current))],
    });
    return proposed;
  };

  /** Scrolls to a position, puts the cursor there and lights its line for a moment. */
  const reveal = (v: EditorView, pos: number) => {
    v.dispatch({
      selection: { anchor: pos },
      effects: [EditorView.scrollIntoView(pos, { y: "center" }), flashLine.of(v.state.doc.lineAt(pos).from)],
    });
    v.focus();
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      if (view.current === v) v.dispatch({ effects: flashLine.of(null) });
    }, FLASH_MS);
  };

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    jumpTo(line, column = 1) {
      const v = view.current;
      if (!v) return;
      const ln = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
      reveal(v, Math.min(ln.from + Math.max(0, column - 1), ln.to));
    },
    jumpToOffset(offset) {
      const v = view.current;
      if (!v) return;
      reveal(v, Math.max(0, Math.min(offset, v.state.doc.length)));
    },
    applyChanges(changes) {
      view.current?.dispatch({ changes, userEvent: "input.apply" });
    },
    getValue: () => view.current?.state.doc.toString() ?? "",
    acceptProposal() {
      const v = view.current;
      if (!v) return;
      const before = original.current;
      const proposed = endProposal(v);
      if (before === null || proposed === null) return;
      // One history entry: the whole replacement, so a single undo brings the old code back.
      replaceAll(v, proposed, true);
    },
    rejectProposal() {
      if (view.current) endProposal(view.current);
    },
  }));

  // Create once; the parent remounts the editor (key) to switch scripts.
  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      // Hovering a marker in the gutter shows the problem.
      lintGutter({ hoverTime: 150 }),
      flashField,
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      javascript(),
      javascriptLanguage.data.of({ autocomplete: completionSource(() => completionsRef.current) }),
      autocompletion({ activateOnTyping: true, icons: true, maxRenderedOptions: 60 }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
      editorTheme,
      highlightTheme,
      EditorState.tabSize.of(4),
      EditorView.contentAttributes.of({ "aria-label": rest["aria-label"], spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
      locked.current.of(EditorState.readOnly.of(readOnly)),
      merge.current.of([]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !quiet.current && original.current === null) onChangeRef.current?.(u.state.doc.toString());
      }),
    ];
    const v = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions }) });
    view.current = v;
    if (diagnostics?.length) v.dispatch(setDiagnostics(v.state, toLintDiagnostics(diagnostics, v.state.doc.length)));
    if (proposal !== null && proposal !== undefined) startProposal(v, proposal);
    return () => {
      window.clearTimeout(flashTimer.current);
      v.destroy();
      view.current = null;
      original.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Code changed from outside (Discard, load the LWC's code): replace it, undoable.
  useEffect(() => {
    const v = view.current;
    if (!v || original.current !== null) return;
    if (v.state.doc.toString() !== value) dispatchQuiet(v, { changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (original.current === null) v.dispatch({ effects: locked.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    // The problems belong to the code as it is, not to a proposal being previewed.
    v.dispatch(setDiagnostics(v.state, toLintDiagnostics(original.current === null ? (diagnostics ?? []) : [], v.state.doc.length)));
  }, [diagnostics, proposal]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (proposal === null || proposal === undefined) {
      endProposal(v);
    } else if (original.current === null) {
      startProposal(v, proposal);
    } else if (v.state.doc.toString() !== proposal) {
      // A newer proposal replaces the one on screen, still compared with the code as it was.
      endProposal(v);
      startProposal(v, proposal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  return <div ref={host} className={`code-editor${className ? ` ${className}` : ""}`} />;
});

export default CodeEditor;
