#!/usr/bin/env node
/**
 * build-lite-finanz.mjs — write the "Projekte & Kosten" block of lite/index.html
 * from finanz.json, between the <!-- lite-finanz:start --> / <!-- lite-finanz:end -->
 * markers, and stamp the section's "Stand" date from that file's `updated` field.
 *
 * Why this exists: the block used to be hand-maintained while build-lite-events.mjs
 * stamped the "Stand" date with new Date() on every deploy. The live page therefore
 * claimed today's date for figures that had not moved since 2026-06-19 — a false
 * freshness claim, not merely stale content. The date now comes from the same file
 * as the numbers, so the two cannot drift apart again.
 *
 * The math is NOT re-implemented here: percentages, ASCII bars and amount
 * formatting all come from finanz-core.js, the same module support.html renders
 * through, so the lite page can never disagree with the full page. Only the
 * markup is local — lite deliberately uses non-breaking spaces before "€" and
 * "%" where the full page does not.
 *
 * Run after editing finanz.json: pnpm run build:lite-finanz
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("../finanz-core.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const LITE = path.join(root, "lite", "index.html");
const FINANZ_JSON = path.join(root, "finanz.json");

const START = "<!-- lite-finanz:start -->";
const END = "<!-- lite-finanz:end -->";
const STAND_START = "<!-- lite-stand-date -->";
const STAND_END = "<!-- /lite-stand-date -->";

const NBSP = " ";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tighten the gap between a number and its unit into a non-breaking space, so a
 * narrow screen never wraps "250" and "€" onto separate lines. finanz-core.js
 * emits a normal space (the full page keeps it); this is a lite-only typographic
 * choice, applied here rather than changed in the shared module.
 */
function nb(s) {
  return String(s).replace(/ /g, NBSP);
}

/** "2026-06-19" → "19.06.2026". Anything else passes through untouched. */
export function formatStand(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate == null ? "" : isoDate));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(isoDate == null ? "" : isoDate);
}

/** The leading "<icon> <title>" of a card — the icon is optional. */
function titleLine(item, kindLabel) {
  const icon = item.icon ? esc(item.icon) + " " : "";
  const tagline = item.tagline ? ` · ${esc(item.tagline)}` : "";
  return (
    `<p class="projekt__t">${icon}${esc(item.title)} ` +
    `<span class="dim">· ${kindLabel}${tagline}</span></p>`
  );
}

/**
 * Render the whole block from a parsed finanz.json. Pure — no I/O, no clock —
 * so the tests can pin its exact bytes. One-time projects carry an ASCII bar
 * (drawn by finanz-core.js); recurring monthly costs have no target to reach and
 * therefore no bar, matching support.html.
 */
export function buildMarkup(finanz) {
  const currency = (finanz && finanz.currency) || "EUR";
  const einmalig = (finanz && finanz.einmalig) || [];
  const monatlich = (finanz && finanz.monatlich) || [];
  const blocks = [];

  for (const item of einmalig) {
    const view = Core.computeProject(item, { currency });
    const amounts = view.reached
      ? `${nb(Core.formatAmount(view.raised, currency))} / ${nb(
          Core.formatAmount(view.target, currency)
        )} · erreicht`
      : `${nb(Core.formatAmount(view.raised, currency))} / ${nb(
          Core.formatAmount(view.target, currency)
        )} · noch ${nb(Core.formatAmount(view.remaining, currency))}`;
    blocks.push(
      `<div class="projekt">\n` +
        titleLine(item, "einmalig") +
        `\n<p class="bar">` +
        `<span class="bar__f" aria-hidden="true">${view.bar.filled}</span>` +
        `<span class="bar__e" aria-hidden="true">${view.bar.empty}</span> ` +
        `<span class="bar__pct">${view.pct}${NBSP}%</span></p>\n` +
        `<p class="projekt__amt">${amounts}</p>\n` +
        `</div>`
    );
  }

  for (const item of monatlich) {
    blocks.push(
      `<div class="projekt">\n` +
        titleLine(item, "laufend") +
        `\n<p class="projekt__amt">${nb(
          Core.formatAmount(item.monthly, currency)
        )} / Monat — werde Unterstützer:in</p>\n` +
        `</div>`
    );
  }

  if (!blocks.length) {
    return `<p class="dim">Zurzeit keine offenen Projekte — <a href="../support.html#projekte">Unterstützen</a></p>`;
  }
  return blocks.join("\n\n");
}

/** Splice `markup` between the two markers of `html`. Throws if either is missing. */
export function inject(html, markup, stand) {
  const si = html.indexOf(START);
  const ei = html.indexOf(END);
  if (si === -1 || ei === -1) {
    throw new Error(`lite-finanz markers not found in ${LITE}`);
  }
  let out = html.slice(0, si + START.length) + "\n" + markup + "\n" + html.slice(ei);

  const sdi = out.indexOf(STAND_START);
  const edi = out.indexOf(STAND_END);
  if (stand && sdi !== -1 && edi !== -1) {
    out = out.slice(0, sdi + STAND_START.length) + stand + out.slice(edi);
  }
  return out;
}

function main() {
  if (!fs.existsSync(FINANZ_JSON)) {
    // Leave the page exactly as it is rather than wiping the block: a missing
    // data file is a build problem, not a reason to publish an empty section.
    console.error(`lite-finanz: ${FINANZ_JSON} not found — lite/index.html left untouched`);
    process.exitCode = 1;
    return;
  }
  const finanz = JSON.parse(fs.readFileSync(FINANZ_JSON, "utf8"));
  const html = fs.readFileSync(LITE, "utf8");
  const next = inject(html, buildMarkup(finanz), formatStand(finanz.updated));
  fs.writeFileSync(LITE, next, "utf8");
  console.log(
    `lite-finanz: injected ${(finanz.einmalig || []).length} one-time + ` +
      `${(finanz.monatlich || []).length} monthly item(s), Stand ${formatStand(finanz.updated)}`
  );
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
