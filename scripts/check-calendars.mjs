#!/usr/bin/env node
/**
 * check-calendars.mjs — guard rails for the calendar source manifest.
 *
 * Adding a calendar is a two-step move (drop a JSON file under calendars/, list it
 * in calendars/config.json). Both steps fail silently on their own: an unlisted file
 * is simply never read, and a misspelled key is either skipped with a log line nobody
 * reads or — worse — ignored while the sync happily produces wrong output. This script
 * turns both into visible failures.
 *
 * Two modes, neither of which writes a single file:
 *
 *   node scripts/check-calendars.mjs              offline: validate the manifest + every source
 *   node scripts/check-calendars.mjs --probe URL  network: fetch a URL, show what it yields,
 *                                                 print a ready-to-paste source snippet
 *   node scripts/check-calendars.mjs --probe      network: probe every configured source
 *
 * Exit code is 1 when validation found errors (CI gate), 0 otherwise — warnings alone
 * never fail the build.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import ICSCore from "../ics-core.js";
import { CAL_DIR, CAL_CONFIG_FILE, toCards } from "./sync-events.mjs";

const { parseICS } = ICSCore;

// Keys sync-events.mjs actually reads, plus `_`-prefixed comment keys (see the
// `_comment` in config.json and `_note` in the external sources). Anything else is a
// typo — `icsUrl`, `categoryAllowed`, `taggs` — and must not pass silently.
const KNOWN_KEYS = new Set([
  "id", "name", "ics", "url", "type", "rss", "tags", "cap", "eventUrl", "filter",
]);
const KNOWN_TYPES = new Set(["ics-full", "ics-single", "ics-filtered"]);
const KNOWN_FILTER_KEYS = new Set([
  "categoryAllow", "categoryDeny", "titleAllow", "titleDeny",
]);

/** Every *.json under dir (recursively), as paths relative to dir. */
function listJsonFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...listJsonFiles(full, `${prefix}${entry}/`));
    else if (entry.endsWith(".json")) out.push(`${prefix}${entry}`);
  }
  return out;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim());
}

/**
 * Validate one source file's parsed contents. Pushes into the shared errors/warnings
 * arrays, prefixing every message with the file it came from.
 */
function validateSource(entry, path, errors, warnings) {
  const at = (msg) => `${path}: ${msg}`;

  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(at("not a JSON object"));
    return;
  }

  for (const key of Object.keys(entry)) {
    if (key.startsWith("_")) continue; // free-form comment key
    if (!KNOWN_KEYS.has(key)) {
      errors.push(at(`unknown key "${key}" — sync-events.mjs never reads it (typo?)`));
    }
  }

  // id / name / ics are load-bearing: `id` keys the parser warnings, `name` keys the
  // icsKeys map, the RSS source filter and the stale-cache lookup, `ics` is the fetch.
  for (const key of ["id", "name", "ics"]) {
    if (typeof entry[key] !== "string" || !entry[key].trim()) {
      errors.push(at(`missing or empty "${key}"`));
    }
  }
  if (typeof entry.id === "string" && !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) {
    errors.push(at(`"id" must be lowercase kebab-case, got "${entry.id}"`));
  }
  for (const key of ["ics", "url", "eventUrl"]) {
    const v = entry[key];
    if (v === undefined) continue;
    if (typeof v !== "string" || !/^https?:\/\//.test(v)) {
      errors.push(at(`"${key}" must be an http(s) URL, got ${JSON.stringify(v)}`));
    }
  }

  if (entry.type !== undefined && !KNOWN_TYPES.has(entry.type)) {
    errors.push(
      at(`unknown "type": ${JSON.stringify(entry.type)} — expected one of ${[...KNOWN_TYPES].join(", ")}`)
    );
  }
  if (entry.rss !== undefined && typeof entry.rss !== "boolean") {
    errors.push(at('"rss" must be true or false'));
  }
  if (entry.cap !== undefined && (!Number.isInteger(entry.cap) || entry.cap < 1)) {
    errors.push(at('"cap" must be a positive integer'));
  }
  if (entry.tags !== undefined) {
    if (!isStringArray(entry.tags)) errors.push(at('"tags" must be an array of strings'));
    else {
      const bad = entry.tags.filter((t) => !t.startsWith("#"));
      if (bad.length) errors.push(at(`"tags" entries must start with "#": ${bad.join(", ")}`));
    }
  }

  if (entry.filter !== undefined) {
    if (entry.filter === null || typeof entry.filter !== "object" || Array.isArray(entry.filter)) {
      errors.push(at('"filter" must be an object'));
    } else {
      for (const [key, val] of Object.entries(entry.filter)) {
        if (!KNOWN_FILTER_KEYS.has(key)) {
          errors.push(
            at(`unknown filter key "${key}" — expected one of ${[...KNOWN_FILTER_KEYS].join(", ")}`)
          );
        } else if (!isStringArray(val)) {
          errors.push(at(`filter.${key} must be a non-empty array of strings`));
        }
      }
      // The filter is applied for any type (see processSource), but declaring the type
      // is what tells the next reader why this source has one.
      if (entry.type !== "ics-filtered") {
        warnings.push(at('has "filter" but type is not "ics-filtered" — declare the type'));
      }
    }
  }
}

