/**
 * Unit tests for scripts/build-event-pages.mjs — the generator that writes the
 * per-event pages under /e/<id>/ (a stub once the event is past). Runs with:
 *   node --test tests/event-pages.spec.mjs
 * No browser, no network; the only writes go to a tmp dir (the main() round-trip
 * at the bottom runs the script with its cwd there, never in the checkout).
 *
 * What is actually at stake here, and why each block exists:
 *  - the pages carry calendar text anyone in the space can write, so escaping
 *    and linkify are a security boundary, not cosmetics;
 *  - the chrome is cut out of the tracked events.html at build time, so a
 *    template change that breaks the cut has to fail THIS pull request rather
 *    than the hourly sync on live;
 *  - every link in that chrome was written for a page at the site root, so the
 *    rebase is what keeps navigation working two levels down.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  esc,
  linkify,
  paragraphs,
  rebase,
  extractChrome,
  renderWhen,
  renderHead,
  renderEventPage,
  renderPastPage,
  planPages,
  berlinToday,
} from "../scripts/build-event-pages.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TODAY = "2026-09-13";

// A chrome fixture, not the real one: the render tests must fail for their own
// reason, not because somebody edited the nav. The real events.html is checked
// separately, at the bottom.
const CHROME = {
  header:
    '<header><nav><a class="nav__brand" href="index.html">bitcircus101</a>' +
    '<a href="events.html">/termine</a><a href="#main">skip</a>' +
    '<a href="/robots.txt">robots</a><a href="https://example.org/x">ext</a>' +
    '<a href="mailto:hi@example.org">mail</a><a href="//cdn.example.org/a.png">pr</a>' +
    '<img src="images/logo.svg" srcset="images/logo.svg 1x, images/logo@2x.png 2x" />' +
    '<a href="lite/">lite</a></nav></header>',
  footer: '<footer class="footer"><a href="feed.xml">rss</a><a href="impressum-datenschutz.html">impressum</a></footer>',
  assetVersion: "ab12cd34",
};

const entry = (extra = {}) => ({
  id: "0a1b2c3d4e5f",
  title: "Vortrag: Öffentliche Dateninfrastruktur",
  subtitle: "",
  description: "Erster Absatz.\n\nZweiter Absatz mit https://example.org/pfad. Ende.",
  location: "Dorotheenstraße 101, 53113 Bonn",
  date: "2026-09-18",
  time: "20:30",
  endDate: "2026-09-18",
  endTime: "21:15",
  tags: ["#vortrag", "#daten"],
  type: "special",
  source: "bitcircus101",
  uid: "uid-1@example.org",
  calendarUrl: "https://cloud.example.org/apps/calendar/p/abc",
  firstSeen: "2026-08-01T10:00:00.000Z",
  lastSeen: "2026-09-12",
  ...extra,
});
// source name → relation, as events-core relationMap builds it from calendars/
const REL = { bitcircus101: "own", "Look at my toys!": "home", datenburg: "friend" };

/**
 * cache-bust.mjs stamps ?v= on exactly the assets it lists — a script a page
 * references but the list omits keeps its old hash after a deploy and is served
 * stale for the CDN's TTL. Read, never import: that module rewrites every HTML
 * file in the tree at import time.
 */
function cacheBustAssets() {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "cache-bust.mjs"), "utf8");
  const block = /const ASSETS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(block, "cache-bust.mjs no longer declares `const ASSETS = [...]` — this check is blind");
  const list = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(list.length > 5, `only ${list.length} assets parsed out of cache-bust.mjs`);
  return new Set(list);
}

