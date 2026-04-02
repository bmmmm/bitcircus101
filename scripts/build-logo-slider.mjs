#!/usr/bin/env node
/**
 * Regenerate the homepage "Freund*innen" logo strip from files in images/logo-slider/.
 * Run after adding or removing logos: npm run build:logos
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const LOGO_DIR = path.join(root, "images", "logo-slider");
const INDEX = path.join(root, "index.html");

const START = "<!-- logo-slider:start -->";
const END = "<!-- logo-slider:end -->";

const LOGO_EXT = /\.(svg|png|jpe?g)$/i;

/** Transparent 1×1 SVG data URL — real assets load via JS when the section is near the viewport. */
const PLACEHOLDER_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

function altFromFilename(filename) {
  const base = filename.replace(LOGO_EXT, "");
  const words = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words || "Logo";
}

function buildItem(filename, emptyAlt) {
  const rel = encodeURI(`images/logo-slider/${filename}`);
  const alt = emptyAlt ? "" : altFromFilename(filename);
  const altAttr = alt === "" ? 'alt=""' : `alt="${escapeHtml(alt)}"`;
  return [
    "                                <div class=\"logo-slider__item\">",
    `                                    <img class="logo-slider__img" src="${PLACEHOLDER_SRC}" data-src="${escapeHtml(rel)}" ${altAttr} decoding="async" />`,
    "                                </div>",
  ].join("\n");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function buildMarkup(files) {
  const lines = [
    '                <section id="freundinnen" class="logo-slider" aria-labelledby="logo-slider-heading">',
    '                    <h2 id="logo-slider-heading">Freund*innen des bitcircus101<a class="section-anchor" href="#freundinnen" aria-label="Link zu: Freund*innen">#</a></h2>',
    '                    <div class="logo-slider__viewport">',
    '                        <div class="logo-slider__track">',
    '                            <div class="logo-slider__set">',
  ];

  for (const f of files) {
    lines.push(buildItem(f, false));
  }

  lines.push("                            </div>");
  lines.push('                            <div class="logo-slider__set" aria-hidden="true">');

  for (const f of files) {
    lines.push(buildItem(f, true));
  }

  lines.push("                            </div>");
  lines.push("                        </div>");
  lines.push("                    </div>");
  lines.push("                </section>");

  return lines.join("\n");
}

function main() {
  let entries = [];
  try {
    entries = fs.readdirSync(LOGO_DIR);
  } catch (e) {
    console.error("build-logo-slider: missing", LOGO_DIR, e.message);
    process.exit(1);
  }

  const files = entries.filter((name) => LOGO_EXT.test(name)).sort((a, b) => a.localeCompare(b));

  const html = fs.readFileSync(INDEX, "utf8");
  const i0 = html.indexOf(START);
  const i1 = html.indexOf(END);
  if (i0 === -1 || i1 === -1 || i1 <= i0) {
    console.error("build-logo-slider:", INDEX, "must contain", START, "then", END);
    process.exit(1);
  }

  const before = html.slice(0, i0);
  const afterEnd = html.slice(i1 + END.length);
  const block = START + "\n" + buildMarkup(files) + "\n                " + END;
  const next = before + block + afterEnd;

  if (next === html) {
    return;
  }

  fs.writeFileSync(INDEX, next, "utf8");
  console.log(`build-logo-slider: wrote ${files.length} logo(s) into index.html`);
}

main();
