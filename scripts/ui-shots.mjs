#!/usr/bin/env node
// Drive Roz for LSC (the Electron app) and screenshot it, to look at UI changes.
//
//   node scripts/ui-shots.mjs [tour] [outDir]   fixed tour of every main screen (default /tmp/roz-shots)
//   node scripts/ui-shots.mjs repl [outDir]     commands on stdin, one per line:
//       ss NAME | click TEXT | nav SELECTOR::TEXT | eval JS | size W H | wait MS | type TEXT | press KEY | quit
//       main JS   (runs JS in the main process as (electron) => …; e.g. send an IPC event to the window)
//       down SELECTOR [FRAC] | move SELECTOR [FRAC] | up   (press, drag to, release; FRAC = how far down the element)
//
// Build first (npm run electron:build). The app starts with its saved connection and target org,
// so Studio screens show real data; pages that need an org show their empty state without one.
// ROZ_SHOTS_THEME=light|dark shows that palette for the run without changing the saved appearance.
// ROZ_SHOTS_USER_DATA=DIR runs with that user-data folder (settings.json is copied in from the default one on first use),
// so a Roz you are running yourself is left alone.
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
const userData = process.env.ROZ_SHOTS_USER_DATA;
const launchArgs = [path.join(ROOT, "dist-electron", "main.js")];
if (userData) {
  fs.mkdirSync(userData, { recursive: true });
  const saved = path.join(process.env.HOME ?? "", "Library", "Application Support", "Electron", "settings.json");
  if (fs.existsSync(saved) && !fs.existsSync(path.join(userData, "settings.json"))) fs.copyFileSync(saved, path.join(userData, "settings.json"));
  launchArgs.push(`--user-data-dir=${userData}`);
}
const app = await _electron.launch({ executablePath: electronBin, args: launchArgs, cwd: ROOT, timeout: 60_000 });
// ROZ_SHOTS_MAIN_LOG=1 echoes the main process's output, e.g. to see why the app quit mid-run.
if (process.env.ROZ_SHOTS_MAIN_LOG) {
  app.process().stdout?.on("data", (d) => process.stderr.write(`[main] ${d}`));
  app.process().stderr?.on("data", (d) => process.stderr.write(`[main] ${d}`));
}
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
  await step("07b-custom-scripts", () => nav(".studio-rail-item", "Custom scripts"));
  await step("07c-script-details", () => nav(".ui-segmented button", "Details"));
  // The library's button, or the empty state's when the org has no scripts (Details is skipped then).
  await step("07d-new-script", () => nav(".scripts-page:not([hidden]) button", "New script"));
  await page.keyboard.press("Escape");
  await step("08-sync-health", () => nav(".studio-rail-item", "Sync health"));
  await step("09-rep-sync", async () => {
    // The first "Investigate" in Sync health's list, when the org has telemetry.
    await nav(".studio-rail-item", "Sync health");
    await page.waitForTimeout(3000);
    const investigate = page.locator("button", { hasText: "Investigate" }).first();
    if (await investigate.count()) await investigate.click();
    await page.waitForTimeout(20000);
  });
  await step("09-test-plans", () => nav(".studio-rail-item", "Test plans"));
  await step("09-first-sync", () => nav(".studio-rail-item", "First sync"));
  await step("10-feature-readiness", () => nav(".studio-rail-item:not([disabled])", "Visit"));
  await step("11-feature-board", () => nav(".ui-segmented button", "All configuration"));
  await step("12-ipad-preview", () => nav(".studio-rail-item", "Preview"));
  await step("13-narrow-overview", async () => {
    await size(960, 640);
    await nav(".studio-rail-item", "Overview");
  });
  await step("13b-narrow-scripts", () => nav(".studio-rail-item", "Custom scripts"));
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
    else if (cmd === "main") console.log(JSON.stringify(await app.evaluate(new Function("electron", `return (${arg})(electron)`)))?.slice(0, 4000));
    else if (cmd === "size") await size(+rest[0], +rest[1]);
    else if (cmd === "wait") await page.waitForTimeout(+arg);
    else if (cmd === "type") await page.keyboard.type(arg);
    else if (cmd === "press") await page.keyboard.press(arg);
    else if (cmd === "errors") console.log(JSON.stringify(errors));
    else if (cmd === "down" || cmd === "move") {
      // down SELECTOR / move SELECTOR [fraction of its height]: press on, or drag to, an element.
      const frac = rest.length > 1 && /^[\d.]+$/.test(rest.at(-1)) ? +rest.pop() : 0.5;
      const sel = rest.join(" ");
      const box = await page.locator(sel).first().boundingBox();
      if (!box) throw new Error(`nothing matches ${sel}`);
      const y = box.y + box.height * frac;
      if (cmd === "down") {
        await page.mouse.move(box.x + box.width / 2, y);
        await page.mouse.down();
      } else await page.mouse.move(box.x + box.width / 2, y, { steps: 12 });
    } else if (cmd === "up") await page.mouse.up();
    else if (cmd === "quit") break;
    if (cmd && cmd !== "eval" && cmd !== "main" && cmd !== "errors") console.log("ok", line);
  } catch (e) {
    console.log("ERR", line, "—", e.message.split("\n")[0]);
  }
}
await app.close();
process.exit(0);
