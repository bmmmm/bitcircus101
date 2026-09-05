#!/usr/bin/env node
/**
 * Inline includes/site-skip.html, site-header.html, and site-footer.html into
 * each allowlisted page. Edit the partials, then run: npm run build:layout
 *
 * The footer's "LIGHTS ON?" percent is stamped in here from funding.json
 * (data-funding on .footer__status), so main.js renders it from the HTML and
 * no page has to fetch funding.json. The value only changes through
 * `pnpm run finanz percent`, which prints this rebuild as its next step; the
 * CI drift gate catches a forgotten one.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/**
 * Read the footer percent from funding.json. Any value the CLI would refuse
 * (missing file, non-integer, out of 0..100) throws: a silently blank footer
 * on every page is worse than a red build.
 */
function readFundingPercent() {
  const file = path.join(root, "funding.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const percent = raw && raw.percent;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new Error(`funding.json: "percent" must be an integer 0..100, got ${JSON.stringify(percent)}`);
  }
  return percent;
}

/** Stamp the percent into the footer partial's data-funding attribute (exactly once). */
function withFundingPercent(footer, percent) {
  const needle = /(<span class="footer__status")( data-funding="[^"]*")?(>)/;
  if (!needle.test(footer)) {
    throw new Error('includes/site-footer.html: <span class="footer__status"> not found');
  }
  return footer.replace(needle, `$1 data-funding="${percent}"$3`);
}

const LAYOUT_PAGES = [
  "index.html",
  "events.html",
  "support.html",
  "pinnwand.html",
  "raum-nutzen.html",
  "impressum-datenschutz.html",
  "dankedankedanke.html",
];

/** Prepend the same indent used for direct children of <body> (8 spaces in this site). */
function withBodyIndent(fragment, indent = "        ") {
  return fragment
    .trim()
    .split("\n")
    .map((line) => (line.length ? indent + line : ""))
    .join("\n");
}

/**
 * Replace the first top-level <tagName>...</tagName> block (case-insensitive tag name).
 */
function replaceFirstBlock(html, tagName, replacement) {
  const lower = html.toLowerCase();
  const openNeedle = `<${tagName.toLowerCase()}`;
  const start = lower.indexOf(openNeedle);
  if (start === -1) {
    throw new Error(`Missing <${tagName}> in file`);
  }
  const openEnd = html.indexOf(">", start);
  if (openEnd === -1) {
    throw new Error(`Unclosed opening <${tagName}> tag`);
  }
  const closeNeedle = `</${tagName.toLowerCase()}>`;
  const closeStart = lower.indexOf(closeNeedle, openEnd + 1);
  if (closeStart === -1) {
    throw new Error(`Missing </${tagName}> in file`);
  }
  const end = closeStart + closeNeedle.length;
  const lineStart = html.lastIndexOf("\n", start - 1) + 1;
  const insert = withBodyIndent(replacement);
  let rest = html.slice(end);
  if (rest.length && !rest.startsWith("\n")) {
    rest = "\n" + rest;
  }
  return html.slice(0, lineStart) + insert + rest;
}

/** Insert skip link as first body child (once). */
function insertSkipLink(html, skipFragment) {
  if (html.includes("skip-link")) return html;
  const m = html.match(/<body\b[^>]*>/i);
  if (!m) throw new Error("No <body> tag");
  const insertAt = m.index + m[0].length;
  const line = "\n" + withBodyIndent(skipFragment);
  return html.slice(0, insertAt) + line + html.slice(insertAt);
}

/** Ensure <main id="main-content"> for skip targets. */
function ensureMainId(html) {
  return html.replace(/<main(\s[^>]*)?>/i, (full, attrs = "") => {
    const a = attrs || "";
    if (/(?<=\s)id\s*=\s*["']main-content["']/i.test(a)) return full; // already correct
    // A different existing id must be rewritten, not prepended — appending a second
    // id="main-content" would emit invalid <main id="main-content" id="other"> markup.
    // Use a whitespace-lookbehind, not \b, so the "id" inside data-id / aria-*-id is
    // not mistaken for a real id attribute (which would clobber the wrong attribute).
    if (/(?<=\s)id\s*=\s*["'][^"']*["']/i.test(a)) {
      return `<main${a.replace(/(?<=\s)id\s*=\s*["'][^"']*["']/i, 'id="main-content"')}>`;
    }
    const idAttr = ' id="main-content"';
    if (!a.trim()) return `<main${idAttr}>`;
    return `<main${idAttr}${a}>`;
  });
}

function main() {
  const skipPath = path.join(root, "includes", "site-skip.html");
  const headerPath = path.join(root, "includes", "site-header.html");
  const footerPath = path.join(root, "includes", "site-footer.html");
  const skip = fs.readFileSync(skipPath, "utf8");
  const header = fs.readFileSync(headerPath, "utf8");
  const footer = withFundingPercent(fs.readFileSync(footerPath, "utf8"), readFundingPercent());

  for (const name of LAYOUT_PAGES) {
    const filePath = path.join(root, name);
    let html = fs.readFileSync(filePath, "utf8");
    html = insertSkipLink(html, skip);
    html = ensureMainId(html);
    html = replaceFirstBlock(html, "header", header);
    html = replaceFirstBlock(html, "footer", footer);
    fs.writeFileSync(filePath, html, "utf8");
  }
}

main();