describe("rebase — the chrome was written for a page at the site root", () => {
  it("prefixes relative href/src by the page depth", () => {
    const two = rebase(CHROME.header, 2);
    assert.match(two, /href="\.\.\/\.\.\/index\.html"/);
    assert.match(two, /href="\.\.\/\.\.\/events\.html"/);
    assert.match(two, /src="\.\.\/\.\.\/images\/logo\.svg"/);
    assert.match(two, /href="\.\.\/\.\.\/lite\/"/);

    const one = rebase(CHROME.header, 1);
    assert.match(one, /href="\.\.\/index\.html"/);
    assert.ok(!one.includes("../../"), "depth 1 must not emit two levels");
  });

  it("leaves absolute, in-page, scheme and protocol-relative targets alone", () => {
    const out = rebase(CHROME.header, 2);
    assert.ok(out.includes('href="/robots.txt"'), "root-absolute rewritten");
    assert.ok(out.includes('href="#main"'), "in-page anchor rewritten");
    assert.ok(out.includes('href="https://example.org/x"'), "external URL rewritten");
    assert.ok(out.includes('href="mailto:hi@example.org"'), "mailto rewritten");
    assert.ok(out.includes('href="//cdn.example.org/a.png"'), "protocol-relative rewritten");
    for (const v of ["webcal://a/b.ics", "tel:+4922812345", "data:image/svg+xml,%3Csvg/%3E"]) {
      assert.equal(rebase(`<a href="${v}">x</a>`, 2), `<a href="${v}">x</a>`);
    }
  });

  it("rebases every candidate of a srcset, descriptors intact", () => {
    const out = rebase(CHROME.header, 2);
    assert.match(out, /srcset="\.\.\/\.\.\/images\/logo\.svg 1x, \.\.\/\.\.\/images\/logo@2x\.png 2x"/);
  });
});

describe("linkify — calendar text is untrusted input", () => {
  it("escapes before it links, so markup in the text stays text", () => {
    const out = linkify('<b>x</b> & "y" </script><script>alert(1)</script>');
    assert.ok(!out.includes("<b>"), "raw tag survived");
    assert.ok(!out.includes("</script>"), "raw </script> survived");
    assert.match(out, /&lt;b&gt;x&lt;\/b&gt; &amp; &quot;y&quot;/);
  });

  it("links http(s) only — javascript: and data: stay text", () => {
    const out = linkify("siehe https://example.org/a?x=1&y=2 oder javascript:alert(1) oder data:text/html,x");
    assert.match(out, /<a href="https:\/\/example\.org\/a\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">/);
    assert.ok(!out.includes('href="javascript:'), "javascript: became a link");
    assert.ok(!out.includes('href="data:'), "data: became a link");
  });

  it("keeps sentence punctuation out of the href", () => {
    const out = linkify("mehr auf https://example.org/pfad.");
    assert.match(out, /href="https:\/\/example\.org\/pfad"/);
    assert.match(out, /<\/a>\.$/);
  });
});

describe("paragraphs", () => {
  it("splits on blank lines, keeps single newlines as <br>", () => {
    const out = paragraphs("Eins\nnoch eins\n\nZwei");
    assert.equal(out, "<p>Eins<br />noch eins</p>\n<p>Zwei</p>");
  });

  it("drops the trailing hashtag line — it is already rendered as chips", () => {
    const out = paragraphs("Text\n\n#vortrag #daten");
    assert.equal(out, "<p>Text</p>");
  });

  it("is empty for an empty description", () => {
    assert.equal(paragraphs(""), "");
    assert.equal(paragraphs(undefined), "");
  });
});

describe("renderWhen", () => {
  it("renders a machine-readable start and end for a timed event", () => {
    const out = renderWhen(entry());
    assert.match(out, /datetime="2026-09-18T20:30"/);
    assert.match(out, /datetime="2026-09-18T21:15"/);
    assert.match(out, /Freitag, 18\. September 2026, 20:30/);
    assert.match(out, /21:15<\/time> Uhr/);
  });

  it("drops the clock for an all-day event and shows the inclusive last day", () => {
    // endDate is the ICS DTEND: exclusive. 20th exclusive = 19th inclusive.
    const out = renderWhen(entry({ time: "", endTime: "", endDate: "2026-09-20" }));
    assert.ok(!out.includes("Uhr"), "all-day event printed a clock");
    assert.match(out, /datetime="2026-09-18"/);
    assert.match(out, /datetime="2026-09-19"/);
    assert.match(out, /Samstag, 19\. September 2026/);
    // A single all-day event (DTEND = next day) must not render as a range.
    const single = renderWhen(entry({ time: "", endTime: "", endDate: "2026-09-19" }));
    assert.ok(!single.includes("–"), `single all-day event rendered as a range: ${single}`);
  });
});

