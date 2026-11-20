#!/usr/bin/env node
// Writes dist-electron/build-config.json from the build's environment, read by
// src-electron/build-config.ts. Release builds set LSC_MOBILE_CLIENT_ID from a
// GitHub secret; without it the file is {} and Roz falls back to Settings.
// Run after `tsc -p tsconfig.electron.json` (part of `npm run electron:build`).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-electron", "build-config.json");

const config = {};
const mobileClientId = process.env.LSC_MOBILE_CLIENT_ID?.trim();
if (mobileClientId) config.mobileClientId = mobileClientId;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(config) + "\n");
console.log(`build-config.json: mobile consumer key ${mobileClientId ? "included" : "not set"}`);