/**
 * Validate a calendars/ directory without touching the network. Returns
 * { errors, warnings, sources } — pure, so tests can point it at a fixture dir.
 */
export function validateCalendars(dir = CAL_DIR) {
  const errors = [];
  const warnings = [];
  const sources = [];
  const configPath = `${dir}/${CAL_CONFIG_FILE}`;

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    errors.push(`${configPath}: ${e.message}`);
    return { errors, warnings, sources };
  }

  if (!Array.isArray(config?.sources)) {
    errors.push(`${configPath}: "sources" must be an array`);
    return { errors, warnings, sources };
  }
  if (!config.sources.length) {
    warnings.push(`${configPath}: "sources" is empty — the sync would produce no events`);
  }

  const listed = new Set();
  for (const rel of config.sources) {
    if (typeof rel !== "string" || !rel.trim()) {
      errors.push(`${configPath}: source entries must be non-empty strings`);
      continue;
    }
    if (listed.has(rel)) {
      errors.push(`${configPath}: "${rel}" is listed twice`);
      continue;
    }
    listed.add(rel);

    const path = `${dir}/${rel}`;
    let entry;
    try {
      entry = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      errors.push(
        e.code === "ENOENT"
          ? `${configPath}: lists "${rel}" but ${path} does not exist`
          : `${path}: ${e.message}`
      );
      continue;
    }
    validateSource(entry, path, errors, warnings);
    sources.push({ rel, path, entry });
  }

  // Collisions. `id` keys log output; `name` keys the icsKeys map, the RSS filter and
  // the stale-cache lookup — two sources sharing a name silently cross-contaminate.
  for (const key of ["id", "name"]) {
    const seen = new Map();
    for (const s of sources) {
      const v = s.entry?.[key];
      if (typeof v !== "string" || !v.trim()) continue;
      if (seen.has(v)) errors.push(`duplicate "${key}": ${JSON.stringify(v)} in ${seen.get(v)} and ${s.rel}`);
      else seen.set(v, s.rel);
    }
  }

  // Orphans: a file that exists but is not listed. Parking a source by removing its
  // manifest line is a documented feature, so this is a warning — but an unnoticed
  // orphan is exactly how "I added the calendar and nothing happened" happens.
  for (const rel of listJsonFiles(dir)) {
    if (rel === CAL_CONFIG_FILE || listed.has(rel)) continue;
    warnings.push(
      `${dir}/${rel} exists but is not listed in ${configPath} — it is NOT synced. ` +
        `Add "${rel}" to "sources", or delete the file if it is meant to stay off.`
    );
  }

  return { errors, warnings, sources };
}

// ── Probe mode ───────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 15000;

// Second-level labels that carry no identity of their own, so the suggested id steps
// one label further left (example.co.uk → example, not co).
const GENERIC_SLD = new Set(["co", "com", "org", "net", "ac", "gov"]);

/**
 * Slug for a suggested source id, from the label before the TLD — the part that
 * actually names the org (cloud.datenb.org → datenb, nc.6bm.de → 6bm), not the
 * hosting subdomain. Only a starting point; the maintainer edits it.
 */
export function suggestId(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    // A bare IP (or a bracketed IPv6 host) names no org — "0" out of 127.0.0.1 is
    // a worse starting point than an obvious placeholder.
    if (/^[\d.]+$/.test(host) || host.startsWith("[")) return "new-source";
    const labels = host.split(".");
    if (labels.length < 2) return labels[0] || "new-source";
    let i = labels.length - 2; // label before the TLD
    if (i > 0 && GENERIC_SLD.has(labels[i])) i--;
    return labels[i].replace(/[^a-z0-9-]/g, "-") || "new-source";
  } catch {
    return "new-source";
  }
}

/** One card as a preview line: what the events page would actually show. */
function fmtCard(c) {
  const when = `${c.date} ${(c.time || "all-day").padEnd(7)}`;
  const where = c.location ? `  @ ${c.location.slice(0, 34)}` : "";
  const tags = c.tags?.length ? `  ${c.tags.join(" ")}` : "";
  return `  ${when} ${c.title}${where}${tags}`;
}

