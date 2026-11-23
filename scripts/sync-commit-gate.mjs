#!/usr/bin/env node
/**
 * Sync step: decide whether this run's staged sync output is worth a commit
 * on live.
 *
 * Every sync rewrites events-data.json's `lastSync` and each source's
 * `fetchedAt`, so the staged tree differs from live on every run even when no
 * calendar changed — and every push to live is a Pages build. Measured over
 * 2026-11-16..23: 175 of 191 sync commits touched nothing but those stamps.
 *
 * The stamps are still read, though: events.js shows each source's age,
 * kiosk.js flags "daten alt", and the Uptime Kuma monitor alerts when the
 * published `lastSync` is older than 6 h. So a stamp-only run is skipped only
 * while the published stamp is younger than the heartbeat; past it, the run
 * commits anyway and the published freshness moves on.
 *
 * Usage (in the live checkout, after `git add`):
 *   decision=$(node sync-commit-gate.mjs <heartbeat-minutes>)
 * Prints "commit" or "skip" on stdout and the reason on stderr.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
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

/**
 * @param {string[]} changedPaths  staged paths (git diff --cached --name-only)
 * @param {object|null} before     live's events-data.json (HEAD), null if absent
 * @param {object|null} after      the staged events-data.json, null if absent
 * @param {number} heartbeatMs     max age of the published lastSync
 * @returns {{commit: boolean, reason: string}}
 */
export function decide(changedPaths, before, after, heartbeatMs) {
  if (changedPaths.length === 0) return { commit: false, reason: "nothing staged" };
  const others = changedPaths.filter((p) => p !== DATA);
  if (others.length > 0) return { commit: true, reason: `content: ${others.join(" ")}` };
  if (!before || !after) return { commit: true, reason: `${DATA} added or removed` };
  if (JSON.stringify(withoutStamps(before)) !== JSON.stringify(withoutStamps(after))) {
    return { commit: true, reason: `content: ${DATA}` };
  }
  const age = Date.parse(after.lastSync) - Date.parse(before.lastSync);
  // NaN (a missing or unparsable stamp) fails the comparison: publish then.
  if (!(age < heartbeatMs)) {
    return { commit: true, reason: `heartbeat: published lastSync is ${Math.round(age / 60000)} min old` };
  }
  return { commit: false, reason: `stamps only, published lastSync is ${Math.round(age / 60000)} min old` };
}

function readJSON(spec) {
  try {
    return JSON.parse(execFileSync("git", ["show", spec], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const minutes = Number(process.argv[2]);
  if (!(minutes > 0)) {
    console.error("usage: sync-commit-gate.mjs <heartbeat-minutes>");
    process.exit(2);
  }
  const changed = execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const { commit, reason } = decide(changed, readJSON(`HEAD:${DATA}`), readJSON(`:${DATA}`), minutes * 60000);
  console.error(`sync-commit-gate: ${commit ? "commit" : "skip"} (${reason})`);
  console.log(commit ? "commit" : "skip");
}
