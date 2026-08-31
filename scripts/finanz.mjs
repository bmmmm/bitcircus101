#!/usr/bin/env node
/**
 * finanz.mjs — "Finanz-Steuerzentrale": the CLI for editing finanz.json (the
 * cost/funding board on support.html#projekte) and the footer percent in
 * funding.json.
 *
 * Two modes:
 *   • no args        → interactive menu (prints the board, then offers actions,
 *                      confirming before every write).
 *   • a subcommand   → scriptable one-shot (raise/finish/add/monthly/pulse/
 *                      percent/list/validate). Bad or missing args print an
 *                      actionable usage message and exit 1.
 *
 * This is the ONLY place that calls new Date(): it passes today's YYYY-MM-DD
 * into the pure data layer (finanz-data.mjs), which does the actual mutation +
 * validation. Every write path validates FIRST and refuses with actionable
 * errors if the result would be invalid.
 *
 * DSGVO: the CLI never prompts for or stores names or personal data. The pulse
 * takes only an integer 0..7 level — never a euro amount.
 *
 * UI text is German; code comments are English (project convention).
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createRequire } from "node:module";
import {
  read,
  write,
  validate,
  parseAmount,
  raiseProject,
  finishProject,
  addEinmalig,
  addMonatlich,
  removeItem,
  setPulse,
  setPercent,
  FINANZ_PATH,
  FUNDING_PATH,
} from "./finanz-data.mjs";

const require = createRequire(import.meta.url);
const Core = require("../finanz-core.js");

/** Today as YYYY-MM-DD in local time — the single new Date() call in the layer. */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readFunding() {
  try {
    const raw = require("fs").readFileSync(FUNDING_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { percent: null };
  }
}

// ── Board printing (read-only, value-free pulse) ─────────────────────────────

function printBoard(data) {
  const currency = data.currency || "EUR";
  console.log("");
  console.log("  ┌─ Finanz-Steuerzentrale ───────────────────────────────");
  console.log(`  │ Währung: ${currency}   zuletzt aktualisiert: ${data.updated}`);
  const funding = readFunding();
  if (funding.percent != null) {
    console.log(`  │ LIGHTS ON? (funding.json): ${funding.percent}%`);
  }
  console.log("  ├─ Einmalige Projekte ──────────────────────────────────");
  const einmalig = data.einmalig || [];
  if (!einmalig.length) {
    console.log("  │ (keine)");
  } else {
    for (const p of einmalig) {
      const view = Core.computeProject(p, { currency });
      const bar = view.bar.filled + view.bar.empty;
      console.log(
        `  │ ${p.id}  [${bar}] ${view.pct}%  ` +
          `${Core.formatAmount(view.raised, currency)} / ${Core.formatAmount(
            view.target,
            currency
          )}${view.reached ? "  *** ERREICHT ***" : ""}`
      );
    }
  }
  console.log("  ├─ Monatliche Kosten ───────────────────────────────────");
  const monatlich = data.monatlich || [];
  if (!monatlich.length) {
    console.log("  │ (keine)");
  } else {
    for (const m of monatlich) {
      console.log(
        `  │ ${m.id}  ${Core.formatAmount(m.monthly, currency)} / Monat`
      );
    }
  }
  // Pulse: glyphs only — never a digit or euro figure on the board.
  const levels = (data.pulse && data.pulse.levels) || [];
  console.log("  ├─ Puls (wertfrei) ─────────────────────────────────────");
  console.log(`  │ ${Core.pulseSparkline(levels) || "(leer)"}`);
  console.log("  └───────────────────────────────────────────────────────");
  console.log("");
}

// ── Shared write helper ──────────────────────────────────────────────────────

/** Validate, write, and print the success + commit reminder. Returns true. */
function commitWrite(next) {
  const { ok, errors } = validate(next);
  if (!ok) {
    console.error("✗ Abbruch — finanz.json wäre ungültig:");
    for (const e of errors) console.error("  - " + e);
    return false;
  }
  write(next);
  console.log(`✓ finanz.json aktualisiert (updated: ${next.updated})`);
  console.log("  Bitte committen: git add finanz.json && git commit");
  return true;
}

// ── Scriptable subcommands ───────────────────────────────────────────────────

const USAGE = `Finanz-Steuerzentrale — Verwaltung von finanz.json

Aufruf:
  node scripts/finanz.mjs                  interaktives Menü
  node scripts/finanz.mjs <Befehl> [args]  direkter Befehl

Befehle:
  list                       Board anzeigen
  validate                   finanz.json gegen das Schema prüfen
  raise <id> <betrag>        Betrag zu "raised" eines Projekts addieren (auch negativ)
  finish <id>                Projekt auf erreicht setzen (raised = target)
  add                        neues einmaliges Projekt anlegen (interaktiv)
  monthly                    monatliche Kosten verwalten (interaktiv)
  pulse <level>              Puls-Level 0..7 anhängen (wertfrei, keine Euro-Angabe)
  percent <n>                Gesamt-% (funding.json) setzen, 0..100

Hinweis: Jeder Schreibvorgang validiert zuerst und bricht mit konkreter
Fehlermeldung ab, wenn das Ergebnis ungültig wäre. Daten ohne Personenbezug —
keine Namen, keine Einzelspenden.`;

function fail(message) {
  console.error("✗ " + message);
  console.error("");
  console.error(USAGE);
  process.exit(1);
}

async function runSubcommand(cmd, args) {
  const date = today();

  if (cmd === "list") {
    printBoard(read());
    return;
  }

  if (cmd === "validate") {
    const { ok, errors } = validate(read());
    if (ok) {
      console.log("✓ finanz.json ist gültig.");
      return;
    }
    console.error("✗ finanz.json ist ungültig:");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  if (cmd === "raise") {
    const [id, amountStr] = args;
    if (!id || amountStr === undefined) {
      fail('raise braucht <id> und <betrag>, z.B.: raise solar-speicher 100');
    }
    const amount = parseAmount(amountStr);
    if (amount === null) {
      fail(
        `Betrag "${amountStr}" ist keine gültige Zahl — ganze Euro, z.B.: raise solar-speicher 100 (auch -50; Komma oder Punkt erlaubt, keine Buchstaben/Hex/Exponent)`
      );
    }
    let next;
    try {
      next = raiseProject(read(), id, amount, date);
    } catch (e) {
      fail(e.message);
    }
    process.exitCode = commitWrite(next) ? 0 : 1;
    return;
  }

  if (cmd === "finish") {
    const [id] = args;
    if (!id) fail("finish braucht <id>, z.B.: finish solar-speicher");
    let next;
    try {
      next = finishProject(read(), id, date);
    } catch (e) {
      fail(e.message);
    }
    process.exitCode = commitWrite(next) ? 0 : 1;
    return;
  }

  if (cmd === "pulse") {
    const [levelStr] = args;
    if (levelStr === undefined) {
      fail("pulse braucht <level> 0..7, z.B.: pulse 4 (wertfrei, keine Euro-Angabe)");
    }
    const level = parseAmount(levelStr);
    if (level === null || !Number.isInteger(level) || level < 0 || level > 7) {
      fail(`Level "${levelStr}" muss eine ganze Zahl 0..7 sein`);
    }
    let next;
    try {
      next = setPulse(read(), level, date);
    } catch (e) {
      fail(e.message);
    }
    process.exitCode = commitWrite(next) ? 0 : 1;
    return;
  }

  if (cmd === "percent") {
    const [nStr] = args;
    if (nStr === undefined) fail("percent braucht <n> 0..100, z.B.: percent 25");
    const n = parseAmount(nStr);
    if (n === null) {
      fail(`Prozent "${nStr}" ist keine gültige Zahl — ganze Zahl 0..100, z.B.: percent 25`);
    }
    const written = setPercent(n);
    console.log(`✓ funding.json aktualisiert (percent: ${written})`);
    console.log("  Bitte committen: git add funding.json && git commit");
    return;
  }

  if (cmd === "add") {
    await interactiveAddEinmalig(date);
    return;
  }

  if (cmd === "monthly") {
    await interactiveMonthly(date);
    return;
  }

  fail(`Unbekannter Befehl: "${cmd}"`);
}

// ── Interactive helpers ──────────────────────────────────────────────────────

async function confirm(rl, question) {
  const ans = (await rl.question(`${question} [j/N] `)).trim().toLowerCase();
  return ans === "j" || ans === "ja" || ans === "y" || ans === "yes";
}

/**
 * Ask for a number. An empty line returns `fallback` when one is given, else it
 * re-asks (never silently coerces a bare Enter to 0). Garbage, hex and exponent
 * forms are rejected with an actionable hint; comma decimals are accepted.
 */
async function askNumber(rl, label, { min, max, fallback } = {}) {
  for (;;) {
    const raw = (await rl.question(`${label}: `)).trim();
    if (raw === "") {
      if (fallback !== undefined) return fallback;
      console.log("  Bitte einen Wert eingeben (z.B. 50; auch -20).");
      continue;
    }
    const n = parseAmount(raw);
    if (n === null) {
      console.log(
        "  Bitte eine normale Zahl eingeben (z.B. 1000 oder 1000,50) — keine Buchstaben, Hex oder Exponenten."
      );
      continue;
    }
    if (min !== undefined && n < min) {
      console.log(`  Muss mindestens ${min} sein.`);
      continue;
    }
    if (max !== undefined && n > max) {
      console.log(`  Darf höchstens ${max} sein.`);
      continue;
    }
    return n;
  }
}

/** Build an item from a set of optional string fields, dropping empties. */
function withOptional(base, fields) {
  const out = { ...base };
  for (const [key, value] of Object.entries(fields)) {
    if (value && value.trim()) out[key] = value.trim();
  }
  return out;
}

async function interactiveAddEinmalig(date, rl = null) {
  const own = !rl;
  if (own) rl = readline.createInterface({ input, output });
  try {
    console.log("\n  Neues einmaliges Projekt (DSGVO: keine Namen, nur Eckdaten):");
    const id = (await rl.question("  id (a-z, 0-9, -): ")).trim();
    const title = (await rl.question("  Titel: ")).trim();
    const tagline = await rl.question("  Tagline (optional): ");
    const description = await rl.question("  Beschreibung (optional): ");
    const icon = await rl.question("  Icon-Glyph (optional): ");
    const target = await askNumber(rl, "  Zielbetrag (target)", { min: 0.0001 });
    const raised = await askNumber(rl, "  Bisher (raised)", { min: 0, fallback: 0 });
    const url1 = await rl.question("  URL 1 (https, optional): ");
    const url2 = await rl.question("  URL 2 (https, optional): ");

    const obj = withOptional(
      { id, title, target, raised },
      { tagline, description, icon, url1, url2 }
    );

    let next;
    try {
      next = addEinmalig(read(), obj, date);
    } catch (e) {
      console.error("✗ " + e.message);
      return;
    }
    if (await confirm(rl, `  Projekt "${id}" hinzufügen und speichern?`)) {
      commitWrite(next);
    } else {
      console.log("  Abgebrochen — nichts geschrieben.");
    }
  } finally {
    if (own) rl.close();
  }
}

async function interactiveMonthly(date, rl = null) {
  const own = !rl;
  if (own) rl = readline.createInterface({ input, output });
  try {
    console.log("\n  Monatliche Kosten — (1) hinzufügen  (2) entfernen");
    const choice = (await rl.question("  Auswahl: ")).trim();

    if (choice === "1") {
      console.log("  Neue monatliche Kosten:");
      const id = (await rl.question("  id (a-z, 0-9, -): ")).trim();
      const title = (await rl.question("  Titel: ")).trim();
      const tagline = await rl.question("  Tagline (optional): ");
      const description = await rl.question("  Beschreibung (optional): ");
      const icon = await rl.question("  Icon-Glyph (optional): ");
      const monthly = await askNumber(rl, "  Betrag pro Monat (monthly)", {
        min: 0.0001,
      });
      const url1 = await rl.question("  URL 1 (https, optional): ");
      const url2 = await rl.question("  URL 2 (https, optional): ");

      const obj = withOptional(
        { id, title, monthly },
        { tagline, description, icon, url1, url2 }
      );
      let next;
      try {
        next = addMonatlich(read(), obj, date);
      } catch (e) {
        console.error("✗ " + e.message);
        return;
      }
      if (await confirm(rl, `  Kosten "${id}" hinzufügen und speichern?`)) {
        commitWrite(next);
      } else {
        console.log("  Abgebrochen — nichts geschrieben.");
      }
    } else if (choice === "2") {
      const data = read();
      const ids = (data.monatlich || []).map((m) => m.id);
      if (!ids.length) {
        console.log("  Keine monatlichen Kosten vorhanden.");
        return;
      }
      console.log("  Vorhanden: " + ids.join(", "));
      const id = (await rl.question("  Welche id entfernen? ")).trim();
      let next;
      try {
        next = removeItem(data, id, date);
      } catch (e) {
        console.error("✗ " + e.message);
        return;
      }
      if (await confirm(rl, `  "${id}" wirklich entfernen?`)) {
        commitWrite(next);
      } else {
        console.log("  Abgebrochen — nichts geschrieben.");
      }
    } else {
      console.log("  Ungültige Auswahl.");
    }
  } finally {
    if (own) rl.close();
  }
}

// ── Interactive top-level menu ───────────────────────────────────────────────

async function interactiveMenu() {
  const date = today();
  const rl = readline.createInterface({ input, output });
  try {
    printBoard(read());
    console.log("  Aktionen:");
    console.log("   1) raised aktualisieren");
    console.log("   2) Projekt beenden (raised = target)");
    console.log("   3) Projekt hinzufügen");
    console.log("   4) monatliche Kosten verwalten");
    console.log("   5) Puls-Level setzen (0..7, wertfrei)");
    console.log("   6) Gesamt-% setzen (funding.json)");
    console.log("   7) validieren");
    console.log("   0) beenden");
    const choice = (await rl.question("\n  Auswahl: ")).trim();

    if (choice === "1") {
      const id = (await rl.question("  Projekt-id: ")).trim();
      const amount = await askNumber(rl, "  Betrag (+/-)");
      let next;
      try {
        next = raiseProject(read(), id, amount, date);
      } catch (e) {
        console.error("✗ " + e.message);
        return;
      }
      const p = next.einmalig.find((x) => x.id === id);
      if (await confirm(rl, `  "${id}" auf ${p.raised} setzen und speichern?`)) {
        commitWrite(next);
      } else {
        console.log("  Abgebrochen — nichts geschrieben.");
      }
    } else if (choice === "2") {
      const id = (await rl.question("  Projekt-id: ")).trim();
      let next;
      try {
        next = finishProject(read(), id, date);
      } catch (e) {
        console.error("✗ " + e.message);
        return;
      }
      if (await confirm(rl, `  "${id}" als erreicht markieren und speichern?`)) {
        commitWrite(next);
      } else {
        console.log("  Abgebrochen — nichts geschrieben.");
      }
    } else if (choice === "3") {
      await interactiveAddEinmalig(date, rl);
    } else if (choice === "4") {
      await interactiveMonthly(date, rl);
    } else if (choice === "5") {
      const level = await askNumber(rl, "  Puls-Level 0..7 (wertfrei)", {
        min: 0,
      });
      if (!Number.isInteger(level) || level > 7) {
        console.log("  Muss eine ganze Zahl 0..7 sein.");
        return;
      }
      let next;
      try {
        next = setPulse(read(), level, date);
      } catch (e) {
        console.error("✗ " + e.message);
        return;
      }
      if (await confirm(rl, `  Puls-Level ${level} anhängen und speichern?`)) {
        commitWrite(next);
      } else {
        console.log("  Abgebrochen — nichts geschrieben.");
      }
    } else if (choice === "6") {
      const n = await askNumber(rl, "  Gesamt-% 0..100", { min: 0, max: 100 });
      if (await confirm(rl, `  funding.json auf ${Math.round(n)}% setzen?`)) {
        const written = setPercent(n);
        console.log(`✓ funding.json aktualisiert (percent: ${written})`);
        console.log("  Bitte committen: git add funding.json && git commit");
      } else {
        console.log("  Abgebrochen — nichts geschrieben.");
      }
    } else if (choice === "7") {
      const { ok, errors } = validate(read());
      if (ok) {
        console.log("✓ finanz.json ist gültig.");
      } else {
        console.error("✗ finanz.json ist ungültig:");
        for (const e of errors) console.error("  - " + e);
      }
    } else if (choice === "0" || choice === "") {
      console.log("  Tschüss.");
    } else {
      console.log("  Ungültige Auswahl.");
    }
  } finally {
    rl.close();
  }
}

// ── Entry ────────────────────────────────────────────────────────────────────

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd) {
    await interactiveMenu();
    return;
  }
  await runSubcommand(cmd, args);
}

main().catch((e) => {
  console.error("✗ " + (e && e.message ? e.message : e));
  process.exit(1);
});
