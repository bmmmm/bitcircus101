#!/usr/bin/env node
/**
 * Deploy step: compute a short content hash over all cacheable assets
 * (post-minification) and rewrite every `?v=…` reference in every HTML file.
 *
 * Icons + manifest are included so swapping a PWA/favicon asset changes the
 * hash and busts the ?v= on their <link> refs — CSS/JS alone wouldn't.
 *
 * Walks the whole tree for *.html instead of keeping a directory list: the
 * old inline-bash list needed a per-file existence guard that twice caused
 * `bash -e` aborts, and silently missed newly added page dirs. Files without
 * `?v=` refs are a no-op.
 *
 * Prints the hash on stdout (for $GITHUB_OUTPUT); logs go to stderr.
 * Testable locally: tests/deploy-scripts.spec.mjs.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Order matters for hash stability; missing files are skipped like the old
// `cat … 2>/dev/null` did, so the hash is unchanged for identical content.
const ASSETS = [
    "style.css",
    "main.js",
    "events.js",
    "ics-core.js",
    "images/favicon.svg",
    "images/apple-touch-icon.png",
    "images/icon-192.png",
    "images/icon-512.png",
    "images/icon-maskable-512.png",
    "site.webmanifest",
];

const SKIP_DIRS = new Set([".git", "node_modules"]);

const h = crypto.createHash("sha256");
let hashed = 0;
for (const a of ASSETS) {
    if (!fs.existsSync(a)) continue;
    h.update(fs.readFileSync(a));
    hashed++;
}
const hash = h.digest("hex").slice(0, 8);

function* htmlFiles(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) yield* htmlFiles(path.join(dir, e.name));
        } else if (e.name.endsWith(".html")) {
            yield path.join(dir, e.name);
        }
    }
}

let rewritten = 0;
for (const f of htmlFiles(".")) {
    const src = fs.readFileSync(f, "utf8");
    const out = src.replace(/\?v=[a-zA-Z0-9_-]*/g, `?v=${hash}`);
    if (out !== src) {
        fs.writeFileSync(f, out);
        rewritten++;
    }
}

console.error(`cache-bust: hash ${hash} from ${hashed} assets, rewrote ${rewritten} HTML files`);
console.log(hash);
