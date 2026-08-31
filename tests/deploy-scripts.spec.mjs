/**
 * Unit tests for the extracted deploy-pipeline scripts
 * (scripts/live-overlay.mjs, scripts/cache-bust.mjs, scripts/smoke-live.mjs).
 *
 * These exist because the former inline-bash versions were only testable by a
 * real production deploy — and twice broke on the `bash -e` for-loop
 * exit-status trap. Every fixture runs in a throwaway temp dir.
 */
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const SCRIPTS = new URL("../scripts/", import.meta.url).pathname;

function tmpdir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(dir, file, content) {
    const p = path.join(dir, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}

function git(cwd, ...args) {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("live-overlay.mjs", () => {
    /** Build a repo whose `main` holds dev files + seeds, with a live
     *  checkout carrying CI-generated feeds that must survive the overlay. */
    function fixture() {
        const dir = tmpdir("overlay-");
        git(dir, "init", "-q", "-b", "main");
        git(dir, "config", "user.email", "t@e.st");
        git(dir, "config", "user.name", "t");
        write(dir, "index.html", "main-content");
        write(dir, "sitemap.xml", "seed-sitemap");
        write(dir, "funding.json", "seed-funding");
        write(dir, "scripts/keep.mjs", "kept");
        write(dir, "tests/site.spec.js", "dev-only");
        write(dir, "package.json", "{}");
        write(dir, "CLAUDE.md", "docs");
        git(dir, "add", "-A");
        git(dir, "commit", "-qm", "main state");
        git(dir, "checkout", "-qb", "live");
        // CI-generated state on live: regenerated seeds + untracked feeds
        write(dir, "sitemap.xml", "generated-sitemap");
        write(dir, "events-data.json", "generated-events");
        write(dir, "events/feed.xml", "generated-feed-copy");
        // the filtered-feed TREE (variable file set → FEED_DIRS, not FEEDS)
        write(dir, "feeds/all.ics", "generated-all-feed");
        write(dir, "feeds/tag/linkup.ics", "generated-tag-feed");
        write(dir, "feeds/source/bitcircus.xml", "generated-source-feed");
        // deliberately NO ical.ics / feed.xml / events/ical.ics → the
        // missing-file case that aborted the old bash loop (d558e5a)
        return dir;
    }

    it("overlays main, strips dev files, preserves generated feeds, tolerates missing feeds", () => {
        const dir = fixture();
        execFileSync("node", [path.join(SCRIPTS, "live-overlay.mjs"), "main"], { cwd: dir });

        assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), "main-content");
        assert.equal(fs.readFileSync(path.join(dir, "scripts/keep.mjs"), "utf8"), "kept");
        // dev-only content removed
        assert.equal(fs.existsSync(path.join(dir, "tests")), false);
        assert.equal(fs.existsSync(path.join(dir, "package.json")), false);
        assert.equal(fs.existsSync(path.join(dir, "CLAUDE.md")), false);
        // live-only generated files survived the overlay (seeds did not clobber)
        assert.equal(fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8"), "generated-sitemap");
        assert.equal(fs.readFileSync(path.join(dir, "events-data.json"), "utf8"), "generated-events");
        assert.equal(fs.readFileSync(path.join(dir, "events/feed.xml"), "utf8"), "generated-feed-copy");
        assert.equal(fs.readFileSync(path.join(dir, "feeds/tag/linkup.ics"), "utf8"), "generated-tag-feed");
        // tracked seed with no live counterpart still arrives from main
        assert.equal(fs.readFileSync(path.join(dir, "funding.json"), "utf8"), "seed-funding");
    });

    it("fails loudly without a ref argument", () => {
        const dir = fixture();
        const res = spawnSync("node", [path.join(SCRIPTS, "live-overlay.mjs")], { cwd: dir });
        assert.equal(res.status, 1);
    });

    it("prunes stale live-only files while preserving ref-tracked files and CI feeds", () => {
        const dir = fixture();
        // Track a "previous deploy" commit on live: a page that has since been
        // removed from main (the goals.html scenario found in production) plus
        // the CI-owned feeds fixture() already wrote to the working tree.
        write(dir, "old-page.html", "stale content");
        write(dir, "old-assets/legacy.js", "stale asset");
        git(dir, "add", "-A");
        git(dir, "commit", "-qm", "previous deploy state");

        execFileSync("node", [path.join(SCRIPTS, "live-overlay.mjs"), "main"], { cwd: dir });

        // stale page (absent from ref) is pruned, and its now-empty dir with it
        assert.equal(fs.existsSync(path.join(dir, "old-page.html")), false);
        assert.equal(fs.existsSync(path.join(dir, "old-assets")), false);
        // file present on the ref survives
        assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), "main-content");
        // FEEDS entries (tracked on live only, absent from ref) survive pruning
        assert.equal(fs.readFileSync(path.join(dir, "events-data.json"), "utf8"), "generated-events");
        assert.equal(fs.readFileSync(path.join(dir, "events/feed.xml"), "utf8"), "generated-feed-copy");
        // the FEED_DIRS tree survives pruning too — the exemption is scoped to
        // the feeds/ prefix (old-page/old-assets above prove pruning still runs)
        assert.equal(fs.readFileSync(path.join(dir, "feeds/all.ics"), "utf8"), "generated-all-feed");
        assert.equal(fs.readFileSync(path.join(dir, "feeds/tag/linkup.ics"), "utf8"), "generated-tag-feed");
        assert.equal(fs.readFileSync(path.join(dir, "feeds/source/bitcircus.xml"), "utf8"), "generated-source-feed");
    });
});

