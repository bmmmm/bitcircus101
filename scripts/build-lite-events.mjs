#!/usr/bin/env node
/**
 * Inject upcoming bitcircus101 events into lite/index.html between
 * <!-- lite-events:start --> and <!-- lite-events:end --> markers.
 * Run after syncing events-data.json: pnpm run build:lite-events
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const LITE = path.join(root, "lite", "index.html");
const EVENTS_JSON = path.join(root, "events-data.json");

const START = "<!-- lite-events:start -->";
const END = "<!-- lite-events:end -->";
const MAX_EVENTS = 8;

const DAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
const MONTHS = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = DAYS[dt.getDay()];
  const month = MONTHS[m - 1];
  const time = timeStr ? ` · ${timeStr}` : "";
  return `${day} ${d}. ${month}${time}`;
}

function buildMarkup(events) {
  if (!events.length) {
    return `<p class="dim">Keine Termine eingetragen — <a href="../events.html">Veranstaltungen</a></p>`;
  }
  const items = events
    .map((e) => `<li><span class="dim">${formatDate(e.date, e.time)}</span> — ${esc(e.title)}</li>`)
    .join("\n");
  return `<ul>\n${items}\n</ul>\n<p class="dim">→ <a href="../events.html">Alle Termine &amp; Kalender-Abo</a></p>`;
}

function main() {
  const now = new Date();
  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  let upcoming = [];
  if (fs.existsSync(EVENTS_JSON)) {
    const data = JSON.parse(fs.readFileSync(EVENTS_JSON, "utf8"));
    const all = data.events || [];
    upcoming = all
      .filter((e) => e.source === "bitcircus101" && e.date >= todayStr)
      .sort((a, b) => {
        const ka = a.date + (a.time || "");
        const kb = b.date + (b.time || "");
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      })
      .slice(0, MAX_EVENTS);
  }

  const markup = buildMarkup(upcoming);
  let html = fs.readFileSync(LITE, "utf8");

  const si = html.indexOf(START);
  const ei = html.indexOf(END);
  if (si === -1 || ei === -1) {
    throw new Error(`lite-events markers not found in ${LITE}`);
  }

  html = html.slice(0, si + START.length) + "\n" + markup + "\n" + html.slice(ei);
  fs.writeFileSync(LITE, html, "utf8");
  console.log(`lite-events: injected ${upcoming.length} event(s) into lite/index.html`);
}

main();
