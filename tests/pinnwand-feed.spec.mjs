/**
 * Unit tests for scripts/build-pinnwand-feed.mjs — the RSS feed of the job
 * board. Runs with: node --test tests/pinnwand-feed.spec.mjs
 *
 * Importing the script is inert (its main() is guarded), and
 * generatePinnwandFeed() takes "today" as an argument, so the whole window
 * question is testable without touching the wall clock or writing a file.
 *
 * What is measured here, in order of what would hurt most if it broke:
 * which notes the feed lists (the wall's own runtime math), what each item
 * says, that a company's text cannot break out of the XML, that identical
 * input yields identical bytes (ETag → 304), and that the words the script
 * itself adds keep the Pinnwand's tone.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  generatePinnwandFeed,
  CHANNEL_TITLE,
  CHANNEL_LINK,
  CHANNEL_DESCRIPTION,
  CHANNEL_SELF_URL,
} from "../scripts/build-pinnwand-feed.mjs";

const require = createRequire(import.meta.url);
// The same module the script, the page and the CI gate use: the window
// boundaries below are DERIVED from it, never typed by hand — a test that
// re-implements lastDay() would only prove that two guesses agree.
const JobsCore = require("../jobs-core.js");

const SCRIPT = fileURLToPath(new URL("../scripts/build-pinnwand-feed.mjs", import.meta.url));

const TODAY = "2026-09-15";

/** `iso` shifted by `n` days — only used for "tomorrow", never for the run's end. */
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

const posting = (extra = {}) => ({
  id: "acme-2026-09",
  company: "Acme",
  title: "Backend-Entwicklung in Bonn",
  location: "Bonn",
  employment: ["full-time", "working-student"],
  url: "https://acme.example/jobs/1",
  from: TODAY,
  months: 1,
  ...extra,
});

/** The bodies of every <item> in the document, in document order. */
function items(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
}

function field(itemBody, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(itemBody);
  return m ? m[1] : null;
}

