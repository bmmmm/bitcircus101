#!/usr/bin/env node
/**
 * Deploy step: overlay a git ref (normally origin/main) onto the live checkout
 * while preserving live-only generated files, then strip dev-only files.
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

// Overlay: adds/overwrites everything tracked on <ref>; deliberately does not
// delete files that exist only on live (that is what keeps CI-generated
// artifacts alive) — hence the explicit dev-file removal below.
execFileSync("git", ["checkout", ref, "--", "."], { stdio: "inherit" });

for (const d of REMOVE_DIRS) fs.rmSync(d, { recursive: true, force: true });
for (const f of REMOVE_FILES) fs.rmSync(f, { force: true });

for (const f of saved) {
    fs.mkdirSync(path.dirname(f) || ".", { recursive: true });
    fs.copyFileSync(path.join(stash, f), f);
}
fs.rmSync(stash, { recursive: true, force: true });
console.error(`live-overlay: overlaid ${ref}, restored ${saved.length} files`);
