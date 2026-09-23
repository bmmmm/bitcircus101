#!/usr/bin/env node
/**
 * check-jobs.mjs — offline gate for jobs.json, the job board behind
 * pinnwand.html. Runs in both ci.yml twins AND in deploy.yml: a commit pushed
 * straight to main never sees the PR gate, and an invalid jobs.json would leave
 * the page showing its error state to every visitor.
 *
 * No dependencies, no network, no install step — the PR gate has no
 * `pnpm install`, so this file may only use node builtins and the repo's own
 * modules. The shared field predicates come from validate.mjs, which belongs to
 * no board (they used to be reached through finanz-core.js — #48). The expiry
 * math comes from jobs-core.js, the same file the browser renderer loads, so
 * the gate and the page can never disagree about when a posting comes down.
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
import { isCalendarDate, isCleanHttpsUrl } from "./validate.mjs";

const require = createRequire(import.meta.url);
const JobsCore = require("../jobs-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const JOBS_PATH = path.join(root, "jobs.json");

// Schema mirror: which keys each shape allows (additionalProperties:false).
// Exported so a test can assert they stay in lockstep with jobs.schema.json.
export const ROOT_KEYS = ["postings", "chiffre", "karussell"];
export const POSTING_KEYS = ["id", "company", "title", "location", "employment", "url", "from", "months"];
// A Chiffre note: a person looking for work, anonymous — the contact runs
// through the space's mailbox, never through this file.
export const CHIFFRE_KEYS = [
  "id",
  "headline",
  "level",
  "location",
  "employment",
  "skills",
  "about",
  "from",
  "months",
];
// The permanent slot (Dauerplatz): name + https link, no dates — booked per
// year, curated by hand, so there is nothing for the expiry math to compute.
export const SLOT_KEYS = ["name", "url"];

// Re-exported, not re-typed: the durations we sell are declared once, in
// jobs-core.js, and the schema's enum is asserted against this in the tests.
export const MONTHS = JobsCore.MONTHS;
export const EMPLOYMENT_KEYS = JobsCore.EMPLOYMENT_KEYS;
export const LEVEL_KEYS = JobsCore.LEVEL_KEYS;

// Exported so a test can hold them against jobs.schema.json: the schema is what
// a contributor's editor validates against, this is what CI enforces, and a
// contributor who gets a green editor and a red CI has been lied to once.
export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const CHIFFRE_ID_RE = /^0x[0-9a-f]{2,4}$/;
export const SKILL_RE = /^[a-z0-9+#.-]{1,24}$/;
export const LIMITS = {
  id: { minLength: 1, maxLength: 48 },
  company: { minLength: 1, maxLength: 60 },
  title: { minLength: 1, maxLength: 100 },
  location: { minLength: 1, maxLength: 40 },
  name: { minLength: 1, maxLength: 24 },
  headline: { minLength: 1, maxLength: 100 },
  about: { minLength: 1, maxLength: 300 },
  skills: { minItems: 1, maxItems: 8 },
};

// Warned about on a Chiffre note, never rejected: an address, a link or a
// phone number on the wall would undo the whole point of the Chiffre.
const CONTACT_RE = /@|https?:|www\.|\d{5,}/i;

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
  } else if (!isCleanHttpsUrl(obj[key])) {
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
  if (!isCalendarDate(obj[key])) {
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

function checkEmployment(obj, where, errors) {
  if (!("employment" in obj)) {
    errors.push(`${where}: Pflichtfeld "employment" fehlt`);
    return;
  }
  const v = obj.employment;
  if (!Array.isArray(v) || v.length === 0) {
    errors.push(
      `${where}.employment: muss eine Liste mit mindestens einem Eintrag sein, z. B. ["full-time"] (ist ${JSON.stringify(v)})`
    );
    return;
  }
  const seenKinds = new Set();
  v.forEach((kind, i) => {
    if (!EMPLOYMENT_KEYS.includes(kind)) {
      errors.push(
        `${where}.employment[${i}]: ${JSON.stringify(kind)} gibt es nicht — erlaubt sind: ${EMPLOYMENT_KEYS.join(", ")}`
      );
    } else if (seenKinds.has(kind)) {
      errors.push(`${where}.employment[${i}]: "${kind}" ist doppelt`);
    } else {
      seenKinds.add(kind);
    }
  });
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
  checkSlots(data, errors);
  checkChiffre(data, errors);
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
    checkString(entry, "location", where, errors, LIMITS.location);
    checkEmployment(entry, where, errors);
    checkHttpsUrl(entry, "url", where, errors);
    checkCalendarDate(entry, "from", where, errors);
    checkMonths(entry, where, errors);
  });

  return { ok: errors.length === 0, errors };
}

/**
 * The permanent slot's entries. Called BEFORE the postings checks and their
 * early returns, so a board with a broken `postings` still reports every slot
 * error in the same run — one red run, not two.
 */
