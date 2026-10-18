#!/usr/bin/env node
/**
 * Runs Electron for `npm run electron:dev` and restarts it when the main
 * process is rebuilt (dist-electron/) or the preload script changes. The
 * renderer has Vite HMR, and the main process respawns the MCP server on
 * dist/ changes itself, so neither needs a restart here.
 *
 * Closing the app window ends the script, which stops the other dev processes.
 */

import { spawn } from "child_process";
import { watch } from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron");

let child = null;
let restarting = false;

function launch() {
  child = spawn(electron, [path.join(root, "dist-electron", "main.js")], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => {
    if (restarting) {
      restarting = false;
      launch();
    } else {
      process.exit(code ?? 0);
    }
  });
}

let timer = null;
function onChange(_event, file) {
  if (!file || !/\.(c?js)$/.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`[dev-electron] ${file} changed — restarting Electron`);
    restarting = true;
    child.kill();
  }, 400);
}

watch(path.join(root, "dist-electron"), { recursive: true }, onChange);
// Watch the directory, not the file — editors that save by replacing the file break a file watch.
watch(path.join(root, "src-electron"), (event, file) => file === "preload.cjs" && onChange(event, file));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    restarting = false;
    child?.kill();
    process.exit(0);
  });
}

launch();
