/**
 * finanz-data.mjs — pure data layer for the "Finanz-Steuerzentrale" CLI.
 *
 * No interactive I/O lives here: read/write the JSON files, validate against
 * finanz.schema.json (hand-rolled — no ajv, no new dependency), and apply the
 * editing operations. The interactive shell (finanz.mjs) is the only place that
 * touches the terminal or calls new Date(); every operation here takes the date
 * IN as an argument so the tests stay deterministic.
 *
 * Pulse math is REUSED from finanz-core.js (the single source of truth shared
 * with the browser renderer). finanz-core.js is a CommonJS UMD module, so it is
 * pulled in via createRequire rather than a bare ESM import.
 *
 * DSGVO: this layer manages ONLY aggregate totals plus a value-free pulse. It
 * never stores donor names, emails, or per-donation records, and the pulse holds
 * ONLY integer 0..7 levels — never a euro amount.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../finanz-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const FINANZ_PATH = path.join(root, "finanz.json");
export const FUNDING_PATH = path.join(root, "funding.json");

const CURRENCIES = ["EUR", "USD", "GBP"];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A plain decimal: optional sign, digits, and a single "," OR "." separator
// followed by AT MOST two digits (cents). Rejects what bare Number() is too lax
// about — "" → 0, "0x10" → 16, "1e3" → 1000 — AND the thousands-grouping trap
// ("1.000" / "1,000" → a silent 1); those are refused, not misread.
const DECIMAL_RE = /^[+-]?\d+([.,]\d{1,2})?$/;

// Schema mirror: which keys each shape allows (additionalProperties:false). Kept
// next to the validator so a schema change has one obvious place to follow.
// Exported so a test can assert they stay in lockstep with finanz.schema.json.
export const ROOT_KEYS = ["currency", "updated", "pulse", "einmalig", "monatlich"];
export const PULSE_KEYS = ["updated", "levels"];
export const EINMALIG_KEYS = [
  "id",
  "title",
  "tagline",
  "description",
  "icon",
  "target",
  "raised",
  "url1",
  "url2",
];
export const MONATLICH_KEYS = [
  "id",
  "title",
  "tagline",
  "description",
  "icon",
  "monthly",
  "url1",
  "url2",
];

// Calendar-date validity is shared with the browser editor via finanz-core.js
// (single source — neither validator drifts). Re-exported so the CLI's public
// surface and its tests keep one obvious import.
export const isCalendarDate = Core.isCalendarDate;

/**
 * Parse a hand-typed euro/level amount. Accepts an optional sign, digits, and a
 * single German "," OR "." decimal separator — and rejects everything bare
 * Number() silently coerces (empty string → 0, hex 0x10 → 16, scientific 1e3 →
 * 1000, stray text → NaN). Returns a finite number, or null (never 0) so the
 * caller can emit an actionable error. Whole-euro enforcement stays in validate().
 */
export function parseAmount(str) {
  const t = String(str == null ? "" : str).trim();
  if (!DECIMAL_RE.test(t)) return null;
  return Number(t.replace(",", "."));
}

// ── File I/O ────────────────────────────────────────────────────────────────