describe("renderHead", () => {
  it("names the clean canonical URL and indexes a live event", () => {
    const head = renderHead(entry(), { assetVersion: "ab12cd34" });
    assert.match(head, /<link rel="canonical" href="https:\/\/bitcircus101\.de\/e\/0a1b2c3d4e5f\/" \/>/);
    assert.match(head, /<meta property="og:url" content="https:\/\/bitcircus101\.de\/e\/0a1b2c3d4e5f\/" \/>/);
    assert.match(head, /<meta name="robots" content="index, follow" \/>/);
    assert.match(head, /href="\.\.\/\.\.\/style\.css\?v=ab12cd34"/);
    assert.match(head, /rel="alternate" type="text\/calendar"[^>]*href="event\.ics"/);
    assert.match(head, /rel="alternate" type="application\/rss\+xml"[^>]*href="\.\.\/\.\.\/feed\.xml"/);
  });

  it("marks a cancelled event noindex and EventCancelled", () => {
    const head = renderHead(entry({ cancelled: true }), { assetVersion: "v" });
    assert.match(head, /<meta name="robots" content="noindex, follow" \/>/);
    assert.match(head, /"eventStatus": "https:\/\/schema\.org\/EventCancelled"/);
  });

  it("keeps the meta description within what a result page renders", () => {
    const long = "Wort ".repeat(200);
    const head = renderHead(entry({ description: long }), { assetVersion: "v" });
    const desc = /<meta name="description" content="([^"]*)" \/>/.exec(head);
    assert.ok(desc, "no meta description emitted");
    assert.ok(desc[1].length <= 165, `meta description is ${desc[1].length} chars: ${desc[1]}`);
    assert.ok(desc[1].endsWith("…"), "a truncated description must say so");
    // An event without a description still needs one — the link preview is the
    // whole point of these pages.
    const bare = renderHead(entry({ description: "" }), { assetVersion: "v", relations: REL });
    const fallback = /<meta name="description" content="([^"]*)" \/>/.exec(bare);
    assert.ok(fallback[1].length > 20, `empty fallback description: ${fallback[1]}`);
    assert.doesNotMatch(fallback[1], /\(/, "our own events name no source");
    // Another calendar with its own pages names itself in the fallback.
    const partner = renderHead(entry({ description: "", source: "Look at my toys!" }), { assetVersion: "v", relations: REL });
    assert.match(partner, /<meta name="description" content="[^"]*\(Look at my toys!\) am /);
    // Without calendars/ (no relations) nothing is named rather than something wrong.
    const blind = renderHead(entry({ description: "", source: "Look at my toys!" }), { assetVersion: "v" });
    assert.doesNotMatch(blind, /\(Look at my toys!\)/);
  });

  it("never lets a '<' out raw inside the JSON-LD block", () => {
    const head = renderHead(
      entry({ title: "Bad </script><script>alert(1)</script>", description: "<b>x</b> javascript:alert(1)" }),
      { assetVersion: "v" }
    );
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head);
    assert.ok(block, "no JSON-LD block");
    assert.ok(!block[1].includes("<"), "raw < inside the JSON-LD would end the script element");
    assert.match(block[1], /\\u003cscript/);
    assert.doesNotThrow(() => JSON.parse(block[1]), "JSON-LD is not valid JSON");
  });
});

