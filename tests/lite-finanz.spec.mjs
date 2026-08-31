/**
 * Unit tests for scripts/build-lite-finanz.mjs — the generator that writes the
 * "Projekte & Kosten" block of lite/index.html from finanz.json. Runs with:
 *   node --test tests/lite-finanz.spec.mjs
 * No browser, no network, no file writes: every test drives the pure functions.
 *
 * The block used to be hand-maintained while build-lite-events.mjs stamped its
 * "Stand" date with new Date(), so the live page dated 2026-06-19 figures to the
 * day of the deploy. These tests pin both halves of the fix: the markup comes
 * from the data, and so does the date.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import { buildMarkup, formatStand, inject } from "../scripts/build-lite-finanz.mjs";

const NBSP = " ";

const BOARD = {
  currency: "EUR",
  updated: "2026-06-19",
  einmalig: [
    {
      id: "solar-speicher",
      title: "Solarzellen + Speicher",
      tagline: "Solarstrom fürs ganze Jahr",
      icon: "☀",
      target: 2000,
      raised: 250,
    },
  ],
  monatlich: [
    { id: "glasfaser", title: "Schnelleres Internet", tagline: "Glasfaser für den Space", icon: "⇅", monthly: 30 },
  ],
};

describe("formatStand", () => {
  it("turns an ISO date into the page's German form", () => {
    assert.equal(formatStand("2026-06-19"), "19.06.2026");
    assert.equal(formatStand("2026-01-01"), "01.01.2026");
  });
  it("passes anything unparseable through instead of inventing a date", () => {
    assert.equal(formatStand("heute"), "heute");
    assert.equal(formatStand(""), "");
    assert.equal(formatStand(null), "");
  });
});

describe("buildMarkup — one-time projects", () => {
  it("renders an ASCII bar, percentage and amounts straight from the data", () => {
    const out = buildMarkup(BOARD);
    // 250/2000 = 12.5% → 13% label, 3 of 20 blocks filled. The numbers come from
    // finanz-core.js, the same module support.html renders through.
    assert.match(out, /<span class="bar__pct">13 %<\/span>/);
    assert.match(out, /<span class="bar__f" aria-hidden="true">███<\/span>/);
    assert.match(out, /<span class="bar__e" aria-hidden="true">░{17}<\/span>/);
    assert.ok(out.includes(`250${NBSP}€ / 2.000${NBSP}€ · noch 1.750${NBSP}€`));
    assert.match(out, /· einmalig · Solarstrom fürs ganze Jahr/);
  });

  it("says 'erreicht' instead of a remainder once the goal is met", () => {
    const out = buildMarkup({
      ...BOARD,
      einmalig: [{ ...BOARD.einmalig[0], raised: 2000 }],
    });
    assert.ok(out.includes(`2.000${NBSP}€ / 2.000${NBSP}€ · erreicht`));
    assert.ok(!out.includes("noch"), "a reached project must not still ask for money");
    assert.match(out, /<span class="bar__pct">100 %<\/span>/);
  });

  it("binds every amount to its unit with a non-breaking space", () => {
    const out = buildMarkup(BOARD);
    // finanz-core.js emits a normal space (support.html keeps it); the lite page
    // deliberately does not, so a narrow screen never wraps "250" off its "€".
    assert.ok(!/\d €/.test(out), "found a breakable space before €");
    assert.ok(!/\d %/.test(out), "found a breakable space before %");
  });
});

describe("buildMarkup — monthly costs", () => {
  it("renders no bar, because a recurring cost has no target to reach", () => {
    const out = buildMarkup({ ...BOARD, einmalig: [] });
    assert.ok(out.includes(`30${NBSP}€ / Monat — werde Unterstützer:in`));
    assert.ok(!out.includes("bar__f"), "monthly costs must carry no progress bar");
    assert.match(out, /· laufend ·/);
  });

  it("omits the tagline separator when an item has none", () => {
    const out = buildMarkup({
      ...BOARD,
      einmalig: [],
      monatlich: [{ id: "strom", title: "Strom", icon: "⚡", monthly: 85 }],
    });
    assert.match(out, /<span class="dim">· laufend<\/span>/);
  });
});

describe("buildMarkup — edges", () => {
  it("escapes HTML in titles and taglines", () => {
    const out = buildMarkup({
      ...BOARD,
      einmalig: [],
      monatlich: [{ id: "x", title: '<img src=x onerror="alert(1)">', monthly: 5 }],
    });
    assert.ok(!out.includes("<img"), "raw markup leaked from the data");
    assert.match(out, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  it("falls back to a friendly line instead of an empty section", () => {
    const out = buildMarkup({ currency: "EUR", updated: "2026-06-19", einmalig: [], monatlich: [] });
    assert.match(out, /Zurzeit keine offenen Projekte/);
  });

  it("survives a board with missing lists", () => {
    assert.match(buildMarkup({}), /Zurzeit keine offenen Projekte/);
  });
});

describe("inject", () => {
  const HTML =
    "<p>Stand <!-- lite-stand-date -->01.01.2000<!-- /lite-stand-date -->.</p>\n" +
    "<!-- lite-finanz:start -->\nOLD\n<!-- lite-finanz:end -->\n<p>after</p>";

  it("replaces only what sits between the markers", () => {
    const out = inject(HTML, "NEW", "19.06.2026");
    assert.ok(out.includes("<!-- lite-finanz:start -->\nNEW\n<!-- lite-finanz:end -->"));
    assert.ok(!out.includes("OLD"));
    assert.ok(out.includes("<p>after</p>"), "content outside the markers must survive");
  });

  it("stamps the Stand date from the data, not the clock", () => {
    const out = inject(HTML, "NEW", "19.06.2026");
    assert.ok(out.includes("<!-- lite-stand-date -->19.06.2026<!-- /lite-stand-date -->"));
    assert.ok(!out.includes("01.01.2000"));
  });

  it("is idempotent — running twice changes nothing further", () => {
    const once = inject(HTML, "NEW", "19.06.2026");
    assert.equal(inject(once, "NEW", "19.06.2026"), once);
  });

  it("throws rather than silently writing an unmarked page", () => {
    assert.throws(() => inject("<p>no markers here</p>", "NEW", "19.06.2026"), /markers not found/);
  });
});

describe("the committed lite page", () => {
  it("matches what the generator produces from the committed finanz.json", () => {
    // The gate in ci.yml asserts this in CI; asserting it here too means a
    // contributor sees the mismatch in ~3s of unit tests, not after a push.
    const finanz = JSON.parse(fs.readFileSync(new URL("../finanz.json", import.meta.url), "utf8"));
    const html = fs.readFileSync(new URL("../lite/index.html", import.meta.url), "utf8");
    assert.equal(inject(html, buildMarkup(finanz), formatStand(finanz.updated)), html);
  });
});
