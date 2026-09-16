#!/usr/bin/env node
/**
 * Post-deploy smoke test: poll the live site until the freshly deployed asset
 * hash shows up (GitHub Pages builds asynchronously after the push), then
 * verify the hashed stylesheet resolves, unknown paths return a real 404, and
 * every page the sitemap advertises answers 200 without a redirect.
 *
 * Usage: node scripts/smoke-live.mjs <base-url> [expected-hash]
 *   e.g. node scripts/smoke-live.mjs https://bitcircus101.de abc12345
 * Without a hash the freshness poll is skipped (reachability checks only).
 *
 * Env overrides (mainly for tests): SMOKE_TIMEOUT_MS (default 360000),
 * SMOKE_INTERVAL_MS (default 15000).
 */
const base = process.argv[2]?.replace(/\/$/, "");
const hash = process.argv[3] || "";
if (!base) {
    console.error("usage: node scripts/smoke-live.mjs <base-url> [expected-hash]");
    process.exit(1);
}

const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 360000);
const INTERVAL = Number(process.env.SMOKE_INTERVAL_MS || 15000);
// Per-request hard bound so a stalled connection cannot blow past the overall
// deadline (undici's own defaults allow ~300s per request).
const FETCH_TIMEOUT = Math.min(10000, TIMEOUT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT) });
// Deliberately does NOT follow redirects: a sitemap entry that 3xx's has to be
// visible as a failure, and following it would report the destination's 200.
const getRaw = (url) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT) });
// Upper bound on page fetches so a runaway sitemap cannot stall the deploy.
const MAX_PAGE_CHECKS = 25;

// With hundreds of /e/<id>/ pages once the archive tree ships, a plain prefix
// slice of the sitemap would burn its whole budget on the first alphabetical
// (or sitemap-order) run of event pages and never re-check the shallow pages
// (/, /events, /support, …) that matter most. Sample instead: depth-sort so
// shallow pages always win a slot, then spend a small fixed slice of the
// budget on a deterministic spread of the deeper pages so that tree still
// gets *some* coverage every run.
function pathDepth(url) {
    try {
        return new URL(url).pathname.split("/").filter(Boolean).length;
    } catch {
        return 0;
    }
}

// Pick up to `n` entries from `arr`, spread evenly across it (first, middle,
// ..., last) rather than just the head — so repeated runs sample different
// parts of a long, stable list about as well as a single deterministic pass
// can. Deterministic: same input always yields the same picks.
function pickSpread(arr, n) {
    if (n <= 0 || arr.length === 0) return [];
    if (arr.length <= n) return arr.slice();
    if (n === 1) return [arr[0]];
    const picked = [];
    for (let i = 0; i < n; i++) {
        picked.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
    }
    return [...new Set(picked)];
}

// Pure so it's unit-testable without spinning up the fake server: given the
// full `<loc>` list and the overall cap, returns the URLs to actually fetch.
function samplePages(locs, max) {
    const shallowCap = Math.min(20, max);
    const deepCap = Math.max(max - shallowCap, 0);

    const sorted = locs
        .map((u, i) => ({ u, d: pathDepth(u), i }))
        .sort((a, b) => a.d - b.d || a.i - b.i);

    // "Shallow" is the top level of the site (/, /events, /archiv/, …): those
    // are always checked, capped at shallowCap in sitemap order so the gate
    // degrades to "the first 20 top-level pages", never to "none of them".
    // Everything nested deeper (/e/<id>/ and whatever comes next) is only
    // sampled, so a hundred event pages can never eat a top-level slot.
    const shallow = sorted.filter((x) => x.d <= 1).slice(0, shallowCap);
    const deep = sorted.filter((x) => x.d > 1);

    return [...shallow, ...pickSpread(deep, deepCap)].map((x) => x.u);
}

function fail(msg) {
    console.error(`smoke: FAILED — ${msg}`);
    process.exit(1);
}

const deadline = Date.now() + TIMEOUT;
let html = "";
for (;;) {
    try {
        const res = await get(`${base}/`);
        if (res.ok) {
            html = await res.text();
            if (!hash || html.includes(`?v=${hash}`)) break;
            console.error(`smoke: homepage up, hash ?v=${hash} not live yet`);
        } else {
            console.error(`smoke: homepage returned ${res.status}`);
        }
    } catch (e) {
        console.error(`smoke: homepage fetch failed: ${e.message}`);
    }
    if (Date.now() > deadline) {
        console.error(
            `smoke: FAILED — ${hash ? `hash ?v=${hash} did not appear` : "homepage not reachable"} within ${TIMEOUT}ms. ` +
                "Check the Pages build (Actions → pages-build-deployment) and the live branch head.",
        );
        process.exit(1);
    }
    await sleep(INTERVAL);
}
console.error("smoke: homepage OK");

