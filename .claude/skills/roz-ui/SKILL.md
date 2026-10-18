---
name: roz-ui
description: Use for any UI work in the Roz for LSC Electron app (src-renderer/ — chat, Settings, Library, Studio screens, CSS). The app's design conventions, the shared UI primitives, and how to screenshot the running app to check a change before calling it done.
---

# Roz UI conventions

Roz should feel like one native Mac app. Every screen is built from the same few primitives,
sizes and tokens. `test/unit/ui-conventions.test.ts` enforces the mechanical rules. The rest is
judgement: check it by looking at the app (see **Verify** below).

**Exempt:** the simulated iPad (`.studio-ipad-screen`, `Ipad*.tsx`, `screens/`, `assets/`, and the iPad
CSS listed in the test's `IPAD` list). It reproduces LSC Mobile's iOS look and follows
lifesciences-ios, not these rules.

## Use the primitives (`src-renderer/components/ui/`)

| Need | Use |
|---|---|
| Loading / empty / error state of a pane | `<StateView kind="loading\|empty\|error" title detail icon actions layout="fill\|inline" />` |
| Pass / fail / warning at a glance | `<StatusIcon tone="pass\|error\|warning\|info\|unknown\|skipped" />`, or a `.ui-pill <tone>` label |
| Busy indicator | `<Spinner size={…} />` — the only spinner |
| Tabs or a mode switch | `<Segmented>` — never hand-rolled tab buttons |
| Buttons | `.studio-btn` (+ `primary`, `ghost`, `danger`, `sm`, `lg`); icon-only: `.ui-icon-btn` with an `aria-label` |
| Fields | `.ui-field` / `.studio-input` / `.studio-select`, labelled with `.ui-label`; checkbox + label: `.ui-check` |
| Section heading with a count | `.ui-section-title` with a `.count` span: "ORG-WIDE · 6 of 8 passing", never run together |
| View appearing | `ui-enter` on the pane, keyed by view so it fades in on change |

Need something new? Add it to `components/ui/` and `ui.css` so the next screen can reuse it.

## Rules

- **No accent stripes.** No coloured left or top border (or inset box-shadow) on cards, rows,
  callouts or blockquotes. Show tone with a `StatusIcon`, a pill, or a tinted background (`--*-subtle`)
  with a hairline border.
- **Icons:**
  - Use Lucide (`lucide-react`) only, at 14px in buttons and 16px in rows, with `aria-hidden`
    when there's a label beside it.
  - Don't hand-draw `<svg>` icons. Data charts are the only exception (`CHART_SVG` in the test).
  - Don't use characters as icons (✓ ✗ × ▾ ↻ ●).
  - Lucide v1 names: `TriangleAlert`, `CircleAlert`, `CircleQuestionMark` (the old aliases don't exist).
- **Tokens, not literals** (`:root` in `styles.css`):
  - Colour: `--text-*`, `--bg-*`, `--fill-*`, `--border*`, `--accent`, `--success|error|warning(-subtle)`.
    Hex only defines a token. The one allowed literal is `#fff`, for text on the accent.
  - Type: `--font-2xs` (badges only), `--font-xs` 11, `--font-sm` 12, `--font-base` 13 (app chrome),
    `--font-md` 14 (reading), `--font-lg`, `--font-xl`, `--font-2xl` (page titles), `--font-display`,
    `--font-code`. No raw `px` font sizes.
  - Space: the 4pt grid, `--space-1` to `--space-10`.
  - Radius: `--radius`, `--radius-sm`, `--radius-xs`.
  - Motion: `--transition-fast`, `--ease-out`.
- **Sizes:**
  - Controls are `--control-sm` 24, `--control` 28 or `--control-lg` 32px tall.
  - Every pane's top bar is `--toolbar-height` (52px), and is a drag region (`-webkit-app-region: drag`,
    with `no-drag` on its controls), aligned with the traffic lights.
  - Rows in lists and rails are 30px. Long labels end in "…" (`text-overflow: ellipsis`) and don't wrap.
- **Every async view has all three states:** loading (`StateView kind="loading"` or a skeleton,
  never a blank pane), empty (what it is and what to do, with an icon and usually an action),
  and error (the message, plus Retry).
- **Words and colour agree.** A verdict that says "Works, with 5 issues" is amber, not red with a
  green bar. Map tone with `verdictTone()` (`studio/readiness.ts`) rather than ad hoc.
- **Headers survive a narrow window:**
  - Titles keep a readable minimum width (`flex: 1 1 280px; min-width: 0`).
  - Actions wrap below the title, or collapse to icons (`.collapsible` + container query in `studio.css`).
  - Nothing overflows sideways.
- **Dialogs and sheets:**
  - Escape closes them and so does a backdrop click; they pop in with `ui-pop-in`.
  - The primary button is on the right of the footer.
- **Copy:** use sentence case and plain words. Subtitles fit on one line (ellipsis + `title` for the full text).
- **Accessibility:** every icon-only control needs an `aria-label`, and every field a label.
  Use `aria-current` / `aria-selected` for the current item.

## Verify — look at it

Type-checking doesn't show a wrapped header, a mismatched colour or a squashed button. After a UI change:

1. Run `npx vitest run test/unit/ui-conventions.test.ts`. If it fails, fix the code; only widen the
   test's exemptions for genuine iPad simulation or charts.
2. Run `npm run electron:build`, then `node scripts/ui-shots.mjs tour /tmp/roz-shots`. It launches the
   app with its saved connection and org, visits every main screen (chat, Library, Commands, Settings,
   Studio Overview / Check a user / What changed / Sync health / Sign-off / a feature's Readiness and
   board / iPad preview, plus a narrow 960×640 window), and saves PNGs. It also prints renderer console errors.
3. **Read the screenshots for every screen you touched**, including the narrow one. Check alignment,
   wrapping, truncation, spacing, state coverage and colour, against the rules above.
4. To check one state or interaction, use the REPL: `printf 'nav .studio-rail-item::Sync health\nwait 3000\nss sync\nquit\n' | node scripts/ui-shots.mjs repl /tmp/roz-shots`.
   It also takes `click TEXT`, `eval JS`, `size W H` and `errors`.

It needs `playwright-core` (a devDependency) and drives Electron directly, so no browser download is
needed. A dev instance (`npm run electron:dev`) can keep running alongside it.
