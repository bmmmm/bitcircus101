#!/usr/bin/env node
/**
 * Deploy step: overlay a git ref (normally origin/main) onto the live checkout
 * while preserving live-only generated files, strip dev-only files, then
 * prune anything left over from a previous deploy that is no longer tracked
 * on <ref> (e.g. a page deleted from main) so live doesn't accumulate dead
 * files forever.
 *
 * Extracted from .github/workflows/deploy.yml so the logic is runnable and
 * testable locally (tests/deploy-scripts.spec.mjs) — the inline-bash version
 * twice hit the `bash -e` for-loop exit-status trap (d558e5a, 12d10d0's
 * sibling fix). Node has no such trap: missing files are simply skipped.
 *
 * Usage: node scripts/live-overlay.mjs <git-ref>
 * Caller is responsible for fetching the ref first (git fetch origin main).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Live-only generated files (calendar sync / sitemap / funding workflows own
// these on the live branch). Tracked seeds coming from main must not clobber
// them, so they are stashed across the overlay. Missing entries are normal:
// on a first deploy none of them exist yet.
const FEEDS = [
    "events-data.json",
    "feed.xml",
    "ical.ics",
    "funding.json",
    "sitemap.xml",
    "events/feed.xml",
    "events/ical.ics",
];

// Dev-only content that must never reach the served site.
const REMOVE_DIRS = ["tests", "node_modules", ".claude"];
const REMOVE_FILES = [
    "playwright.config.js",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    // Contributor docs + repo meta are not part of the served site
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "README.md",
    ".gitignore",
    ".claudeignore",
];

const ref = process.argv[2];
if (!ref) {
    console.error("usage: node scripts/live-overlay.mjs <git-ref>   e.g. origin/main");
    process.exit(1);
}

const stash = fs.mkdtempSync(path.join(os.tmpdir(), "live-feeds-"));
const saved = [];
for (const f of FEEDS) {
    if (!fs.existsSync(f)) continue;
    const dst = path.join(stash, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(f, dst);
    saved.push(f);
}
console.error(`live-overlay: saved ${saved.length}/${FEEDS.length} live-only files`);

// Overlay: adds/overwrites everything tracked on <ref>. `git checkout <ref>
// -- .` never deletes paths that are absent from <ref> on its own, which is
// exactly what keeps CI-generated artifacts alive across deploys — but it
// also means a page removed from main used to stay live forever. The prune
// step below (after dev-file removal + feed restore) closes that gap.
execFileSync("git", ["checkout", ref, "--", "."], { stdio: "inherit" });

for (const d of REMOVE_DIRS) fs.rmSync(d, { recursive: true, force: true });
for (const f of REMOVE_FILES) fs.rmSync(f, { force: true });

for (const f of saved) {
    fs.mkdirSync(path.dirname(f) || ".", { recursive: true });
    fs.copyFileSync(path.join(stash, f), f);
}
fs.rmSync(stash, { recursive: true, force: true });
console.error(`live-overlay: overlaid ${ref}, restored ${saved.length} files`);

// Prune stale live-only files: anything still tracked from a previous deploy
// that is neither on <ref> anymore nor a CI-owned feed. This is what let
// e.g. goals.html (deleted from main) keep serving on live indefinitely.
const refFiles = new Set(
    execFileSync("git", ["ls-tree", "-r", "--name-only", ref], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean),
);
const feedSet = new Set(FEEDS);
const liveFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

let pruned = 0;
for (const f of liveFiles) {
    if (refFiles.has(f) || feedSet.has(f)) continue;
    fs.rmSync(f, { force: true });
    pruned++;

    // Walk up and remove now-empty parent directories.
    let dir = path.dirname(f);
    while (dir && dir !== ".") {
        if (!fs.existsSync(dir) || fs.readdirSync(dir).length > 0) break;
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
    }
}
console.error(`live-overlay: pruned ${pruned} stale live-only file(s)`);