describe("cache-bust.mjs", () => {
    it("rewrites ?v= in every html file with a hash over the existing assets", () => {
        const dir = tmpdir("bust-");
        write(dir, "style.css", "body{}");
        write(dir, "main.js", "js");
        // all other ASSETS entries missing on purpose — must be skipped, not fatal
        write(dir, "a.html", '<link href="style.css?v=7"><script src="main.js?v=old">');
        write(dir, "sub/dir/b.html", '<link href="/style.css?v=7">');
        write(dir, "lite/index.html", "<p>no refs</p>");
        write(dir, "node_modules/x/skip.html", "?v=7");

        const out = execFileSync("node", [path.join(SCRIPTS, "cache-bust.mjs")], {
            cwd: dir,
            encoding: "utf8",
        }).trim();

        const expected = crypto
            .createHash("sha256")
            .update(Buffer.concat([fs.readFileSync(path.join(dir, "style.css")), fs.readFileSync(path.join(dir, "main.js"))]))
            .digest("hex")
            .slice(0, 8);
        assert.equal(out, expected);

        const a = fs.readFileSync(path.join(dir, "a.html"), "utf8");
        assert.equal(a.includes(`style.css?v=${expected}`), true);
        assert.equal(a.includes(`main.js?v=${expected}`), true);
        assert.equal(fs.readFileSync(path.join(dir, "sub/dir/b.html"), "utf8").includes(`?v=${expected}`), true);
        // untouched bystanders
        assert.equal(fs.readFileSync(path.join(dir, "lite/index.html"), "utf8"), "<p>no refs</p>");
        assert.equal(fs.readFileSync(path.join(dir, "node_modules/x/skip.html"), "utf8"), "?v=7");

        // idempotent: second run yields the same hash and same content
        const out2 = execFileSync("node", [path.join(SCRIPTS, "cache-bust.mjs")], { cwd: dir, encoding: "utf8" }).trim();
        assert.equal(out2, expected);
        assert.equal(fs.readFileSync(path.join(dir, "a.html"), "utf8"), a);
    });
});

