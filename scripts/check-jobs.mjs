#!/usr/bin/env node
/**
 * check-jobs.mjs — offline gate for jobs.json, the job board behind
 * pinnwand.html. Runs in both ci.yml twins AND in deploy.yml: a commit pushed
 * straight to main never sees the PR gate, and an invalid jobs.json would leave
 * the page showing its error state to every visitor.
 *
 * No dependencies, no network, no install step — the PR gate has no
 * `pnpm install`, so this file may only use node builtins and the repo's own
 * modules. The shared predicates come from finanz-core.js via createRequire (the
 * idiom finanz-data.mjs uses); they live there for historic reasons and moving
 * them into a neutral module is a follow-up, not this PR's job. The expiry math
 * comes from jobs-core.js, the same file the browser renderer loads, so the gate
 * and the page can never disagree about when a posting comes down.
 *
 * The small check* helpers below are COPIED from scripts/finanz-data.mjs rather
 * than imported: they are not exported there, and exporting them would couple
 * two independent gates — a change made for the funding board would silently
 * change what the job board accepts.
 *
 * Errors exit 1. Expiry is only a WARNING: an expired posting is a housekeeping
 * task, and turning it into an error would break every deploy on the day one
 * runs out.
 *
 * Usage: node scripts/check-jobs.mjs [path/to/jobs.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../finanz-core.js");
const JobsCore = require("../jobs-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const JOBS_PATH = path.join(root, "jobs.json");

// Schema mirror: which keys each shape allows (additionalProperties:false).
// Exported so a test can assert they stay in lockstep with jobs.schema.json.
export const ROOT_KEYS = ["postings", "karussell"];
export const POSTING_KEYS = ["id", "company", "title", "url", "from", "months"];
// The permanent slot (Dauerplatz): name + https link, no dates — booked per
// year, curated by hand, so there is nothing for the expiry math to compute.
export const SLOT_KEYS = ["name", "url"];

// Re-exported, not re-typed: the durations we sell are declared once, in
// jobs-core.js, and the schema's enum is asserted against this in the tests.
export const MONTHS = JobsCore.MONTHS;

// Exported so a test can hold them against jobs.schema.json: the schema is what
// a contributor's editor validates against, this is what CI enforces, and a
// contributor who gets a green editor and a red CI has been lied to once.
export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const LIMITS = {
  id: { minLength: 1, maxLength: 48 },
  company: { minLength: 1, maxLength: 60 },
  title: { minLength: 1, maxLength: 100 },
  name: { minLength: 1, maxLength: 40 },
};

// A posting dated far in the future is almost always a typo in the year; more
// than a month of lead time is warned about, never rejected.
const FUTURE_WARN_DAYS = 31;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkUnknownKeys(obj, allowed, where, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(
        `${where}: unbekannter Schlüssel "${key}" — erlaubt sind nur: ${allowed.join(
          ", "
        )}`
      );
    }
  }
}

// minLength counts NON-BLANK characters: JSON Schema cannot say "not just
// spaces", and a card whose company is " " renders as two blank lines.
function checkString(obj, key, where, errors, { minLength, maxLength } = {}) {
  if (!(key in obj)) {
    errors.push(`${where}: Pflichtfeld "${key}" fehlt`);
    return;
  }
  if (typeof obj[key] !== "string") {
    errors.push(`${where}.${key}: muss ein String sein (ist ${typeof obj[key]})`);
    return;
  }
  const len = obj[key].length;
  if (minLength !== undefined && obj[key].trim().length < minLength) {
    errors.push(
      `${where}.${key}: zu kurz — mindestens ${minLength} Zeichen, die keine Leerzeichen sind (sind ${obj[key].trim().length})`
    );
  }
  if (maxLength !== undefined && len > maxLength) {
    errors.push(
      `${where}.${key}: zu lang — höchstens ${maxLength} Zeichen (sind ${len})`
    );
  }
}

function checkHttpsUrl(obj, key, where, errors) {
  if (!(key in obj)) {
    errors.push(`${where}: Pflichtfeld "${key}" fehlt`);
    return;
  }
  if (typeof obj[key] !== "string") {
    errors.push(`${where}.${key}: muss ein String sein (ist ${typeof obj[key]})`);
    return;
  }
  if (!obj[key].startsWith("https://")) {
    errors.push(
      `${where}.${key}: muss mit "https://" beginnen (ist "${obj[key]}")`
    );
  } else if (!Core.isCleanHttpsUrl(obj[key])) {
    // The shared predicate rejects what the ^https:// pattern lets through: a
    // bare "https://" with no host, or whitespace inside the URL.
    errors.push(
      `${where}.${key}: keine gültige URL — nach "https://" muss ein Host ohne Leerzeichen folgen (ist "${obj[key]}")`
    );
  }
}

function checkId(obj, where, errors, seen) {
  if (!("id" in obj)) {
    errors.push(`${where}: Pflichtfeld "id" fehlt`);
    return;
  }
  if (typeof obj.id !== "string") {
    errors.push(`${where}.id: muss ein String sein (ist ${typeof obj.id})`);
    return;
  }
  if (!ID_RE.test(obj.id)) {
    errors.push(
      `${where}.id: "${obj.id}" passt nicht auf ^[a-z0-9][a-z0-9-]*$ — nur Kleinbuchstaben, Ziffern und Bindestriche, Start nicht mit "-"`
    );
    return;
  }
  if (obj.id.length > LIMITS.id.maxLength) {
    errors.push(
      `${where}.id: "${obj.id}" ist zu lang — höchstens ${LIMITS.id.maxLength} Zeichen (sind ${obj.id.length})`
    );
    return;
  }
  if (seen.has(obj.id)) {
    errors.push(
      `${where}.id: "${obj.id}" ist doppelt — ids müssen im Board eindeutig sein`
    );
  } else {
    seen.add(obj.id);
  }
}

function checkCalendarDate(obj, key, where, errors) {
  if (!(key in obj)) {
    errors.push(`${where}: Pflichtfeld "${key}" fehlt`);
    return;
  }
  if (typeof obj[key] !== "string") {
    errors.push(`${where}.${key}: muss ein String sein (ist ${typeof obj[key]})`);
    return;
  }
  if (!Core.isCalendarDate(obj[key])) {
    errors.push(
      `${where}.${key}: kein gültiges Kalenderdatum im Format YYYY-MM-DD (ist "${obj[key]}")`
    );
  }
}

function checkMonths(obj, where, errors) {
  if (!("months" in obj)) {
    errors.push(`${where}: Pflichtfeld "months" fehlt`);
    return;
  }
  const v = obj.months;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    errors.push(
      `${where}.months: muss eine ganze Zahl sein (ist ${JSON.stringify(v)})`
    );
    return;
  }
  if (!MONTHS.includes(v)) {
    errors.push(
      `${where}.months: muss ${MONTHS.join(", ")} sein — andere Laufzeiten gibt es nicht (ist ${v})`
    );
  }
}

/**
 * Validate `data` against jobs.schema.json's rules. PURE — no clock, no I/O — so
 * the same call is used by the CLI, by the tests, and by the snippet check that
 * reads the example out of pinnwand.html. Returns { ok, errors }; every message
 * names its field, what is wrong, and what would be allowed.
 */