try {
    const cssUrl = `${base}/style.css${hash ? `?v=${hash}` : ""}`;
    const css = await get(cssUrl);
    const cssBody = css.ok ? await css.text() : "";
    if (!css.ok || cssBody.length === 0) {
        console.error(`smoke: FAILED — ${cssUrl} returned ${css.status} (${cssBody.length} bytes)`);
        process.exit(1);
    }
    console.error(`smoke: stylesheet OK (${cssBody.length} bytes)`);

    const missing = await get(`${base}/smoke-missing-${hash || Date.now()}`);
    if (missing.status !== 404) {
        console.error(`smoke: FAILED — unknown path returned ${missing.status}, expected 404`);
        process.exit(1);
    }
} catch (e) {
    console.error(`smoke: FAILED — asset/404 check errored: ${e.message}`);
    process.exit(1);
}
console.error("smoke: 404 handling OK");

// Feeds never appear in the sitemap (they are not pages), so the sitemap walk
// below cannot see them. One explicit probe per feed tree catches the whole
// class of "deploy pruned the generated files" regressions.
//
// Polled against the SAME overall deadline as the hash check, because the hash
// is no freshness signal when a deploy changes no hashed asset: the poll above
// then matches the PREVIOUS Pages build instantly, while the build carrying the
// new commit is still running (~1 min) — seen live on the deploy that
// introduced feeds/ (run 33409874725: push at :19.45, probe 404 at :20.11,
// Pages build finished 46s later with the file present).
async function waitForFeed(url, prefix, label) {
    for (;;) {
        try {
            const feed = await get(url);
            const feedBody = feed.ok ? await feed.text() : "";
            if (feed.ok && feedBody.startsWith(prefix)) break;
            console.error(
                `smoke: ${url} returned ${feed.status}${feed.ok ? ` without a ${prefix} body` : ""} — retrying`,
            );
        } catch (e) {
            console.error(`smoke: feed fetch failed: ${e.message}`);
        }
        if (Date.now() > deadline) {
            fail(`${url} did not serve ${prefix} within ${TIMEOUT}ms`);
        }
        await sleep(INTERVAL);
    }
    console.error(`smoke: ${label} OK`);
}

await waitForFeed(`${base}/feeds/all.ics`, "BEGIN:VCALENDAR", "filtered-feed anchor");
// The job board's feed comes out of a different pipeline than the calendar
// feeds (build-pinnwand-feed.mjs, run by both the deploy and the sync), so it
// needs its own probe — feeds/all.ics being live says nothing about it.
await waitForFeed(`${base}/pinnwand/feed.xml`, "<?xml", "pinnwand feed");

// ── Sitemap-driven page check ───────────────────────────────────────────────
// The sitemap is the site's own claim about which URLs exist, so it is the one
// list worth walking. This catches the two regressions the hash/404 checks
// above cannot see: a page that silently stopped being served, and an entry
// pointing at a redirect — which burns crawl budget and leaves the target's
// canonical ambiguous. Driving it off the sitemap instead of a hardcoded list
// means a new page is covered the moment it is published.
try {
    const res = await get(`${base}/sitemap.xml`);
    if (!res.ok) fail(`${base}/sitemap.xml returned ${res.status}`);

    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (locs.length === 0) fail("sitemap.xml lists no URLs");

    const foreign = locs.filter((u) => !u.startsWith(`${base}/`));
    if (foreign.length) fail(`sitemap lists URLs outside ${base}: ${foreign.join(", ")}`);

    // Redirect-only and build-only paths must never be advertised: the site is
    // served with clean URLs, and includes/ holds layout partials, not pages.
    const bogus = locs.filter((u) => u.endsWith(".html") || u.includes("/includes/"));
    if (bogus.length) fail(`sitemap lists non-canonical or build-only paths: ${bogus.join(", ")}`);

    const checked = samplePages(locs, MAX_PAGE_CHECKS);
    if (checked.length < locs.length) {
        console.error(`smoke: sitemap has ${locs.length} entries, checking a sample of ${checked.length}`);
    }

    const bad = (
        await Promise.all(
            checked.map(async (u) => {
                try {
                    const r = await getRaw(u);
                    return r.status === 200 ? null : `${u} → ${r.status}`;
                } catch (e) {
                    return `${u} → ${e.message}`;
                }
            }),
        )
    ).filter(Boolean);
    if (bad.length) fail(`sitemap URLs are not served directly:\n  ${bad.join("\n  ")}`);

    console.error(`smoke: ${checked.length} sitemap URLs OK — live site healthy`);
} catch (e) {
    fail(`sitemap check errored: ${e.message}`);
}