describe("renderEventPage", () => {
  const html = renderEventPage(entry(), CHROME, TODAY);

  it("renders the event itself: heading, time, place, tags", () => {
    assert.match(html, /<h1>Vortrag: Öffentliche Dateninfrastruktur<\/h1>/);
    assert.match(html, /<time datetime="2026-09-18T20:30">/);
    assert.match(
      html,
      /href="https:\/\/www\.openstreetmap\.org\/search\?query=Dorotheenstra%C3%9Fe%20101%2C%2053113%20Bonn" target="_blank" rel="noopener noreferrer"/
    );
    assert.match(html, /href="\.\.\/\.\.\/events\.html\?tags=vortrag"[^>]*>#vortrag</);
    assert.match(html, /<p>Erster Absatz\.<\/p>/);
    assert.match(html, /<a href="https:\/\/example\.org\/pfad"/);
  });

  it("offers the three actions, each pointing where it claims", () => {
    assert.match(html, /href="https:\/\/cloud\.example\.org\/apps\/calendar\/p\/abc\/timeGridDay\/2026-09-18"[^>]*>→ kalender</);
    assert.match(html, /href="event\.ics"[^>]*>↓ ics</);
    assert.match(html, /href="\.\.\/\.\.\/events\.html">← alle termine</);
    assert.ok(!html.includes("archiv/"), "the archive index is gone");
    // An external event URL wins over the calendar day view, and says so.
    const ext = renderEventPage(entry({ eventUrl: "kult41.net/termin" }), CHROME, TODAY);
    assert.match(ext, /href="https:\/\/kult41\.net\/termin"[^>]*>→ extern</);
    assert.ok(!ext.includes("→ kalender"), "an external site is not a calendar");
  });

  it("carries the rebased chrome and nothing that throws on this page", () => {
    assert.match(html, /<a class="nav__brand" href="\.\.\/\.\.\/index\.html">/);
    assert.match(html, /<footer class="footer">/);
    assert.match(html, /<a class="skip-link" href="#main-content">/);
    assert.ok(!html.includes("linkup-info-btn"), "template's trailing inline script leaked in");
    assert.ok(!html.includes("events-data.json"), "template's preload leaked in");
  });

  it("emits only scripts the cache-bust list stamps", () => {
    const assets = cacheBustAssets();
    const refs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      refs.map((r) => r.replace(/^(\.\.\/)+/, "").replace(/\?.*$/, "")),
      ["storage.js", "main.js"]
    );
    for (const ref of refs) {
      const bare = ref.replace(/^(\.\.\/)+/, "").replace(/\?.*$/, "");
      assert.ok(assets.has(bare), `${bare} is referenced with ?v= but missing from cache-bust ASSETS`);
      assert.match(ref, /\?v=ab12cd34$/, `${ref} does not carry the template's asset version`);
    }
    const css = /<link rel="stylesheet" href="([^"]+)"/.exec(html);
    assert.ok(assets.has(css[1].replace(/^(\.\.\/)+/, "").replace(/\?.*$/, "")));
  });

  it("has no inline style attribute anywhere — the repo rule, and nothing lints scripts/", () => {
    assert.ok(!/\sstyle="/.test(html), "generated page carries an inline style attribute");
  });

  it("says when an upcoming event is cancelled", () => {
    const dead = renderEventPage(entry({ cancelled: true, cancelledBy: "vanished" }), CHROME, TODAY);
    assert.match(dead, /class="event-page__notice">Dieser Termin ist nicht mehr im Kalender\.</);
    const legacy = renderEventPage(entry({ cancelled: true }), CHROME, TODAY); // archive written before cancelledBy existed
    assert.match(legacy, /class="event-page__notice">Dieser Termin ist nicht mehr im Kalender\.</);
    const marked = renderEventPage(entry({ title: "CANCELED: Vortrag", cancelled: true, cancelledBy: "title" }), CHROME, TODAY);
    assert.match(marked, /class="event-page__notice">Dieser Termin ist abgesagt\.</);
    assert.ok(!marked.includes("nicht mehr im Kalender"), "a marked title is still in the calendar");

    const upcoming = renderEventPage(entry(), CHROME, TODAY);
    assert.ok(!upcoming.includes("event-page__past"), "an upcoming event was called past");
  });

  // The series left the calendar (mergeArchive `removed`): the page stays for
  // the links out there, but says neither "abgesagt" nor offers an ics.
  it("says a removed series' date left the calendar — not cancelled, no ics", () => {
    const html = renderEventPage(entry({ removed: true }), CHROME, TODAY);
    assert.match(html, /class="event-page__notice">Dieser Termin steht nicht mehr in unserem Kalender – was ansteht, steht unter <a href="\.\.\/\.\.\/events\.html">\/termine<\/a>\.</);
    assert.ok(!/abgesagt|EventCancelled|event\.ics/.test(html), "a removed date reads as cancelled or offers an ics");
    assert.match(html, /<meta name="robots" content="noindex, follow" \/>/);
    const past = renderEventPage(entry({ date: "2026-09-01", removed: true }), CHROME, TODAY);
    assert.match(past, /class="event-page__past">Dieser Termin wurde aus unserem Kalender genommen\.</);
    const files = planPages({ events: { r: entry({ id: "r", removed: true }), k: entry({ id: "k" }) } }, CHROME, TODAY);
    assert.deepEqual(files.map((f) => f.path), ["e/k/event.ics", "e/k/index.html", "e/r/index.html"]);
  });

  it("turns a past event into a stub that says only whether it took place", () => {
    const leaks = ["Vortrag", "Dateninfrastruktur", "Absatz", "Dorotheenstra", "vortrag", "event.ics", "ld+json"];
    const past = renderEventPage(entry({ date: "2026-09-01" }), CHROME, TODAY);
    assert.equal(past, renderPastPage(entry({ date: "2026-09-01" }), CHROME));
    assert.match(past, /<h1>Termin vom <time datetime="2026-09-01">Dienstag, 1\. September 2026<\/time><\/h1>/);
    assert.match(past, /class="event-page__past">Dieser Termin hat stattgefunden\.</);
    assert.match(past, /<title>Termin vom 01\.09\.2026 – bitcircus101<\/title>/);
    assert.match(past, /<meta name="robots" content="noindex, follow" \/>/);
    assert.match(past, /<link rel="canonical" href="https:\/\/bitcircus101\.de\/e\/0a1b2c3d4e5f\/" \/>/);
    assert.match(past, /href="\.\.\/\.\.\/events\.html">← alle termine</);
    assert.match(past, /href="\.\.\/\.\.\/status\.html">status →</);
    const dead = renderEventPage(entry({ date: "2026-09-01", cancelled: true, cancelledBy: "vanished" }), CHROME, TODAY);
    assert.match(dead, /class="event-page__notice">Dieser Termin wurde abgesagt\.</);
    for (const html of [past, dead]) {
      for (const leak of leaks) assert.ok(!html.includes(leak), `a past page leaks ${leak}`);
      assert.ok(!/\sstyle="/.test(html), "a stub carries an inline style attribute");
    }
    // the day itself still gets the full page
    assert.match(renderEventPage(entry({ date: TODAY }), CHROME, TODAY), /<h1>Vortrag: Öffentliche Dateninfrastruktur<\/h1>/);
  });

  it("escapes hostile calendar data everywhere it lands", () => {
    const out = renderEventPage(
      entry({
        title: 'Bad </script><script>alert(1)</script>',
        location: '"><img src=x onerror=alert(1)>',
        tags: ["#<script>"],
        description: "<b>x</b>\n\njavascript:alert(1)",
      }),
      CHROME,
      TODAY
    );
    assert.ok(!out.includes("<script>alert(1)"), "injected script tag reached the page");
    // The payload may appear as text — escaped, it is inert. What must never
    // appear is the tag that carries it.
    assert.ok(!out.includes("<img src=x"), "injected <img> reached the page as markup");
    assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.ok(!out.includes("<b>x</b>"), "raw markup from the description reached the page");
    assert.ok(!out.includes('href="javascript:'), "javascript: became a link");
    // Exactly the two <script> elements this generator emits, no third one.
    assert.equal([...out.matchAll(/<script\b/g)].length, 4, "unexpected number of <script> elements");
  });

  // Another group's event says whose it is above everything else and links
  // their site — the small "Kalender: X" line went unnoticed.
  it("names another group's event and leads to their site; stays quiet for our own", () => {
    const SITES = { "Look at my toys!": "https://my.stim.toys/workshops", datenburg: "https://datenburg.org" };
    const ext = renderEventPage(entry({ source: "datenburg" }), CHROME, TODAY, REL, [], SITES);
    assert.match(ext, /<p class="event-page__origin">externer Termin von <strong>datenburg<\/strong> — mehr dazu bei <a href="https:\/\/datenburg\.org" target="_blank" rel="noopener noreferrer">datenburg\.org ↗<\/a><\/p>/);
    const home = renderEventPage(entry({ source: "Look at my toys!" }), CHROME, TODAY, REL, [], SITES);
    assert.match(home, /<p class="event-page__origin">veranstaltet von <strong>Look at my toys!<\/strong> — mehr dazu bei <a href="https:\/\/my\.stim\.toys\/workshops"[^>]*>my\.stim\.toys\/workshops ↗<\/a><\/p>/);
    // above the when/where block, so it reads first
    assert.ok(home.indexOf("event-page__origin") < home.indexOf("event-page__meta"));
    const own = renderEventPage(entry(), CHROME, TODAY, REL, [], SITES);
    assert.ok(!own.includes("event-page__origin"), "our own calendar got an origin line");
    assert.ok(!html.includes("event-page__origin"), "without relations, nothing is labelled");
  });
});