describe("smoke-live.mjs", () => {
    let server;
    let base;
    // Which <loc> entries the fixture sitemap advertises; set per test.
    let locs = [];
    // Simulates a deploy that lost the feeds/ tree; reset by the test that sets it.
    let feedDown = false;
    // Simulates the Pages build still running: that many feed requests 404
    // before the file appears (the race that broke run 33409874725).
    let feedDelay = 0;
    const HASH = "abc12345";
    const sitemap = () =>
        `<?xml version="1.0" encoding="UTF-8"?><urlset>${locs
            .map((l) => `<url><loc>${l}</loc></url>`)
            .join("")}</urlset>`;

    before(async () => {
        server = http.createServer((req, res) => {
            if (req.url === "/") {
                res.writeHead(200, { "content-type": "text/html" });
                res.end(`<link href="style.css?v=${HASH}">`);
            } else if (req.url.startsWith("/style.css")) {
                res.writeHead(200, { "content-type": "text/css" });
                res.end("body{}");
            } else if (req.url === "/sitemap.xml") {
                res.writeHead(200, { "content-type": "application/xml" });
                res.end(sitemap());
            } else if (req.url === "/events") {
                res.writeHead(200, { "content-type": "text/html" });
                res.end("<h1>events</h1>");
            } else if (req.url === "/feeds/all.ics" && !feedDown) {
                if (feedDelay > 0) {
                    feedDelay--;
                    res.writeHead(404);
                    res.end("building");
                    return;
                }
                res.writeHead(200, { "content-type": "text/calendar" });
                res.end("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
            } else if (req.url === "/moved") {
                // Stands in for the clean-URL redirect production serves.
                res.writeHead(308, { location: "/events" });
                res.end();
            } else {
                res.writeHead(404);
                res.end("nope");
            }
        });
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        base = `http://127.0.0.1:${server.address().port}`;
        locs = [`${base}/`, `${base}/events`];
    });
    after(() => server.close());

    const env = { ...process.env, SMOKE_TIMEOUT_MS: "2000", SMOKE_INTERVAL_MS: "50" };
    // async execFile, NOT spawnSync: the fixture server runs in this process,
    // so a sync spawn would block the event loop and deadlock the child's
    // HTTP requests against the very server they target.
    const run = promisify(execFile);
    const smoke = (hash = HASH) => run("node", [path.join(SCRIPTS, "smoke-live.mjs"), base, hash], { env });

    it("passes when hash is live, stylesheet resolves, 404s work and every sitemap URL serves 200", async () => {
        locs = [`${base}/`, `${base}/events`];
        const { stderr } = await smoke();
        assert.match(stderr, /2 sitemap URLs OK/);
    });

    it("keeps polling the feed anchor until the pages build catches up", async () => {
        feedDelay = 2;
        try {
            const { stderr } = await smoke();
            assert.match(stderr, /retrying/);
            assert.match(stderr, /filtered-feed anchor OK/);
        } finally {
            feedDelay = 0;
        }
    });

    it("fails when the filtered-feed anchor is missing", async () => {
        feedDown = true;
        try {
            await assert.rejects(
                () => smoke(),
                (e) => e.code === 1 && e.stderr.includes("/feeds/all.ics"),
            );
        } finally {
            feedDown = false;
        }
    });

    it("fails when the expected hash never appears", async () => {
        await assert.rejects(
            () => smoke("ffffffff"),
            (e) => e.code === 1 && e.stderr.includes("did not appear"),
        );
    });

    it("fails when a sitemap URL redirects instead of serving 200 directly", async () => {
        locs = [`${base}/`, `${base}/moved`];
        await assert.rejects(
            () => smoke(),
            (e) => e.code === 1 && e.stderr.includes("not served directly") && e.stderr.includes("→ 308"),
        );
    });

    it("fails when a sitemap URL is dead", async () => {
        locs = [`${base}/`, `${base}/gone`];
        await assert.rejects(
            () => smoke(),
            (e) => e.code === 1 && e.stderr.includes("not served directly") && e.stderr.includes("→ 404"),
        );
    });

    it("rejects non-canonical and build-only sitemap entries", async () => {
        for (const bad of [`${base}/events.html`, `${base}/includes/site-header.html`]) {
            locs = [`${base}/`, bad];
            await assert.rejects(
                () => smoke(),
                (e) => e.code === 1 && e.stderr.includes("non-canonical or build-only"),
            );
        }
    });
});
