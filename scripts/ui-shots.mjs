#!/usr/bin/env node
// Drive Roz for LSC (the Electron app) and screenshot it, to look at UI changes.
//
//   node scripts/ui-shots.mjs [tour] [outDir]   fixed tour of every main screen (default /tmp/roz-shots)
//   node scripts/ui-shots.mjs repl [outDir]     commands on stdin, one per line:
//       ss NAME | click TEXT | nav SELECTOR::TEXT | eval JS | size W H | wait MS | quit
//
// Build first (npm run electron:build). The app starts with its saved connection and target org,
// so Studio screens show real data; pages that need an org show their empty state without one.
// ROZ_SHOTS_THEME=light|dark shows that palette for the run without changing the saved appearance.
// For repl from a non-interactive shell, feed it a regular file through tail -f (a fifo hits EOF
// after each write):  : > /tmp/roz-in; tail -f /tmp/roz-in | node scripts/ui-shots.mjs repl > out.log &
import { _electron } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [mode = "tour", outDir = "/tmp/roz-shots"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(path.join(ROOT, "dist-electron", "main.js"))) {
  console.error("dist-electron/main.js is missing — run npm run electron:build first");
  process.exit(1);
}

const electronBin = (await import("electron")).default;
const app = await _electron.launch({ executablePath: electronBin, args: [path.join(ROOT, "dist-electron", "main.js")], cwd: ROOT, timeout: 60_000 });
const page = await app.firstWindow();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h]);
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log("shot", path.join(outDir, `${name}.png`));
};
/** Click the first element matching `selector` that contains `text`. */
const nav = (selector, text) => page.locator(selector, { hasText: text }).first().click({ timeout: 8000 });
/** Wait until no loading state is showing (or `ms` passes), then let transitions finish. */
const settle = async (ms = 60_000) => {
  await page.waitForFunction(() => !document.querySelector(".ui-state.loading, .studio-ipad-loading"), null, { timeout: ms }).catch(() => console.log("  (still loading after", ms / 1000, "s)"));
  await page.waitForTimeout(500);
};
const step = async (name, run) => {
  try {
    await run();
    await settle();
    await shot(name);
  } catch (e) {
    console.log("SKIP", name, "—", e.message.split("\n")[0]);
  }
};

// Playwright emulates a light prefers-color-scheme by default; turn that off so the app's own appearance shows.
await page.emulateMedia({ colorScheme: null });
const theme = process.env.ROZ_SHOTS_THEME;
if (theme) await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, theme);
await size(1440, 900);
await page.waitForTimeout(5000);

if (mode === "tour") {
  await step("01-chat-home", async () => {});
  await step("02-library", () => nav(".sidebar-nav-item", "Library"));
  await step("03-commands", () => nav(".sidebar-nav-item", "Commands"));
  await page.keyboard.press("Escape");
  await step("04-settings", () => page.locator(".status-bar-settings").click());
  await page.keyboard.press("Escape");
  await step("05-studio-overview", async () => {
    await nav(".sidebar-nav-item", "Studio");
    await nav(".studio-rail-item", "Overview");
  });
  await step("06-check-a-user", () => nav(".studio-rail-item", "Check a user"));
  await step("07-what-changed", () => nav(".studio-rail-item", "What changed"));
  await step("08-sync-health", () => nav(".studio-rail-item", "Sync health"));
  await step("09-check-a-rep", () => nav(".studio-rail-item", "Check a rep's sync"));
  await step("09-test-plans", () => nav(".studio-rail-item", "Test plans"));
  await step("09-first-sync", () => nav(".studio-rail-item", "First sync"));
  await step("10-feature-readiness", () => nav(".studio-rail-item:not([disabled])", "Visit"));
  await step("11-feature-board", () => nav(".ui-segmented button", "All configuration"));
  await step("12-ipad-preview", () => nav(".studio-rail-item", "Preview"));
  await step("13-narrow-overview", async () => {
    await size(960, 640);
    await nav(".studio-rail-item", "Overview");
  });
  await size(1440, 900);
  console.log(errors.length ? `renderer errors:\n  ${[...new Set(errors)].join("\n  ")}` : "no renderer errors");
  await app.close();
  process.exit(0);
}

console.log("READY");
for await (const line of readline.createInterface({ input: process.stdin })) {
  const [cmd, ...rest] = line.trim().split(" ");
  const arg = rest.join(" ");
  try {
    if (cmd === "ss") await shot(arg);
    else if (cmd === "click") await page.getByText(arg).first().click({ timeout: 8000 });
    else if (cmd === "nav") await nav(...arg.split("::"));
    else if (cmd === "eval") console.log(JSON.stringify(await page.evaluate(arg))?.slice(0, 4000));
    else if (cmd === "size") await size(+rest[0], +rest[1]);
    else if (cmd === "wait") await page.waitForTimeout(+arg);
    else if (cmd === "errors") console.log(JSON.stringify(errors));
    else if (cmd === "quit") break;
    if (cmd && cmd !== "eval" && cmd !== "errors") console.log("ok", line);
  } catch (e) {
    console.log("ERR", line, "—", e.message.split("\n")[0]);
  }
}
await app.close();
process.exit(0);