describe("planPages", () => {
  const archive = {
    version: 1,
    events: { a1: entry({ id: "a1" }), b2: entry({ id: "b2", date: "2026-09-01", time: "" }) },
  };
  const files = planPages(archive, CHROME, TODAY);

  it("plans a page for every entry, an ics only while it is upcoming", () => {
    assert.deepEqual(
      files.map((f) => f.path),
      ["e/a1/event.ics", "e/a1/index.html", "e/b2/index.html"]
    );
  });

  it("writes the full description into the ics, newlines escaped", () => {
    const ics = files.find((f) => f.path === "e/a1/event.ics").data;
    assert.match(ics, /BEGIN:VEVENT/);
    assert.match(ics, /DESCRIPTION:Erster Absatz\.\\n\\nZweiter/);
    assert.ok(!/DESCRIPTION:[^\r\n]*\n[^ ]/.test(ics), "a raw newline broke the DESCRIPTION line");
  });

  it("refuses an id that would escape the output directory", () => {
    const bad = planPages({ events: { x: entry({ id: "../../etc/passwd" }) } }, CHROME, TODAY);
    assert.deepEqual(bad, []);
  });

  // A series' page lists its other upcoming dates: the next four, linked,
  // with the rhythm — past, vanished and other series' dates stay out.
  it("lists a series' other upcoming dates on each of its pages", () => {
    const weekly = (day, extra = {}) =>
      entry({ id: `w${day}`, date: `2026-09-${day}`, endDate: `2026-09-${day}`, uid: "weekly@x", recurring: true, ...extra });
    const events = {};
    for (const e of [
      weekly("08"), // past (TODAY is the 13th)
      weekly("15"),
      weekly("22", { title: "CANCELED: Vortrag", cancelled: true, cancelledBy: "title" }),
      weekly("29"),
      weekly("30", { cancelled: true, cancelledBy: "vanished" }), // gone from the calendar
      weekly("30", { id: "w30r", removed: true }), // its series left the calendar
      entry({ id: "o06", date: "2026-10-06", endDate: "2026-10-06", uid: "weekly@x", recurring: true, source: "Andere" }),
      weekly("31", { id: "w1006", date: "2026-10-06", endDate: "2026-10-06" }),
      weekly("31", { id: "w1013", date: "2026-10-13", endDate: "2026-10-13" }),
      weekly("31", { id: "w1020", date: "2026-10-20", endDate: "2026-10-20" }),
      entry({ id: "solo" }),
    ]) events[e.id] = e;
    const page = (id) => planPages({ events }, CHROME, TODAY).find((f) => f.path === `e/${id}/index.html`).data;
    const listed = (html) => [...html.matchAll(/<li><a href="\.\.\/([^/]+)\/">/g)].map((m) => m[1]);

    const p15 = page("w15");
    assert.deepEqual(listed(p15), ["w22", "w29", "w1006", "w1013"], "the next four, itself left out");
    assert.match(p15, /<h2 class="event-page__series-title">Weitere Termine <span class="event-page__rhythm">· jeden Dienstag<\/span><\/h2>/);
    assert.match(p15, /<li><a href="\.\.\/w22\/"><s><time datetime="2026-09-22T20:30">Dienstag, 22\. September 2026, 20:30 Uhr<\/time><\/s><\/a> <span class="event-card__cancelled">/);
    assert.deepEqual(listed(page("w1020")), ["w15", "w22", "w29", "w1006"]);
    assert.ok(!page("solo").includes("Weitere Termine"), "a one-off lists nothing");
    assert.ok(!page("w08").includes("Weitere Termine"), "a past stub lists nothing");
  });
});