/**
 * Fetch one ICS URL and print the cards the sync would build from it — via the real
 * toCards(), not a lookalike, so the preview cannot drift from the sync (it applies
 * the same past/internal filtering, the same cap and the same tag rules). Writes
 * nothing. Returns true on success so the CLI can set an exit code.
 */
async function probe(url, label, cal) {
  console.log(`\n→ ${label || url}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  let text;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      console.log(`  FAILED: HTTP ${res.status} ${res.statusText}`);
      return false;
    }
    text = await res.text();
  } catch (err) {
    console.log(`  FAILED: ${err.name === "AbortError" ? `timeout after ${PROBE_TIMEOUT_MS}ms` : err.message}`);
    return false;
  } finally {
    clearTimeout(t);
  }

  if (!/BEGIN:VCALENDAR/i.test(text)) {
    console.log(`  FAILED: ${text.length} bytes, but no BEGIN:VCALENDAR — not an ICS feed?`);
    console.log(`  first line: ${text.split("\n")[0].slice(0, 80)}`);
    return false;
  }

  const events = parseICS(text, label || "probe");
  // The real card builder, with a stand-in source config. cal.type matters: the two
  // external types make toCards fall back to cal.url for a card's link.
  const cards = toCards(events, cal ?? { id: "probe", name: "probe" });

  console.log(`  ${text.length} bytes · ${events.length} VEVENT entries · ${cards.length} cards`);
  if (events.length && !cards.length) {
    console.log("  (nothing upcoming — the sync would add no cards from this source)");
  }
  for (const c of cards.slice(0, 8)) console.log(fmtCard(c));
  if (cards.length > 8) console.log(`  … and ${cards.length - 8} more`);
  // toCards drops past events and internal/blocker entries. Naming the gap keeps the
  // count honest — otherwise "12 entries, 3 cards" reads like something broke.
  if (events.length > cards.length) {
    console.log(`  (${events.length - cards.length} entries dropped: past, internal/blocker, or over the cap)`);
  }

  const withUid = cards.filter((c) => c.uid).length;
  if (cards.length && withUid < cards.length) {
    console.log(`  note: ${cards.length - withUid}/${cards.length} cards carry no UID — cross-source dedupe falls back to title+slot`);
  }
  if (cards.length && !cards.some((c) => c.eventUrl)) {
    console.log('  note: no event carries its own URL — set "eventUrl" (or "url") so cards can link somewhere');
  }
  return true;
}

/** The JSON snippet a maintainer pastes into calendars/ after a successful probe. */
function printSnippet(url) {
  const id = suggestId(url);
  const snippet = {
    id,
    name: "TODO: display name shown on the card",
    ics: url,
    url: "TODO: human-facing page for this calendar",
    rss: false,
  };
  console.log(`\nPaste into calendars/${id}.json:\n`);
  console.log(JSON.stringify(snippet, null, 2));
  console.log(`\nThen add "${id}.json" to "sources" in ${CAL_DIR}/${CAL_CONFIG_FILE} and re-run:`);
  console.log("  pnpm run check:calendars\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const probeIdx = argv.indexOf("--probe");

  if (probeIdx !== -1) {
    const url = argv[probeIdx + 1];
    if (url && !url.startsWith("--")) {
      const ok = await probe(url, null, null);
      if (ok) printSnippet(url);
      process.exit(ok ? 0 : 1);
    }
    // No URL given: health-check every source the manifest already lists.
    const { sources, errors } = validateCalendars();
    if (errors.length) {
      console.error("Manifest has errors — fix them before probing:");
      for (const e of errors) console.error(`  ERROR  ${e}`);
      process.exit(1);
    }
    let failed = 0;
    for (const s of sources) {
      if (!(await probe(s.entry.ics, `${s.entry.id} (${s.rel})`, s.entry))) failed++;
    }
    console.log(`\n${sources.length - failed}/${sources.length} sources reachable`);
    process.exit(failed ? 1 : 0);
  }

  const { errors, warnings, sources } = validateCalendars();
  // On a runner, emit workflow commands so warnings surface in the PR UI instead of
  // scrolling past in the log — an orphan file nobody sees is the bug we are fixing.
  const ci = !!process.env.GITHUB_ACTIONS;
  for (const w of warnings) console.log(ci ? `::warning::${w}` : `WARN   ${w}`);
  for (const e of errors) console.error(ci ? `::error::${e}` : `ERROR  ${e}`);

  if (errors.length) {
    console.error(`\n${errors.length} error(s) in ${CAL_DIR}/ — the sync would misbehave.`);
    process.exit(1);
  }
  console.log(
    `\nOK: ${sources.length} calendar source(s) valid` +
      (warnings.length ? `, ${warnings.length} warning(s)` : "") + "."
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
