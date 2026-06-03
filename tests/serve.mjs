#!/usr/bin/env node
/**
 * serve.mjs — minimal static file server for the Playwright E2E suite.
 *
 * Node is guaranteed in every environment we run tests in (local dev + the
 * Playwright Docker image used by CI); python3 is NOT in that image, so the
 * webServer can't rely on `python3 -m http.server`. Serves the repo root.
 *
 *   node tests/serve.mjs [port]   # default 8080
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const port = Number(process.argv[2]) || 8080;
const root = process.cwd();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split("?")[0]);
    if (path.endsWith("/")) path += "index.html";
    const filePath = normalize(join(root, path));
    // Block path traversal outside the served root.
    if (filePath !== root && !filePath.startsWith(root + "/")) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, "index.html") : filePath;
    const body = await readFile(target);
    res.writeHead(200, { "Content-Type": TYPES[extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(port, () => console.log(`static server on http://localhost:${port}`));