describe("extractChrome — against the tracked events.html", () => {
  // The generator cuts its header and footer out of this exact file at build
  // time. If somebody restructures the page, this pull request goes red instead
  // of the sync on live silently shipping pages without navigation.
  const template = fs.readFileSync(path.join(ROOT, "events.html"), "utf8");

  it("finds header, footer and the asset version in the real page", () => {
    const chrome = extractChrome(template);
    assert.ok(chrome, "events.html no longer yields header/footer/style.css?v= — the generator would write nothing");
    assert.match(chrome.header, /^<header[\s>]/);
    assert.match(chrome.header, /<\/header>$/);
    assert.match(chrome.header, /id="main-nav"/);
    assert.match(chrome.header, /id="theme-toggle"/);
    assert.match(chrome.footer, /^<footer[\s>]/);
    assert.match(chrome.footer, /<\/footer>$/);
    assert.match(chrome.footer, /class="footer__status"/);
    assert.match(chrome.assetVersion, /^[A-Za-z0-9_-]+$/);
    // The <head> is ours; nothing from the template's may come along.
    assert.ok(!chrome.header.includes("ld+json"), "the JSON-LD graph is inside the header block");
    assert.ok(!chrome.footer.includes("linkup-info-btn"), "the trailing inline script is inside the footer block");
  });

  it("builds a real page out of the real chrome", () => {
    const chrome = extractChrome(template);
    const html = renderEventPage(entry(), chrome, TODAY);
    assert.match(html, /href="\.\.\/\.\.\/index\.html#about"/);
    assert.match(html, /href="\.\.\/\.\.\/feed\.xml"/);
    assert.ok(!/\sstyle="/.test(html), "inline style attribute in the real-chrome page");
    assert.ok(!html.includes("linkup-info-btn"));
  });

  it("returns null instead of guessing when the page loses its shape", () => {
    assert.equal(extractChrome(template.replace(/<header>[\s\S]*?<\/header>/, "")), null);
    assert.equal(extractChrome(template.replace(/<footer[\s\S]*?<\/footer>/, "")), null);
    assert.equal(extractChrome(template.replace(/style\.css\?v=[A-Za-z0-9_-]+/, "style.css")), null);
    assert.equal(extractChrome(""), null);
  });
});

describe("main() — the script end to end", () => {
  it("writes the pages under its cwd and never fails the sync", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc101-event-pages-"));
    try {
      // A cwd of its own: the script writes e/ relative to it, so
      // this must never run in the checkout.
      fs.copyFileSync(path.join(ROOT, "events.html"), path.join(dir, "events.html"));
      const archive = { version: 1, events: { a1: entry({ id: "a1", date: "2099-09-18" }), p1: entry({ id: "p1", date: "2026-01-09" }) } };
      const archiveFile = path.join(dir, "archive.json");
      fs.writeFileSync(archiveFile, JSON.stringify(archive));

      const run = (args) =>
        execFileSync("node", [path.join(ROOT, "scripts", "build-event-pages.mjs"), ...args], {
          cwd: dir,
          encoding: "utf8",
        });

      const out = run([archiveFile]);
      assert.match(out, /event-pages: 2 event page/);
      assert.match(out, /1 of them past stubs/);
      for (const f of ["e/a1/index.html", "e/a1/event.ics", "e/p1/index.html"]) {
        assert.ok(fs.existsSync(path.join(dir, f)), `${f} not written`);
      }
      assert.ok(!fs.existsSync(path.join(dir, "e/p1/event.ics")), "a past event kept its ics");
      assert.ok(!fs.existsSync(path.join(dir, "archiv")), "the archive index is gone");
      assert.match(fs.readFileSync(path.join(dir, "e/p1/index.html"), "utf8"), /Dieser Termin hat stattgefunden/);

      // Second run, unchanged input: syncFeedsDir writes nothing, so a no-op
      // sync stages no diff.
      assert.match(run([archiveFile]), /\(0 written, 0 removed\)/);

      // An entry that left the archive takes its directory with it.
      fs.writeFileSync(archiveFile, JSON.stringify({ version: 1, events: { a1: archive.events.a1 } }));
      run([archiveFile]);
      assert.ok(!fs.existsSync(path.join(dir, "e/p1")), "a dropped entry kept its page directory");

      // Missing archive: first run, no pages and no error.
      const fresh = run([path.join(dir, "nope.json")]);
      assert.match(fresh, /event-pages: 0 event page/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns and writes nothing when the template lost its chrome", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc101-event-pages-"));
    try {
      fs.writeFileSync(path.join(dir, "events.html"), "<html><body>nichts</body></html>");
      const res = execFileSync(
        "node",
        [path.join(ROOT, "scripts", "build-event-pages.mjs"), path.join(dir, "missing.json")],
        { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
      assert.equal(res.trim(), "", "wrote output despite an unusable template");
      assert.ok(!fs.existsSync(path.join(dir, "e")), "wrote chrome-less event pages");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("berlinToday", () => {
  it("is a Berlin calendar day, not the runner's UTC one", () => {
    // 2026-06-01T23:30Z is already the 2nd in Berlin (UTC+2).
    assert.equal(berlinToday(new Date("2026-06-01T23:30:00Z")), "2026-06-02");
    assert.equal(berlinToday(new Date("2026-06-01T21:30:00Z")), "2026-06-01");
    assert.match(berlinToday(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("esc", () => {
  it("covers the four characters that matter inside markup and attributes", () => {
    assert.equal(esc('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    assert.equal(esc(null), "");
  });
});