function checkSlots(data, errors) {
  if (!("karussell" in data)) return;
  if (!Array.isArray(data.karussell)) {
    errors.push(
      `jobs.json.karussell: muss ein Array sein (ist ${
        isPlainObject(data.karussell) ? "object" : typeof data.karussell
      })`
    );
    return;
  }
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

/**
 * The Chiffre notes. Like checkSlots, called before the postings checks and
 * their early returns, so every error surfaces in one run.
 */
function checkChiffre(data, errors) {
  if (!("chiffre" in data)) return;
  if (!Array.isArray(data.chiffre)) {
    errors.push(
      `jobs.json.chiffre: muss ein Array sein (ist ${
        isPlainObject(data.chiffre) ? "object" : typeof data.chiffre
      })`
    );
    return;
  }
  const seen = new Set();
  data.chiffre.forEach((entry, i) => {
    const where = `chiffre[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${where}: muss ein Objekt sein`);
      return;
    }
    checkUnknownKeys(entry, CHIFFRE_KEYS, where, errors);
    if (!("id" in entry)) {
      errors.push(`${where}: Pflichtfeld "id" fehlt`);
    } else if (typeof entry.id !== "string" || !CHIFFRE_ID_RE.test(entry.id)) {
      errors.push(
        `${where}.id: ${JSON.stringify(entry.id)} ist keine Chiffre — 0x und zwei bis vier Hex-Ziffern, klein geschrieben, z. B. "0x2a"`
      );
    } else if (seen.has(entry.id)) {
      errors.push(`${where}.id: "${entry.id}" ist doppelt — eine Chiffre ist die Betreffzeile, sie muss eindeutig sein`);
    } else {
      seen.add(entry.id);
    }
    checkString(entry, "headline", where, errors, LIMITS.headline);
    if (!("level" in entry)) {
      errors.push(`${where}: Pflichtfeld "level" fehlt`);
    } else if (!LEVEL_KEYS.includes(entry.level)) {
      errors.push(
        `${where}.level: ${JSON.stringify(entry.level)} gibt es nicht — erlaubt sind: ${LEVEL_KEYS.join(", ")}`
      );
    }
    checkString(entry, "location", where, errors, LIMITS.location);
    checkEmployment(entry, where, errors);
    checkSkills(entry, where, errors);
    checkString(entry, "about", where, errors, LIMITS.about);
    checkCalendarDate(entry, "from", where, errors);
    checkMonths(entry, where, errors);
  });
}

function checkSkills(obj, where, errors) {
  if (!("skills" in obj)) {
    errors.push(`${where}: Pflichtfeld "skills" fehlt`);
    return;
  }
  const v = obj.skills;
  const { minItems, maxItems } = LIMITS.skills;
  if (!Array.isArray(v) || v.length < minItems || v.length > maxItems) {
    errors.push(
      `${where}.skills: muss eine Liste mit ${minItems} bis ${maxItems} Einträgen sein (ist ${JSON.stringify(v)})`
    );
    return;
  }
  const seenSkills = new Set();
  v.forEach((skill, i) => {
    if (typeof skill !== "string" || !SKILL_RE.test(skill)) {
      errors.push(
        `${where}.skills[${i}]: ${JSON.stringify(skill)} — klein geschrieben, höchstens 24 Zeichen aus a–z, 0–9 und + # . -`
      );
    } else if (seenSkills.has(skill)) {
      errors.push(`${where}.skills[${i}]: "${skill}" ist doppelt`);
    } else {
      seenSkills.add(skill);
    }
  });
}

/**
 * A Chiffre note that looks like it carries contact details — warned about,
 * never an error: "C#, 10000 Zeilen" is fine, a mail address is not, and only
 * a human can tell the two apart. Only called on data that validated.
 */
export function contactWarnings(data) {
  const out = [];
  for (const entry of (data && data.chiffre) || []) {
    for (const key of ["headline", "location", "about"]) {
      if (typeof entry[key] === "string" && CONTACT_RE.test(entry[key])) {
        out.push(
          `${entry.id}.${key}: sieht nach Kontaktdaten aus — die kommen per weitergeleiteter Mail, nicht auf die Wand`
        );
      }
    }
  }
  return out;
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
  const entries = [
    ...((data && data.postings) || []),
    ...((data && Array.isArray(data.chiffre) && data.chiffre) || []),
  ];
  for (const entry of entries) {
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
  const warnings = [...staleWarnings(data, today), ...contactWarnings(data)];
  for (const w of warnings) console.log(ci ? `::warning::${w}` : `WARN   ${w}`);

  const total = data.postings.length;
  const active = JobsCore.activeEntries(data.postings, today).length;
  const slots = (data.karussell || []).length;
  const chiffre = data.chiffre || [];
  const chiffreActive = JobsCore.activeEntries(chiffre, today).length;
  console.log(
    `\nOK: ${total} Anzeige(n) gültig, ${active} aktiv, ${slots} im Karussell, ${chiffre.length} Chiffre(n), ${chiffreActive} aktiv.`
  );
}

// pathToFileURL, not a template string: import.meta.url is percent-encoded and
// argv[1] is not, so a checkout path with a space (or #, ?, an umlaut) makes the
// two differ, main() never runs and the gate exits 0 having validated NOTHING.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
