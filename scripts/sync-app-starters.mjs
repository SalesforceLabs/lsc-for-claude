// sync-app-starters.mjs — copy the LSC app starters in knowledge/app-starters/manifest.json
// from GitHub into knowledge/app-starters/<id>/lwc/<bundle>/<file>.
//
// Usage: node scripts/sync-app-starters.mjs [--update] [id...]
//
// Each starter names a repo, a pinned commit (`sha`) and the LWC bundles to copy. Without
// --update the files at the pinned commit are fetched again (a no-op when nothing was edited
// by hand); --update moves each starter's `sha` to the tip of its repo's default branch first,
// so a refresh is a reviewable diff. Only the listed bundles' files are written (no tests, no
// jsconfig) and nothing is built or run. Uses `gh auth token` or GITHUB_TOKEN when present;
// the repos are public, so it works without. Paths resolve relative to this file.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const root = new URL("../knowledge/app-starters/", import.meta.url);
const manifestUrl = new URL("manifest.json", root);
const args = process.argv.slice(2);
const update = args.includes("--update");
const only = new Set(args.filter((a) => !a.startsWith("--")));

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
const auth = token();
const headers = { Accept: "application/vnd.github+json", "User-Agent": "lsc-app-starters", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) };

async function api(path) {
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

const SKIP = /(^|\/)(__tests__|jsconfig\.json$|\.eslintrc)/;
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
const trees = new Map();
let failed = false;

for (const starter of manifest.starters) {
  if (only.size && !only.has(starter.id)) continue;
  try {
    if (update) {
      const repo = await api(`repos/${starter.repo}`);
      const head = await api(`repos/${starter.repo}/commits/${repo.default_branch}`);
      if (head.sha !== starter.sha) console.log(`↑ ${starter.id}: ${starter.sha.slice(0, 7)} → ${head.sha.slice(0, 7)}`);
      starter.sha = head.sha;
    }
    const key = `${starter.repo}@${starter.sha}`;
    if (!trees.has(key)) trees.set(key, await api(`repos/${starter.repo}/git/trees/${starter.sha}?recursive=1`));
    const tree = trees.get(key);
    const base = (starter.path ?? "force-app/main/default").replace(/\/$/, "");
    const dir = new URL(`${starter.id}/`, root);
    rmSync(dir, { recursive: true, force: true });
    let count = 0;
    for (const bundle of starter.bundles) {
      const prefix = `${base}/lwc/${bundle}/`;
      const files = tree.tree.filter((t) => t.type === "blob" && t.path.startsWith(prefix) && !SKIP.test(t.path.slice(prefix.length)));
      if (!files.length) throw new Error(`no files for bundle ${bundle} under ${prefix}`);
      for (const f of files) {
        const file = f.path.slice(prefix.length);
        if (!SAFE_NAME.test(file)) throw new Error(`unexpected file name ${f.path}`);
        const res = await fetch(`https://raw.githubusercontent.com/${starter.repo}/${starter.sha}/${f.path}`, { headers: { "User-Agent": "lsc-app-starters" } });
        if (!res.ok) throw new Error(`${f.path}: ${res.status}`);
        mkdirSync(new URL(`lwc/${bundle}/`, dir), { recursive: true });
        writeFileSync(new URL(`lwc/${bundle}/${file}`, dir), await res.text());
        count++;
      }
    }
    console.log(`✓ ${starter.id}: ${count} files from ${starter.repo}@${starter.sha.slice(0, 7)}`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${starter.id}: ${e.message}`);
  }
}

if (update) writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + "\n");
if (failed) process.exit(1);