export function validate(data) {
  const errors = [];
  if (!isPlainObject(data)) {
    return { ok: false, errors: ["jobs.json: muss ein JSON-Objekt sein"] };
  }
  checkUnknownKeys(data, ROOT_KEYS, "jobs.json", errors);
  if (!("postings" in data)) {
    errors.push('jobs.json: Pflichtfeld "postings" fehlt');
    return { ok: false, errors };
  }
  if (!Array.isArray(data.postings)) {
    errors.push(
      `jobs.json.postings: muss ein Array sein (ist ${
        isPlainObject(data.postings) ? "object" : typeof data.postings
      })`
    );
    return { ok: false, errors };
  }

  const seen = new Set();
  data.postings.forEach((entry, i) => {
    const where = `postings[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${where}: muss ein Objekt sein`);
      return;
    }
    checkUnknownKeys(entry, POSTING_KEYS, where, errors);
    checkId(entry, where, errors, seen);
    checkString(entry, "company", where, errors, LIMITS.company);
    checkString(entry, "title", where, errors, LIMITS.title);
    checkHttpsUrl(entry, "url", where, errors);
    checkCalendarDate(entry, "from", where, errors);
    checkMonths(entry, where, errors);
  });

  if ("karussell" in data) {
    if (!Array.isArray(data.karussell)) {
      errors.push(
        `jobs.json.karussell: muss ein Array sein (ist ${
          isPlainObject(data.karussell) ? "object" : typeof data.karussell
        })`
      );
    } else {
      data.karussell.forEach((entry, i) => {
        const where = `karussell[${i}]`;
        if (!isPlainObject(entry)) {
          errors.push(`${where}: muss ein Objekt sein`);
          return;
        }
        checkUnknownKeys(entry, SLOT_KEYS, where, errors);
        checkString(entry, "name", where, errors, LIMITS.name);
        checkHttpsUrl(entry, "url", where, errors);
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Whole days from `a` to `b`, both ISO days. Date.UTC is a pure construction. */
function daysBetween(a, b) {
  const at = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const bt = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((bt - at) / 86400000);
}

/**
 * Housekeeping notes for `today` — never errors. Only ever called on data that
 * already validated, so every `from`/`months` here is well-formed.
 */
export function staleWarnings(data, today) {
  const out = [];
  const postings = (data && data.postings) || [];
  for (const entry of postings) {
    // Exported, so it can be called on data that never went through validate().
    // Skip what has no usable date rather than throwing a stack trace at a
    // caller who asked for housekeeping notes.
    if (!entry || typeof entry.from !== "string") continue;
    const end = JobsCore.lastDay(entry.from, entry.months);
    if (end && end < today) {
      out.push(
        `${entry.id}: ist seit ${end} abgelaufen — Eintrag aus jobs.json entfernen`
      );
    }
    if (daysBetween(today, entry.from) > FUTURE_WARN_DAYS) {
      out.push(
        `${entry.id}: startet erst am ${entry.from} — mehr als ${FUTURE_WARN_DAYS} Tage in der Zukunft, Jahreszahl prüfen`
      );
    }
  }
  return out;
}

function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : JOBS_PATH;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`ERROR  ${file}: ${err.message}`);
    process.exit(1);
  }

  const { ok, errors } = validate(data);
  // On a runner, emit workflow commands so the findings surface in the PR UI
  // instead of scrolling past in the log.
  const ci = !!process.env.GITHUB_ACTIONS;
  for (const e of errors) console.error(ci ? `::error::${e}` : `ERROR  ${e}`);
  if (!ok) {
    console.error(
      `\n${errors.length} Fehler in ${path.basename(file)} — die Pinnwand würde eine ungültige Anzeige ausliefern.`
    );
    process.exit(1);
  }

  const today = JobsCore.todayString();
  const warnings = staleWarnings(data, today);
  for (const w of warnings) console.log(ci ? `::warning::${w}` : `WARN   ${w}`);

  const total = data.postings.length;
  const active = JobsCore.activeEntries(data.postings, today).length;
  const slots = (data.karussell || []).length;
  console.log(`\nOK: ${total} Anzeige(n) gültig, ${active} aktiv, ${slots} im Karussell.`);
}

// pathToFileURL, not a template string: import.meta.url is percent-encoded and
// argv[1] is not, so a checkout path with a space (or #, ?, a umlaut) makes the
// two differ, main() never runs and the gate exits 0 having validated NOTHING.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
