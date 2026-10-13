/**
 * Unit tests for the markup invariants CLAUDE.md states as rules.
 * Runs with: node --test tests/markup.spec.mjs
 *
 * Why this file exists: "No inline styles — everything in style.css, JS-built
 * markup included" was only gated by one Playwright assertion, on one element
 * of the home page (tests/site.spec.js, "Monochrome theme"). A rule that covers
 * every page and every renderer needs a gate that reads every page and every
 * renderer — and one that runs in the PR gate, which is unit-tests-only, rather
 * than after the merge.
 *
 * Reads TRACKED files via `git ls-files`, so a scratch file lying around cannot
 * fail the build and a new page cannot escape the check by not being listed
 * anywhere. Both file sets are asserted non-empty first: a gate whose input set
 * can silently become empty is not a gate.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo from this file, never from process.cwd() — the suite must
// pass when invoked from any directory.
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  encoding: "utf8",
}).trim();

const tracked = (pattern) =>
  execFileSync("git", ["ls-files", pattern], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// style="…" and style='…', including the escaped form a double-quoted JS string
// produces (style=\"…\") — that backslash is why the first version of this gate
// stayed green on the very case CLAUDE.md names. Plus the two ways JS reaches
// the same attribute without writing it as markup.
const INLINE_STYLE = /style\s*=\s*\\?["'`]/;
const STYLE_VIA_API = /setAttribute\(\s*["'`]style["'`]|\.style\.cssText\s*=/;

const htmlFiles = tracked("*.html");

// Own browser JS only: confetti.min.js and the QR generator are vendored (the
// latter carries an unused createTableTag with inline styles), playwright.config.js
// and tests/ are not shipped, and a test may legitimately spell out the pattern
// it asserts against.
const jsFiles = tracked("*.js").filter(
  (f) =>
    !f.startsWith("tests/") &&
    f !== "confetti.min.js" &&
    f !== "qrcode-generator-2.0.4.min.js" &&
    f !== "playwright.config.js",
);

describe("no inline styles (CLAUDE.md § Conventions)", () => {
  it("has a non-empty input set", () => {
    assert.ok(
      htmlFiles.length >= 10,
      `expected at least 10 tracked HTML files, found ${htmlFiles.length}`,
    );
    assert.ok(
      jsFiles.length >= 5,
      `expected at least 5 tracked browser JS files, found ${jsFiles.length}`,
    );
  });

  it("no tracked HTML file carries a style attribute", () => {
    const offenders = htmlFiles
      .map((f) => [f, read(f).split("\n")])
      .flatMap(([f, lines]) =>
        lines
          .map((line, i) => [i + 1, line])
          .filter(([, line]) => INLINE_STYLE.test(line))
          .map(([n, line]) => `${f}:${n}: ${line.trim().slice(0, 80)}`),
      );
    assert.deepEqual(
      offenders,
      [],
      `inline style attributes belong in style.css:\n${offenders.join("\n")}`,
    );
  });

  it("no browser JS builds markup with a style attribute", () => {
    const offenders = jsFiles
      .map((f) => [f, read(f).split("\n")])
      .flatMap(([f, lines]) =>
        lines
          .map((line, i) => [i + 1, line])
          .filter(([, line]) => INLINE_STYLE.test(line) || STYLE_VIA_API.test(line))
          .map(([n, line]) => `${f}:${n}: ${line.trim().slice(0, 80)}`),
      );
    assert.deepEqual(
      offenders,
      [],
      `use the hidden attribute or a class, not style="…":\n${offenders.join("\n")}`,
    );
  });
});

describe("no external font loading (CLAUDE.md § Conventions, CONTRIBUTING § Guidelines)", () => {
  it("no tracked HTML file links a font host", () => {
    const FONT_HOST = /(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit|fonts\.bunny\.net|@font-face)/i;
    const offenders = htmlFiles
      .map((f) => [f, read(f).split("\n")])
      .flatMap(([f, lines]) =>
        lines
          .map((line, i) => [i + 1, line])
          .filter(([, line]) => FONT_HOST.test(line))
          .map(([n, line]) => `${f}:${n}: ${line.trim().slice(0, 80)}`),
      );
    assert.deepEqual(offenders, [], `fonts stay system-local:\n${offenders.join("\n")}`);
  });

  it("style.css declares no @font-face and no font import", () => {
    const css = read("style.css");
    assert.ok(!/@font-face/i.test(css), "style.css must not declare @font-face");
    assert.ok(
      !/@import\s+url\(\s*["']?https?:/i.test(css),
      "style.css must not import a remote stylesheet",
    );
  });
});

describe("feed autodiscovery (README § Generated files, CLAUDE.md § Adding a page)", () => {
  // Every page that carries the shared chrome (the nav utility cluster) must
  // announce both site feeds in its <head>, so a feed reader pointed at ANY
  // page — not just /events — finds them. The set is derived from the pages'
  // own content, not from a list: a new page inherits the rule with the chrome.
  const chromePages = htmlFiles.filter(
    (f) => !f.includes("/") && read(f).includes('class="nav__utils"'),
  );
  const FEEDS = [
    'type="application/rss+xml" title="bitcircus101 Termine" href="feed.xml"',
    'type="application/rss+xml" title="bitcircus101 Pinnwand" href="pinnwand/feed.xml"',
  ];

  it("has a non-empty input set", () => {
    // Nine today (the LAYOUT_PAGES of inject-layout.mjs, rss.html and
    // status.html among them); a page that loses the chrome must not silently
    // leave the set — bump this with every page that joins LAYOUT_PAGES.
    assert.ok(
      chromePages.length >= 9,
      `expected at least 9 root pages with the shared nav, found ${chromePages.length}`,
    );
  });

  it("every page with the shared nav links both feeds in its <head>", () => {
    const missing = chromePages.flatMap((f) => {
      const head = read(f).split("</head>")[0];
      return FEEDS.filter((feed) => !head.includes(feed)).map((feed) => `${f}: ${feed}`);
    });
    assert.deepEqual(
      missing,
      [],
      `add the <link rel="alternate" …> lines after <link rel="canonical">:\n${missing.join("\n")}`,
    );
  });
});

describe("lite/ mirrors the style.css tokens (style.css § Tokens, CLAUDE.md § Conventions)", () => {
  // lite/index.html loads no stylesheet, so it repeats the design tokens
  // inline. Two gates keep that copy honest: every token in lite equals the
  // one in style.css's first :root (the palette/print/contrast :roots are
  // indented or carry a selector suffix, so `^:root\s*{` skips them), and the
  // rest of lite's CSS names no raw colour — a hex or rgb() there is a value
  // that escaped the tokens. A hex-looking id selector such as `#add` would be
  // a false positive here; it would fail loudly, not silently.
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const norm = (v) => v.replace(/\s+/g, " ").trim().toLowerCase();
  const rootBlock = (css) => {
    const m = /^:root\s*\{([^}]*)\}/m.exec(css);
    assert.ok(m, "no top-level :root block");
    return m[1];
  };
  const tokens = (block) =>
    Object.fromEntries(
      [...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], norm(m[2])]),
    );
  const liteCss = () => {
    const m = /<style>([\s\S]*?)<\/style>/i.exec(read("lite/index.html"));
    assert.ok(m, "lite/index.html has no <style> block");
    return noComments(m[1]);
  };
  const REQUIRED = ["paper", "paper-2", "ink", "ink-max", "ink-dim", "line", "line-strong", "accent", "accent-soft", "font"];

  it("declares every token the site has, with the same value as style.css", () => {
    const site = tokens(rootBlock(noComments(read("style.css"))));
    const lite = tokens(rootBlock(liteCss()));
    assert.ok(Object.keys(lite).length >= REQUIRED.length, "lite declares fewer tokens than required");
    const missing = REQUIRED.filter((t) => !(t in lite));
    assert.deepEqual(missing, [], `lite/index.html lacks tokens: ${missing.join(", ")}`);
    const drift = Object.entries(lite)
      .filter(([name, value]) => site[name] !== value)
      .map(([name, value]) => `--${name}: lite "${value}" vs style.css "${site[name] ?? "(absent)"}"`);
    assert.deepEqual(drift, [], `tokens drifted — change both files:\n${drift.join("\n")}`);
  });

  it("names no raw colour outside the token block", () => {
    const css = liteCss().replace(/^:root\s*\{[^}]*\}/m, "");
    const raw = css.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi) || [];
    assert.deepEqual(raw, [], `raw colours in lite/index.html's CSS — use var(--…): ${raw.join(", ")}`);
  });
});

describe("small text sizes are tokens (style.css § Tokens)", () => {
  // 0.8 / 0.85 / 0.9rem are --fs-label / --fs-meta / --fs-small. A bare number
  // outside :root is a size that escaped the vocabulary; lite keeps its own
  // small sheet and is not held to this.
  it("style.css names no bare 0.8/0.85/0.9rem font-size outside :root", () => {
    const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^:root\s*\{[^}]*\}/m, "");
    const bare = [...css.matchAll(/font-size:\s*0\.(?:8|85|9)rem\b/g)].map((m) => m[0]);
    assert.deepEqual(bare, [], `use var(--fs-label|--fs-meta|--fs-small): ${bare.length} bare declaration(s)`);
  });
});

describe("the keyboard hint reads the same everywhere (README § Tests, style.css .footer__a11y)", () => {
  // "ohne maus bedienbar: …" is a promise the footer makes on the nine layout
  // pages (via the partial — the drift gate covers those), on /lite/ and on
  // /ascii/, which carry their own footers. One wording, or the promise reads
  // differently depending on where you are.
  const hint = (rel) => {
    const m = /class="footer__a11y"[^>]*>([\s\S]*?)<\/(?:span|p)>/.exec(read(rel));
    assert.ok(m, `${rel}: no .footer__a11y element`);
    return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  };

  it("is present and identical in the partial, /lite/ and /ascii/", () => {
    const texts = {
      "includes/site-footer.html": hint("includes/site-footer.html"),
      "lite/index.html": hint("lite/index.html"),
      "ascii/index.html": hint("ascii/index.html"),
    };
    const reference = texts["includes/site-footer.html"];
    assert.ok(reference.length > 20, `the hint is empty or too short: "${reference}"`);
    const drift = Object.entries(texts)
      .filter(([, t]) => t !== reference)
      .map(([f, t]) => `${f}: "${t}" vs partial "${reference}"`);
    assert.deepEqual(drift, [], `the keyboard hint differs:\n${drift.join("\n")}`);
  });
});
