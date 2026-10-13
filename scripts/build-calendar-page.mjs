#!/usr/bin/env node
/**
 * build-calendar-page.mjs — /calendar/, the one place that lists every way to
 * subscribe to the calendar. Run after the sync wrote events-data.json:
 *   node scripts/build-calendar-page.mjs [events-data.json]
 *
 * Why the page exists: subscription links pointed straight at the calendar
 * backend, so a backend change meant hunting links down page by page. This page
 * is built from configuration instead, so it follows a change on the next sync:
 *  - the complete calendar of each primary (rss:true) source, from its `ics` in
 *    calendars/ — every event, past and far ahead;
 *  - the feeds this site generates itself (/ical.ics, /feeds/…), from the `feeds`
 *    manifest in events-data.json. Their URLs never change, but they are a
 *    window: only the next ≤40 upcoming events, nothing past.
 * The old Nextcloud view link redirects here.
 *
 * Layout: two axes, so feeds that look alike can be told apart. A box per scope
 * — whose events — and in it a line per span: "↔ komplett" (the source's own
 * calendar) or "→ demnächst" (this site's window). Our own scopes come first,
 * in one panel: bitcircus101 alone, then the primary feed (/ical.ics), titled
 * by the rss:true sources it carries. Every other source and the all-in-one feed
 * follow in a second panel. Each line shows its address as text to copy.
 *
 * Same contract as build-event-pages.mjs: live-only (calendar/ is gitignored on
 * main), chrome lifted from the checkout's events.html, never fails the sync.
 * Unlike the archive it does not need the archive file — with no manifest it
 * still lists the primary feeds, so the redirect target is never a 404.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_URL, loadCalendars, writeFileAtomic } from "./sync-events.mjs";
import { extractChrome, headShell, jsonLdBlock, rebase, shell } from "./build-event-pages.mjs";
import { esc } from "./html-text.mjs";

const TEMPLATE_FILE = "events.html";
const DATA_FILE = "events-data.json";
const OUT_FILE = path.join("calendar", "index.html");
const CANONICAL = `${SITE_URL}/calendar/`;
// The source the first panel is about — the card-facing name, as in events.js.
const OWN = "bitcircus101";

// What the sync writes today; used when events-data.json is missing or carries
// no manifest, so the page always offers at least these.
const FALLBACK_FEEDS = {
  primary: { ics: "/ical.ics", rss: "/feed.xml" },
  all: { ics: "/feeds/all.ics", rss: "/feeds/all.xml" },
  sources: {},
};

// The two spans a line can have — the symbol leads, the legend explains it.
const SPANS = {
  complete: { mark: "↔", label: "komplett", hint: "alle Termine, auch vergangene und weit im Voraus geplante" },
  window: { mark: "→", label: "demnächst", hint: "nur kommende Termine – höchstens die nächsten 40" },
};

/** A URL or root-absolute path → the absolute https URL and its webcal twin. */
export function feedUrls(p) {
  const https = new URL(p, SITE_URL).href;
  return { https, webcal: https.replace(/^https?:\/\//, "webcal://") };
}

/** The manifest from events-data.json, or the fallback when it has none. */
export function manifestOf(data) {
  const feeds = data && data.feeds;
  if (!feeds || !feeds.primary || !feeds.primary.ics) return FALLBACK_FEEDS;
  return feeds;
}

/** The complete calendars to list: the primary (rss:true) sources' own ICS. */
export function completeCalendars(calendars) {
  return (calendars || [])
    .filter((c) => c && c.rss === true && typeof c.ics === "string" && /^https?:\/\//i.test(c.ics))
    .map((c) => ({ name: c.name || c.id, ics: c.ics }));
}

/**
 * What the page lists, before any markup: { own, others }, each a list of boxes
 * { title, note?, lines: [{ span, ics, rss?, primary? }] }. Exactly one line is
 * primary — our complete calendar, the button most visitors want (without one,
 * the first line of our panel).
 */
export function planCalendarPage(feeds, calendars = []) {
  const cals = (calendars || []).filter((c) => c && c.name);
  const complete = new Map(completeCalendars(cals).map((c) => [c.name, c.ics]));
  const sources = Object.values(feeds.sources || {}).filter((s) => s && s.ics && s.name);
  const windowOf = (name) => sources.find((s) => s.name === name);
  const box = (name) => {
    const w = windowOf(name);
    return {
      title: name,
      lines: [
        complete.has(name) && { span: "complete", ics: complete.get(name) },
        w && { span: "window", ics: w.ics, rss: w.rss },
      ].filter(Boolean),
    };
  };

  const primaryLine = { span: "window", ics: feeds.primary.ics, rss: feeds.primary.rss };
  const primaryNames = cals.filter((c) => c.rss === true).map((c) => c.name);
  const own = [];
  const ownBox = box(OWN);
  if (primaryNames.length === 1 && primaryNames[0] === OWN) {
    // The primary feed carries nothing but ours — same events as our source
    // feed, so it takes that line instead of a second box titled alike.
    ownBox.lines = ownBox.lines.filter((l) => l.span !== "window").concat(primaryLine);
    own.push(ownBox);
  } else {
    if (ownBox.lines.length) own.push(ownBox);
    own.push({ title: primaryNames.length ? primaryNames.join(" + ") : OWN, lines: [primaryLine] });
  }

  // Config order first, then whatever only the manifest knows.
  const names = [...new Set([...cals.map((c) => c.name), ...sources.map((s) => s.name)])];
  const others = names.filter((n) => n !== OWN).map(box).filter((b) => b.lines.length);
  if (feeds.all && feeds.all.ics) {
    const inAll = sources.length ? sources.map((s) => s.name) : names;
    others.push({
      title: "alle zusammen",
      note: inAll.length ? inAll.join(" + ") : null,
      lines: [{ span: "window", ics: feeds.all.ics, rss: feeds.all.rss }],
    });
  }

  const first = own.flatMap((b) => b.lines);
  (first.find((l) => l.span === "complete") || first[0]).primary = true;
  return { own, others };
}

/** An address as text, breakable before each path slash rather than mid-word. */
function urlText(https) {
  const m = https.match(/^(https?:\/\/[^/]*)(.*)$/);
  if (!m) return esc(https);
  return esc(m[1]) + esc(m[2]).replace(/\//g, "<wbr>/");
}

/** One line: span label, the address to copy, then rss and webcal buttons. */
function lineHtml(title, l) {
  const span = SPANS[l.span];
  const ics = feedUrls(l.ics);
  const rss = l.rss ? feedUrls(l.rss).https : null;
  const name = esc(`${title} – ${span.label}`);
  const cta = l.primary ? " events-subscribe__btn--primary" : "";
  return [
    `                    <div class="calendar-feed__line">`,
    `                        <span class="calendar-feed__span" title="${esc(span.hint)}"><span aria-hidden="true">${span.mark}</span> ${span.label}</span>`,
    `                        <code class="calendar-feed__url">${urlText(ics.https)}</code>`,
    `                        <span class="events-subscribe__actions">`,
    rss ? `                            <a class="events-subscribe__btn" href="${esc(rss)}" aria-label="RSS-Feed: ${name}">rss</a>` : "",
    `                            <a class="events-subscribe__btn${cta}" href="${esc(ics.webcal)}" aria-label="${name} abonnieren">&#8595; abonnieren</a>`,
    `                        </span>`,
    `                    </div>`,
  ].filter(Boolean);
}

function boxHtml(b) {
  return [
    `                <div class="events-subscribe calendar-feed">`,
    `                    <h3 class="events-subscribe__title">${esc(b.title)}</h3>`,
    b.note ? `                    <p class="calendar-feed__note">${esc(b.note)}</p>` : "",
    ...b.lines.flatMap((l) => lineHtml(b.title, l)),
    `                </div>`,
  ].filter(Boolean);
}

function panelHtml(id, title, label, boxes) {
  return [
    ``,
    `            <section id="${id}" class="panel">`,
    `                <h2>${esc(title)}<a class="section-anchor" href="#${id}" aria-label="Link zu: ${esc(label)}">#</a></h2>`,
    ...boxes.flatMap(boxHtml),
    `            </section>`,
  ];
}

export function renderCalendarPage(feeds, chrome, calendars = []) {
  const { own, others } = planCalendarPage(feeds, calendars);
  const legend = (key) => `<span aria-hidden="true">${SPANS[key].mark}</span> ${SPANS[key].label}`;
  const parts = [
    `            <section id="calendar">`,
    `                <p class="doc-path"><a href="../index.html">~</a> /calendar</p>`,
    `                <h1>Kalender abonnieren<a class="section-anchor" href="#calendar" aria-label="Link zu: Kalender abonnieren">#</a></h1>`,
    `                <p>`,
    `                    Ein Abo holt die Termine in deine Kalender-App und hält sie von allein`,
    `                    aktuell – für die meisten reicht der hervorgehobene Knopf. Noch die alte`,
    `                    Nextcloud-Adresse abonniert? Einmal hier neu abonnieren. Ändert sich`,
    `                    eine Adresse, steht es zuerst auf dieser Seite.`,
    `                </p>`,
    `            </section>`,
    ...panelHtml("bitcircus101", "bitcircus101", "bitcircus101", own),
    ...(others.length ? panelHtml("weitere", "weitere kalender", "Weitere Kalender", others) : []),
    ``,
    `            <section id="wie" class="panel">`,
    `                <h2>wie abonnieren<a class="section-anchor" href="#wie" aria-label="Link zu: Wie abonnieren">#</a></h2>`,
    `                <dl class="man">`,
    `                    <dt>${legend("complete")}</dt>`,
    `                    <dd>Alle Termine, auch vergangene und weit im Voraus geplante – direkt aus dem Originalkalender.</dd>`,
    `                    <dt>${legend("window")}</dt>`,
    `                    <dd>`,
    `                        Nur kommende Termine – höchstens die nächsten 40, über alle Kalender gezählt.`,
    `                        Die Website erzeugt das alle 30 Minuten neu.`,
    `                    </dd>`,
    `                    <dt><span aria-hidden="true">&#8595;</span> abonnieren</dt>`,
    `                    <dd>Öffnet die Kalender-App auf deinem Gerät (Apple Kalender, Thunderbird, Outlook).</dd>`,
    `                    <dt>https://…</dt>`,
    `                    <dd>Die Adresse zum Kopieren – in Google Kalender oder Nextcloud als Abo „per URL“ hinzufügen.</dd>`,
    `                    <dt>rss</dt>`,
    `                    <dd>Dieselben Termine für den Feed-Reader, alle Feeds auf <a href="../rss.html">/rss</a>.</dd>`,
    `                </dl>`,
    `                <p>`,
    `                    Nur ein Schlagwort? Auf <a href="../events.html#kalender">/termine</a> filtern –`,
    `                    die Abo-Knöpfe dort folgen dem Filter.`,
    `                </p>`,
    `            </section>`,
  ];

  const assetVersion = chrome.assetVersion;
  return shell({
    head: headShell({
      depth: 1,
      assetVersion,
      title: "Kalender abonnieren – bitcircus101",
      description:
        "Die Termine des bitcircus101, Hackspace in Bonn, als Kalender-Abo (iCal/webcal) und RSS – alle Abo-Adressen an einem Ort.",
      canonical: CANONICAL,
      robots: "index, follow",
      alternates: [
        { type: "application/rss+xml", title: "bitcircus101 Termine", href: "../feed.xml" },
        { type: "text/calendar", title: "bitcircus101 Termine (iCal)", href: "../ical.ics" },
      ],
      jsonLd: jsonLdBlock({ "@type": "WebPage", name: "Kalender abonnieren – bitcircus101", url: CANONICAL }),
    }),
    header: rebase(chrome.header, 1),
    footer: rebase(chrome.footer, 1),
    body: parts.join("\n"),
    depth: 1,
    assetVersion,
  });
}

function main() {
  const dataFile = process.argv[2] || DATA_FILE;
  let template;
  try {
    template = fs.readFileSync(TEMPLATE_FILE, "utf8");
  } catch (err) {
    console.warn(`::warning::calendar-page: ${TEMPLATE_FILE} unreadable (${err.message}) — no page written`);
    return;
  }
  const chrome = extractChrome(template);
  if (!chrome) {
    console.warn(`::warning::calendar-page: ${TEMPLATE_FILE} has no <header>/<footer>/style.css?v= — no page written`);
    return;
  }

  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (err) {
    console.warn(`::warning::calendar-page: ${dataFile} unreadable (${err.message}) — listing the primary feeds only`);
  }
  let calendars = [];
  try {
    calendars = loadCalendars();
  } catch (err) {
    console.warn(`::warning::calendar-page: calendars/ unreadable (${err.message}) — no complete-calendar links`);
  }
  const feeds = manifestOf(data);
  const html = renderCalendarPage(feeds, chrome, calendars);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  let existing = null;
  try {
    existing = fs.readFileSync(OUT_FILE, "utf8");
  } catch { /* new file */ }
  if (existing !== html) writeFileAtomic(OUT_FILE, html);
  console.log(
    `calendar-page: ${OUT_FILE} with ${completeCalendars(calendars).length} complete calendar(s), ` +
      `${Object.keys(feeds.sources || {}).length} source feed(s)`
  );
}

// Only run when invoked directly — importing this from a test must not write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
