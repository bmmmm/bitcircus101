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
        // tracked seed with no live counterpart still arrives from main
        assert.equal(fs.readFileSync(path.join(dir, "funding.json"), "utf8"), "seed-funding");
    });

    it("fails loudly without a ref argument", () => {
        const dir = fixture();
        const res = spawnSync("node", [path.join(SCRIPTS, "live-overlay.mjs")], { cwd: dir });
        assert.equal(res.status, 1);
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
    const HASH = "abc12345";

    before(async () => {
        server = http.createServer((req, res) => {
            if (req.url === "/") {
                res.writeHead(200, { "content-type": "text/html" });
                res.end(`<link href="style.css?v=${HASH}">`);
            } else if (req.url.startsWith("/style.css")) {
                res.writeHead(200, { "content-type": "text/css" });
                res.end("body{}");
            } else {
                res.writeHead(404);
                res.end("nope");
            }
        });
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => server.close());

    const env = { ...process.env, SMOKE_TIMEOUT_MS: "2000", SMOKE_INTERVAL_MS: "50" };
    // async execFile, NOT spawnSync: the fixture server runs in this process,
    // so a sync spawn would block the event loop and deadlock the child's
    // HTTP requests against the very server they target.
    const run = promisify(execFile);

    it("passes when hash is live, stylesheet resolves and 404s work", async () => {
        await run("node", [path.join(SCRIPTS, "smoke-live.mjs"), base, HASH], { env });
    });

    it("fails when the expected hash never appears", async () => {
        await assert.rejects(
            run("node", [path.join(SCRIPTS, "smoke-live.mjs"), base, "ffffffff"], { env }),
            (e) => e.code === 1 && e.stderr.includes("did not appear"),
        );
    });
});
