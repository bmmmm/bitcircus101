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

// Own browser JS only: confetti.min.js is vendored, playwright.config.js and
// tests/ are not shipped, and a test may legitimately spell out the pattern it
// asserts against.
const jsFiles = tracked("*.js").filter(
  (f) =>
    !f.startsWith("tests/") &&
    f !== "confetti.min.js" &&
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
