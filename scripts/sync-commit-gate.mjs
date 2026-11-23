#!/usr/bin/env node
/**
 * Sync step: decide whether this run's staged sync output is worth a commit
 * on live.
 *
 * Every sync rewrites events-data.json's `lastSync` and each source's
 * `fetchedAt`, so the staged tree differs from live on every run even when no
 * calendar changed — and every push to live is a Pages build. Measured over
 * 2026-11-16..23: 163 of 191 consecutive sync commits differed in those
 * stamps only.
 *
 * The stamps are still read, though: events.js shows each source's age,
 * kiosk.js flags "daten alt", and the Uptime Kuma monitor alerts when the
 * published `lastSync` is older than 6 h. So the hourly workflow_dispatch
 * (our own host, at :17) always commits and sets the cadence of the published
 * freshness. The maximum age of `lastSync` is unchanged, but schedule runs no
 * longer refresh it between two dispatches, so if the dispatches stop
 * entirely it can get up to one heartbeat (50 min) older than before. Only a
 * schedule run (the cron fallback) is gated: it commits on any content change, or when the published `lastSync`
 * is at least a heartbeat old — so the cron still publishes when the
 * dispatches stop. Any other or missing event name commits.
 *
 * Usage (in the live checkout, after `git add`):
 *   decision=$(node sync-commit-gate.mjs <heartbeat-minutes> <event-name>)
 * Prints "commit" or "skip" on stdout and the reason on stderr.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = "events-data.json";

// The fields a sync rewrites on every run without any calendar change.
function withoutStamps(data) {
  const { lastSync, ...rest } = data;
  if (Array.isArray(rest.sources)) {
    rest.sources = rest.sources.map(({ fetchedAt, ...s }) => s);
  }
  return rest;
}

// Whole minutes, rounded down: a skip never reads "50 min old".
const minutesOld = (ms) => (Number.isNaN(ms) ? "unreadable" : `${Math.floor(ms / 60000)} min old`);

/**
 * @param {string[]} changedPaths  staged paths (git diff --cached --name-only)
 * @param {object|null} before     live's events-data.json (HEAD), null if absent
 * @param {object|null} after      the staged events-data.json, null if absent
 * @param {number} heartbeatMs     max age of the published lastSync for a schedule run
 * @param {string} event           github.event_name of the run
 * @returns {{commit: boolean, reason: string}}
 */
export function decide(changedPaths, before, after, heartbeatMs, event) {
  if (changedPaths.length === 0) return { commit: false, reason: "nothing staged" };
  const others = changedPaths.filter((p) => p !== DATA);
  if (others.length > 0) return { commit: true, reason: `content: ${others.join(" ")}` };
  if (!before || !after) return { commit: true, reason: `${DATA} added or removed` };
  if (JSON.stringify(withoutStamps(before)) !== JSON.stringify(withoutStamps(after))) {
    return { commit: true, reason: `content: ${DATA}` };
  }
  if (event !== "schedule") return { commit: true, reason: `event ${event || "(none)"} always publishes` };
  const age = Date.parse(after.lastSync) - Date.parse(before.lastSync);
  // Only a readable stamp in [0, heartbeat) skips; NaN (missing/unparsable)
  // and a published stamp from the future both publish.
  if (!(age >= 0 && age < heartbeatMs)) {
    return { commit: true, reason: `heartbeat: published lastSync is ${minutesOld(age)}` };
  }
  return { commit: false, reason: `stamps only, published lastSync is ${minutesOld(age)}` };
}

function readJSON(spec) {
  try {
    return JSON.parse(execFileSync("git", ["show", spec], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

// realpath on both sides: Node resolves a symlinked main module, path.resolve
// does not, and a missed guard would print nothing and exit 0.
function isMain() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const minutes = Number(process.argv[2]);
  if (!(minutes > 0)) {
    console.error("usage: sync-commit-gate.mjs <heartbeat-minutes> <event-name>");
    process.exit(2);
  }
  const changed = execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const { commit, reason } = decide(changed, readJSON(`HEAD:${DATA}`), readJSON(`:${DATA}`), minutes * 60000, process.argv[3]);
  console.error(`sync-commit-gate: ${commit ? "commit" : "skip"} (${reason})`);
  console.log(commit ? "commit" : "skip");
}
