import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * The editor's look, read from the app's CSS tokens through `var()`, so it follows the light and dark palettes
 * without a re-render. Structural styling that doesn't need the editor's own class names lives in code-editor.css.
 */
export const editorTheme: Extension = EditorView.theme({
  "&": {
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-field)",
    fontSize: "var(--font-code)",
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--text-primary)", padding: "var(--space-2) 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-primary)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "var(--fill-hover)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-muted)",
    border: "none",
  },
  ".cm-activeLineGutter": { backgroundColor: "var(--fill-hover)", color: "var(--text-secondary)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 var(--space-2) 0 var(--space-3)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--fill-control)",
    border: "none",
    color: "var(--text-secondary)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)",
    outline: "none",
  },
  ".cm-nonmatchingBracket": { backgroundColor: "var(--error-subtle)" },
  ".cm-searchMatch": { backgroundColor: "var(--warning-subtle)", outline: "1px solid var(--warning)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warning) 30%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "var(--fill-active)" },
  ".cm-tooltip": {
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-xs)",
    boxShadow: "var(--shadow-popover)",
    fontFamily: "inherit",
    fontSize: "var(--font-sm)",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "var(--font-code)", maxHeight: "260px" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "var(--space-1) var(--space-2)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-glow)",
    color: "var(--text-primary)",
  },
  ".cm-completionDetail": { color: "var(--text-muted)", fontStyle: "normal", marginLeft: "var(--space-2)" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--accent)", fontWeight: "600" },
  ".cm-completionInfo": { padding: "var(--space-2) var(--space-3)", maxWidth: "320px", whiteSpace: "normal" },
  ".cm-diagnostic": { padding: "var(--space-2) var(--space-3)", borderLeft: "none" },
  ".cm-panels": { backgroundColor: "var(--bg-elevated)", color: "var(--text-primary)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
});

/** Token colours from the `--syn-*` tokens. */
export const highlightTheme: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: "var(--syn-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syn-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-function)" },
    { tag: [t.propertyName], color: "var(--syn-property)" },
    { tag: [t.className, t.typeName, t.definition(t.typeName)], color: "var(--syn-type)" },
    { tag: [t.operator, t.punctuation, t.bracket], color: "var(--syn-operator)" },
  ])
);