describe("the channel", () => {
  const xml = generatePinnwandFeed({ postings: [] }, TODAY);

  it("is a complete RSS document even with nothing on the wall", () => {
    // A feed that 404s (or lists nothing because it was not written) tells a
    // reader the subscription is dead — so an empty wall still ships a channel.
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"'));
    assert.match(xml, /xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom"/);
    assert.match(xml, /xmlns:content="http:\/\/purl\.org\/rss\/1\.0\/modules\/content\/"/);
    assert.ok(xml.includes(`<title>${CHANNEL_TITLE}</title>`));
    assert.ok(xml.includes(`<link>${CHANNEL_LINK}</link>`));
    assert.ok(xml.includes(`<description>${CHANNEL_DESCRIPTION}</description>`));
    assert.ok(xml.includes(`<atom:link href="${CHANNEL_SELF_URL}" rel="self" type="application/rss+xml"/>`));
    // Channel cosmetics come from the shared envelope (scripts/rss.mjs) — pinned
    // here so dropping them from the envelope shows up in this feed's gate too.
    assert.match(xml, /<language>de-de<\/language>/);
    assert.match(xml, /<ttl>\d+<\/ttl>/);
    assert.match(xml, /<image>[\s\S]*<url>https:\/\/bitcircus101\.de\/images\/[^<]+<\/url>[\s\S]*<\/image>/);
    assert.ok(xml.trimEnd().endsWith("</rss>"));
  });

  it("lists no items and claims no build date when nothing is up", () => {
    assert.equal(items(xml).length, 0);
    // Not an empty element either: a <lastBuildDate/> is a date the feed does
    // not have, and readers have been seen to parse it as the epoch.
    assert.ok(!xml.includes("<lastBuildDate"), "empty feed still carries a lastBuildDate");
  });

  it("dates itself from the newest note, not from the clock", () => {
    const xml2 = generatePinnwandFeed(
      { postings: [posting({ id: "a", from: "2026-09-01" }), posting({ id: "b", from: "2026-09-10" })] },
      TODAY
    );
    assert.ok(xml2.includes("<lastBuildDate>Thu, 10 Sep 2026 00:00:00 +0000</lastBuildDate>"));
  });

  it("does not put the Dauerplatz (karussell) in the feed", () => {
    // The permanent slot has no dates at all — there is no "new" to announce,
    // and a reader would get the same three names on every poll forever.
    const xml2 = generatePinnwandFeed(
      { postings: [], karussell: [{ name: "kippdata", url: "https://www.kippdata.de" }] },
      TODAY
    );
    assert.equal(items(xml2).length, 0);
    assert.ok(!xml2.includes("kippdata"));
  });
});

describe("which notes the feed lists", () => {
  // Every boundary below is asserted against JobsCore first, then against the
  // feed: the test states the relationship ("this one's run ended yesterday"),
  // not a date it hopes is right.
  const ON_LAST_DAY_FROM = "2026-08-16"; // + 1 month → runs out today
  const EXPIRED_FROM = "2026-08-01"; // + 1 month → ran out before today
  const TOMORROW = addDays(TODAY, 1);

  const postings = [
    posting({ id: "starts-today", from: TODAY, months: 1 }),
    posting({ id: "starts-tomorrow", from: TOMORROW, months: 1 }),
    posting({ id: "last-day-today", from: ON_LAST_DAY_FROM, months: 1 }),
    posting({ id: "expired", from: EXPIRED_FROM, months: 1 }),
  ];

  it("sets up the four boundary cases it claims to", () => {
    // Guard the guard: if these preconditions stop holding, the assertions
    // below would still pass while measuring something else entirely.
    assert.ok(postings.length === 4, "the boundary set lost a case");
    assert.equal(JobsCore.lastDay(ON_LAST_DAY_FROM, 1), TODAY);
    assert.ok(JobsCore.lastDay(EXPIRED_FROM, 1) < TODAY);
    assert.ok(TOMORROW > TODAY);
  });

  it("lists a note from its first day through its last, and nothing else", () => {
    const xml = generatePinnwandFeed({ postings }, TODAY);
    const guids = items(xml).map((b) => field(b, "guid"));
    assert.ok(guids.length > 0, "the feed listed no items at all");
    assert.deepEqual(guids.sort(), ["pinnwand-last-day-today", "pinnwand-starts-today"]);
  });

  it("orders newest first, ties broken by id — the wall's own order", () => {
    const xml = generatePinnwandFeed(
      {
        postings: [
          posting({ id: "b-older", from: "2026-09-01" }),
          posting({ id: "b-newer", from: "2026-09-10" }),
          posting({ id: "a-newer", from: "2026-09-10" }),
        ],
      },
      TODAY
    );
    const guids = items(xml).map((b) => field(b, "guid"));
    assert.deepEqual(guids, ["pinnwand-a-newer", "pinnwand-b-newer", "pinnwand-b-older"]);
  });
});

describe("one item", () => {
  const entry = posting({ id: "acme-2026-09", from: "2026-09-01", months: 3 });
  const body = items(generatePinnwandFeed({ postings: [entry] }, TODAY))[0];

  it("names the vacancy and the company in the title", () => {
    assert.ok(body, "no item rendered");
    assert.equal(field(body, "title"), "Backend-Entwicklung in Bonn – Acme");
  });

  it("links the vacancy itself — we host nothing, we link", () => {
    assert.equal(field(body, "link"), "https://acme.example/jobs/1");
  });

  it("carries a stable, non-permalink guid and the note's own first day", () => {
    assert.match(body, /<guid isPermaLink="false">pinnwand-acme-2026-09<\/guid>/);
    assert.equal(field(body, "pubDate"), "Tue, 01 Sep 2026 00:00:00 +0000");
  });

  it("describes the runtime and points back at the card on the wall", () => {
    const desc = field(body, "description");
    const until = JobsCore.formatDay(JobsCore.lastDay(entry.from, entry.months));
    assert.equal(
      desc,
      "&lt;p&gt;Acme · Bonn&lt;/p&gt;" +
        "&lt;p&gt;Vollzeit · Werkstudium&lt;/p&gt;" +
        `&lt;p&gt;hängt seit 01.09.2026 · läuft bis ${until}&lt;/p&gt;` +
        '&lt;p&gt;&lt;a href=&quot;https://bitcircus101.de/pinnwand#job-acme-2026-09&quot;&gt;' +
        "zum Zettel an der Pinnwand&lt;/a&gt;&lt;/p&gt;"
    );
    // The anchor is the card's own DOM id (jobs.js renders id="job-<id>").
    assert.ok(desc.includes("#job-acme-2026-09"));
  });
});

describe("a company's text cannot break the feed", () => {
  const hostile = posting({
    id: "x&y<z",
    company: 'Acme & "Söhne" <GmbH>',
    title: 'Hacker*in <script>alert("x")</script> & mehr',
    url: 'https://acme.example/jobs?a=1&b="2"<3>',
    from: TODAY,
    months: 1,
  });
  const xml = generatePinnwandFeed({ postings: [hostile] }, TODAY);

  it("escapes every ampersand it emits", () => {
    assert.equal(items(xml).length, 1);
    // Same shape as the event feed's gate: a raw & that is not the start of an
    // entity is the single most common way a feed stops parsing.
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(xml), "raw & reached the feed");
  });

  it("lets no markup out of the item fields", () => {
    assert.ok(!xml.includes("<script"), "a <script> tag survived escaping");
    assert.ok(!xml.includes('<GmbH>'), "an angle-bracketed company survived escaping");
    // The description holds HTML, so its own <p> must arrive double-escaped:
    // once for the markup it embeds, once for the XML element holding it.
    const desc = field(items(xml)[0], "description");
    assert.ok(desc.includes("&lt;p&gt;"), "description lost its escaped markup");
    assert.ok(!desc.includes("<p>"), "raw <p> in the description");
  });

  it("keeps every element balanced", () => {
    for (const tag of ["item", "title", "link", "description", "guid", "pubDate"]) {
      const open = (xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g")) || []).length;
      const close = (xml.match(new RegExp(`</${tag}>`, "g")) || []).length;
      assert.ok(open > 0, `no <${tag}> in the document at all`);
      assert.equal(open, close, `<${tag}> is unbalanced: ${open} open, ${close} close`);
    }
  });
});

describe("determinism", () => {
  it("renders the same bytes twice — an unchanged wall must keep its ETag", () => {
    // The reason lastBuildDate comes from the newest note instead of new Date():
    // a feed whose bytes change every poll never gets a 304.
    const data = { postings: [posting({ id: "a", from: "2026-09-02" }), posting({ id: "b", from: TODAY })] };
    const first = generatePinnwandFeed(data, TODAY);
    const second = generatePinnwandFeed(data, TODAY);
    assert.ok(items(first).length === 2, "the fixture stopped producing items");
    assert.equal(first, second);
  });
});

describe("the tone of the wall holds in the feed", () => {
  // CURRENCY and SHOP_TALK are COPIED from tests/jobs-data.spec.mjs (the gates
  // on pinnwand.html) — the reasoning for every alternative, including the
  // numeric-entity spellings, is documented there and is not repeated here.
  // Scope: the words this SCRIPT adds (channel description, the runtime line,
  // the link back). A company's own title is its text and may say what it
  // likes, exactly as jobs.schema.json puts it — so the fixture keeps the
  // posting fields neutral and the assertion is about our copy.
  const CURRENCY = /(?:€|&euro;|&#x0*20ac;?|&#0*8364;?|\bEUR\b|\bEuros?\b)/gi;
  const SHOP_TALK =
    /\b(?:tarif\w*|preis\w*|gebühr\w*|entgelt\w*|honorar\w*|rechnung\w*|gegenleistung\w*|bezahl\w*|zahlung\w*|kosten(?!los|frei)\w*|kostet)\b/gi;

  const xml = generatePinnwandFeed(
    { postings: [posting({ id: "neutral", from: TODAY, months: 12 })] },
    TODAY
  );

  it("names no currency", () => {
    assert.equal(items(xml).length, 1, "the fixture rendered no item to check");
    assert.deepEqual([...xml.matchAll(CURRENCY)].map((m) => m[0]), []);
  });

  it("does not talk like a shop", () => {
    assert.deepEqual([...xml.matchAll(SHOP_TALK)].map((m) => m[0]), []);
  });
});

describe("the CLI", () => {
  it("writes the feed where it is told to, creating the directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pinnwand-feed-"));
    try {
      const src = path.join(dir, "jobs.json");
      const out = path.join(dir, "pinnwand", "feed.xml");
      fs.writeFileSync(
        src,
        JSON.stringify({
          postings: [
            {
              id: "acme-2026-09",
              company: "Acme",
              title: "Backend-Entwicklung in Bonn",
              location: "Bonn",
              employment: ["full-time"],
              url: "https://acme.example/jobs/1",
              from: "2026-09-01",
              months: 12,
            },
          ],
        })
      );

      execFileSync("node", [SCRIPT, src, out], { stdio: ["ignore", "pipe", "pipe"] });

      assert.ok(fs.existsSync(out), "the CLI wrote no file");
      const xml = fs.readFileSync(out, "utf8");
      assert.ok(xml.startsWith("<?xml"), "the written file is not XML");
      assert.ok(xml.includes("<rss"), "the written file carries no <rss> element");
      assert.ok(xml.includes(CHANNEL_TITLE), "the written file is not the Pinnwand channel");
      // The tmp file of the atomic write must not survive the rename.
      assert.equal(fs.existsSync(`${out}.tmp`), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
