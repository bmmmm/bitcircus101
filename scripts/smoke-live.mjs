#!/usr/bin/env node
/**
 * Post-deploy smoke test: poll the live site until the freshly deployed asset
 * hash shows up (GitHub Pages builds asynchronously after the push), then
 * verify the hashed stylesheet resolves and unknown paths return a real 404.
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
console.error("smoke: 404 handling OK — live site healthy");