/** Load + parse finanz.json (defaults to the repo copy). Throws on bad JSON. */
export function read(file = FINANZ_PATH) {
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

/**
 * Serialise to match the existing file byte-for-byte: 2-space indent and a
 * single trailing newline, so a no-op write produces an empty git diff. Writes
 * ATOMICALLY — a temp file in the same directory, then rename over the target —
 * so a crash mid-write never truncates the real file.
 */
export function write(data, file = FINANZ_PATH) {
  const text = JSON.stringify(data, null, 2) + "\n";
  const dir = path.dirname(file);
  const tmp = path.join(dir, "." + path.basename(file) + ".tmp-" + process.pid);
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

// ── Validation (hand-rolled, mirrors finanz.schema.json) ─────────────────────

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

function checkString(
  obj,
  key,
  where,
  errors,
  { required = false, minLength, maxLength } = {}
) {
  if (!(key in obj)) {
    if (required) errors.push(`${where}: Pflichtfeld "${key}" fehlt`);
    return;
  }
  if (typeof obj[key] !== "string") {
    errors.push(`${where}.${key}: muss ein String sein (ist ${typeof obj[key]})`);
    return;
  }
  const len = obj[key].length;
  if (minLength !== undefined && len < minLength) {
    errors.push(
      `${where}.${key}: zu kurz — mindestens ${minLength} Zeichen (sind ${len})`
    );
  }
  if (maxLength !== undefined && len > maxLength) {
    errors.push(
      `${where}.${key}: zu lang — höchstens ${maxLength} Zeichen (sind ${len})`
    );
  }
}

function checkHttpsUrl(obj, key, where, errors) {
  if (!(key in obj)) return;
  if (typeof obj[key] !== "string") {
    errors.push(`${where}.${key}: muss ein String sein (ist ${typeof obj[key]})`);
    return;
  }
  if (!obj[key].startsWith("https://")) {
    errors.push(
      `${where}.${key}: muss mit "https://" beginnen (ist "${obj[key]}")`
    );
  } else if (!Core.isCleanHttpsUrl(obj[key])) {
    // Schema declares format:uri; the same shared predicate the browser editor
    // uses rejects the non-URLs the ^https:// pattern lets through: a bare
    // "https://" with no host, or whitespace inside the URL.
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
  if (obj.id.length > 48) {
    errors.push(
      `${where}.id: "${obj.id}" ist zu lang — höchstens 48 Zeichen (sind ${obj.id.length})`
    );
    return;
  }
  if (seen.has(obj.id)) {
    errors.push(`${where}.id: "${obj.id}" ist doppelt — ids müssen pro Liste eindeutig sein`);
  } else {
    seen.add(obj.id);
  }
}

function checkNumber(obj, key, where, errors, { min, exclusiveMin, integer } = {}) {
  if (!(key in obj)) {
    errors.push(`${where}: Pflichtfeld "${key}" fehlt`);
    return;
  }
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push(`${where}.${key}: muss eine endliche Zahl sein (ist ${JSON.stringify(v)})`);
    return;
  }
  if (integer && !Number.isInteger(v)) {
    errors.push(`${where}.${key}: muss eine ganze Zahl (Euro ohne Cent) sein (ist ${v})`);
  }
  if (exclusiveMin !== undefined && !(v > exclusiveMin)) {
    errors.push(`${where}.${key}: muss größer als ${exclusiveMin} sein (ist ${v})`);
  }
  if (min !== undefined && !(v >= min)) {
    errors.push(`${where}.${key}: darf nicht kleiner als ${min} sein (ist ${v})`);
  }
}

/**
 * Validate `data` against finanz.schema.json's rules. Returns
 * { ok, errors } where each error names the field, what is wrong, and the
 * allowed value/range — every message is actionable.
 */
export function validate(data) {
  const errors = [];

  if (!isPlainObject(data)) {
    return { ok: false, errors: ["root: muss ein JSON-Objekt sein"] };
  }

  checkUnknownKeys(data, ROOT_KEYS, "root", errors);

  // currency (required, enum)
  if (!("currency" in data)) {
    errors.push('root: Pflichtfeld "currency" fehlt');
  } else if (!CURRENCIES.includes(data.currency)) {
    errors.push(
      `root.currency: "${data.currency}" ist ungültig — erlaubt sind: ${CURRENCIES.join(", ")}`
    );
  }

  // updated (required, YYYY-MM-DD)
  if (!("updated" in data)) {
    errors.push('root: Pflichtfeld "updated" fehlt');
  } else if (typeof data.updated !== "string" || !isCalendarDate(data.updated)) {
    errors.push(
      `root.updated: "${data.updated}" muss ein gültiges Datum im Format YYYY-MM-DD sein`
    );
  }

  // pulse (optional)
  if ("pulse" in data) {
    const pulse = data.pulse;
    if (!isPlainObject(pulse)) {
      errors.push("root.pulse: muss ein Objekt sein");
    } else {
      checkUnknownKeys(pulse, PULSE_KEYS, "root.pulse", errors);
      if ("updated" in pulse) {
        if (typeof pulse.updated !== "string" || !isCalendarDate(pulse.updated)) {
          errors.push(
            `root.pulse.updated: "${pulse.updated}" muss ein gültiges Datum im Format YYYY-MM-DD sein`
          );
        }
      }
      if (!("levels" in pulse)) {
        errors.push('root.pulse: Pflichtfeld "levels" fehlt');
      } else if (!Array.isArray(pulse.levels)) {
        errors.push("root.pulse.levels: muss ein Array sein");
      } else {
        if (pulse.levels.length > 64) {
          errors.push(
            `root.pulse.levels: höchstens 64 Einträge erlaubt (sind ${pulse.levels.length})`
          );
        }
        pulse.levels.forEach((lvl, i) => {
          if (!Number.isInteger(lvl) || lvl < 0 || lvl > 7) {
            errors.push(
              `root.pulse.levels[${i}]: muss eine ganze Zahl 0..7 sein (ist ${JSON.stringify(lvl)})`
            );
          }
        });
      }
    }
  }

  // einmalig (required array)
  if (!("einmalig" in data)) {
    errors.push('root: Pflichtfeld "einmalig" fehlt');
  } else if (!Array.isArray(data.einmalig)) {
    errors.push("root.einmalig: muss ein Array sein");
  } else {
    const seen = new Set();
    data.einmalig.forEach((item, i) => {
      const where = `einmalig[${i}]`;
      if (!isPlainObject(item)) {
        errors.push(`${where}: muss ein Objekt sein`);
        return;
      }
      checkUnknownKeys(item, EINMALIG_KEYS, where, errors);
      checkId(item, where, errors, seen);
      checkString(item, "title", where, errors, {
        required: true,
        minLength: 1,
        maxLength: 80,
      });
      checkString(item, "tagline", where, errors, { maxLength: 120 });
      checkString(item, "description", where, errors, { maxLength: 400 });
      checkString(item, "icon", where, errors, { maxLength: 8 });
      checkNumber(item, "target", where, errors, { exclusiveMin: 0, integer: true });
      checkNumber(item, "raised", where, errors, { min: 0, integer: true });
      checkHttpsUrl(item, "url1", where, errors);
      checkHttpsUrl(item, "url2", where, errors);
    });
  }

  // monatlich (required array)
  if (!("monatlich" in data)) {
    errors.push('root: Pflichtfeld "monatlich" fehlt');
  } else if (!Array.isArray(data.monatlich)) {
    errors.push("root.monatlich: muss ein Array sein");
  } else {
    const seen = new Set();
    data.monatlich.forEach((item, i) => {
      const where = `monatlich[${i}]`;
      if (!isPlainObject(item)) {
        errors.push(`${where}: muss ein Objekt sein`);
        return;
      }
      checkUnknownKeys(item, MONATLICH_KEYS, where, errors);
      checkId(item, where, errors, seen);
      checkString(item, "title", where, errors, {
        required: true,
        minLength: 1,
        maxLength: 80,
      });
      checkString(item, "tagline", where, errors, { maxLength: 120 });
      checkString(item, "description", where, errors, { maxLength: 400 });
      checkString(item, "icon", where, errors, { maxLength: 8 });
      checkNumber(item, "monthly", where, errors, { exclusiveMin: 0, integer: true });
      checkHttpsUrl(item, "url1", where, errors);
      checkHttpsUrl(item, "url2", where, errors);
    });
  }

  return { ok: errors.length === 0, errors };
}

/** Validate or throw a single combined, actionable error. */
function assertValid(data) {
  const { ok, errors } = validate(data);
  if (!ok) {
    throw new Error("finanz.json ungültig:\n  - " + errors.join("\n  - "));
  }
}

// ── Operations ───────────────────────────────────────────────────────────────
// Each one returns a NEW data object (never mutates the input), validates the
// result, and stamps `updated` from the date passed in — no new Date() here so
// the tests are deterministic.

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function findEinmalig(data, id) {
  return (data.einmalig || []).find((p) => p.id === id);
}

function findItem(data, id) {
  return (
    (data.einmalig || []).find((p) => p.id === id) ||
    (data.monatlich || []).find((p) => p.id === id)
  );
}

/** Add `amount` to a one-time project's raised total (amount may be negative). */
export function raiseProject(data, id, amount, date) {
  const next = clone(data);
  const project = findEinmalig(next, id);
  if (!project) {
    throw new Error(
      `Kein einmaliges Projekt mit id "${id}" gefunden — verfügbare ids: ${(next.einmalig || [])
        .map((p) => p.id)
        .join(", ") || "(keine)"}`
    );
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error(`Betrag muss eine endliche Zahl sein (ist ${JSON.stringify(amount)})`);
  }
  const raised = Math.max(0, project.raised + amount);
  project.raised = raised;
  next.updated = date;
  assertValid(next);
  return next;
}

/** Mark a one-time project as reached: set raised = target. */
export function finishProject(data, id, date) {
  const next = clone(data);
  const project = findEinmalig(next, id);
  if (!project) {
    throw new Error(
      `Kein einmaliges Projekt mit id "${id}" gefunden — verfügbare ids: ${(next.einmalig || [])
        .map((p) => p.id)
        .join(", ") || "(keine)"}`
    );
  }
  project.raised = project.target;
  next.updated = date;
  assertValid(next);
  return next;
}

/** Append a new one-time project. Rejects via validate() on duplicate/bad id. */
export function addEinmalig(data, obj, date) {
  const next = clone(data);
  if (!isPlainObject(obj)) {
    throw new Error("Neues Projekt muss ein Objekt mit id, title, target, raised sein");
  }
  next.einmalig = (next.einmalig || []).concat([clone(obj)]);
  next.updated = date;
  assertValid(next);
  return next;
}

/** Append a new recurring monthly cost. */
export function addMonatlich(data, obj, date) {
  const next = clone(data);
  if (!isPlainObject(obj)) {
    throw new Error("Neue monatliche Kosten müssen ein Objekt mit id, title, monthly sein");
  }
  next.monatlich = (next.monatlich || []).concat([clone(obj)]);
  next.updated = date;
  assertValid(next);
  return next;
}

/** Remove an item (one-time or monthly) by id from whichever list holds it. */
export function removeItem(data, id, date) {
  const next = clone(data);
  if (!findItem(next, id)) {
    throw new Error(
      `Kein Eintrag mit id "${id}" gefunden — verfügbare ids: ${[
        ...(next.einmalig || []),
        ...(next.monatlich || []),
      ]
        .map((p) => p.id)
        .join(", ") || "(keine)"}`
    );
  }
  next.einmalig = (next.einmalig || []).filter((p) => p.id !== id);
  next.monatlich = (next.monatlich || []).filter((p) => p.id !== id);
  next.updated = date;
  assertValid(next);
  return next;
}

/**
 * Append a value-free pulse level (0..7) to the heartbeat track via
 * Core.pushPulse (clamps + caps). Stamps both the board and the pulse `updated`.
 * DSGVO: only the integer level is ever stored — never a euro amount.
 */
export function setPulse(data, level, date) {
  const next = clone(data);
  const current = (next.pulse && next.pulse.levels) || [];
  // Cap at 64 to match the schema's maxItems (and the browser editor), NOT the
  // renderer's 24-wide display window — otherwise editing the pulse from the CLI
  // would silently trim a longer track the browser tool is allowed to keep.
  const levels = Core.pushPulse(current, level, 64);
  next.pulse = { updated: date, levels };
  next.updated = date;
  assertValid(next);
  return next;
}

/**
 * Write funding.json { "percent": n } with n clamped to an integer 0..100.
 * Matches the existing single-line format so the git diff stays minimal.
 */
export function setPercent(n, file = FUNDING_PATH) {
  const raw = typeof n === "number" ? n : parseFloat(n);
  if (!Number.isFinite(raw)) {
    throw new Error(`Prozent muss eine Zahl sein (ist ${JSON.stringify(n)})`);
  }
  const percent = Math.min(100, Math.max(0, Math.round(raw)));
  // Keep funding.json's existing single-line byte layout: `{ "percent": N }\n`.
  const text = `{ "percent": ${percent} }\n`;
  const dir = path.dirname(file);
  const tmp = path.join(dir, "." + path.basename(file) + ".tmp-" + process.pid);
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
  return percent;
}
