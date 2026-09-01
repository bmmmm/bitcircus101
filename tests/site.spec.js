// @ts-check
const { test, expect } = require('@playwright/test');
const { buildEventsData, useEventsFixture } = require('./fixtures/events-data');

// ─── Hit-area probe ──────────────────────────────────────────────────────────
//
// Several controls are deliberately small plain-text boxes, and the zone a
// finger has to land in is widened by a pseudo-element. A pseudo-element moves
// neither getBoundingClientRect() nor toBeVisible(), so geometry and visibility
// both answer the wrong question — only document.elementFromPoint reports what
// a tap actually reaches. One probe, two readings:
//
//   hitsAt()   — does a tap dx/dy off the box centre still land on the element?
//   hitBox()   — how many CSS pixels wide/tall is that zone?
//   hitBoxes() — the same, for every match, to sweep a whole page
const REACH_MAX = 80;

// This whole function is serialised into the page, so everything it uses has to
// live inside it — including the reach ceiling, which is why 80 appears as a
// literal and REACH_MAX only sizes the scroll margin on the Node side.
const PROBE = ([sel, dx, dy, measure, margin, all]) => {
    const one = (el) => {
        // elementFromPoint answers in viewport coordinates and returns null
        // outside them, so a probe point past the fold reads as "miss" no matter
        // what is really there. The box being on screen is not enough — the
        // points this probe is about to ask for have to be too, which is what
        // `margin` is. The scroll is conditional so that probing a sticky header
        // does not drag the page out from under the next reading.
        let b = el.getBoundingClientRect();
        if (!b.width || !b.height) return null;
        let cy = b.top + b.height / 2;
        if (cy - margin < 0 || cy + margin > window.innerHeight) {
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            b = el.getBoundingClientRect();
            cy = b.top + b.height / 2;
        }
        const cx = b.left + b.width / 2;
        const owns = (x, y) => {
            if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
            const hit = document.elementFromPoint(x, y);
            return !!(hit && (hit === el || el.contains(hit)));
        };
        if (!measure) return owns(cx + dx, cy + dy);
        // An inline link wrapped across two lines has its centre in the gap
        // between them, where the parent answers. That is this probe's blind
        // spot, not an unreachable control — a sweep skips it, a single lookup
        // reports it, because there it means the caller aimed at the wrong thing.
        if (!owns(cx, cy)) return all ? null : { w: 0, h: 0 };
        // Walk outwards until the zone stops answering. The 80px cap is a
        // ceiling, not a target: how far a 300px-wide link reaches is not what
        // this measures.
        const reach = (ux, uy) => { let n = 0; while (n < 80 && owns(cx + ux * (n + 1), cy + uy * (n + 1))) n++; return n; };
        return { w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1,
                 text: (el.textContent || '').trim().slice(0, 40) };
    };
    if (all) return [...document.querySelectorAll(sel)].map(one).filter(Boolean);
    const el = document.querySelector(sel);
    return el ? one(el) : null;
};

const hitsAt = (page, sel, dx, dy) =>
    page.evaluate(PROBE, [sel, dx, dy, false, Math.max(Math.abs(dx), Math.abs(dy)) + 2, false]);
const hitBox = (page, sel) => page.evaluate(PROBE, [sel, 0, 0, true, REACH_MAX, false]);
const hitBoxes = (page, sel) => page.evaluate(PROBE, [sel, 0, 0, true, REACH_MAX, true]);

/**
 * Assert a control's tap zone against the WCAG 2.2 target-size floor.
 * Pass the numbers the CSS actually reaches, not aspirations — where a zone
 * cannot grow to 44px without a visible layout change, the comment at the CSS
 * rule says so and the number here matches it.
 */
async function expectHitZones(page, zones) {
    for (const [sel, minW, minH] of zones) {
        const z = await hitBox(page, sel);
        expect(z, `${sel}: no element, or its own centre is not reachable`).not.toEqual({ w: 0, h: 0 });
        expect(z.w, `${sel} tap zone width`).toBeGreaterThanOrEqual(minW);
        expect(z.h, `${sel} tap zone height`).toBeGreaterThanOrEqual(minH);
    }
}

// ─── Home Page ───────────────────────────────────────────────────────────────

test.describe('Home page', () => {
    test('loads with title, heading and ASCII art', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/bitcircus101/);
        await expect(page.locator('h1')).toContainText('bitcircus101');
        await expect(page.locator('.ascii-art')).toBeVisible();

        // The only way into /ascii/ — the page is noindex and out of the nav, so
        // if this link goes, the playground is reachable by typed URL only.
        const egg = page.locator('.ascii-art-link');
        await expect(egg).toHaveAttribute('href', 'ascii/');
        await expect(egg).toHaveText('▚');
        // It must stay OUTSIDE the art's role="img" wrapper: everything inside
        // one is hidden from assistive tech, which would make this link exist
        // for sighted mouse users only.
        expect(await egg.evaluate((el) => !!el.closest('[role="img"]')),
            'the playground link is buried inside role="img"').toBe(false);
        await expectHitZones(page, [['.ascii-art-link', 44, 44]]);
    });

    test('shows support and contact CTAs', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#support')).toBeVisible();
        await expect(page.locator('#support a[href="support.html"]')).toBeVisible();
        await expect(page.locator('#support a[href="raum-nutzen.html"]')).toBeVisible();
        await expect(page.locator('#contact a[href^="mailto:"]')).toBeVisible();
    });

    test('carousel works and map loads on click', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.carousel-container')).toBeVisible();
        await expect(page.locator('.carousel-item.active img')).toBeVisible();

        // Carousel navigation
        const activeDotBefore = await page.locator('.dot.active').getAttribute('aria-label');
        await page.locator('.carousel-button.next').click();
        // Wait for the actual state change, not a fixed sleep — race-free on slow CI.
        await expect.poll(() => page.locator('.dot.active').getAttribute('aria-label')).not.toBe(activeDotBefore);

        // The controls are 17-26px boxes on purpose; what has to clear the WCAG
        // 2.2 target-size floor is the zone a finger gets, widened by CSS.
        // The dots stop at 27px wide because they sit 10px apart — see the CSS.
        await expectHitZones(page, [
            ['.carousel-button.prev', 44, 44],
            ['.carousel-button.next', 44, 44],
            ['.carousel-toggle',      44, 44],
            ['.dot',                  24, 44],
        ]);

        // Map
        await page.locator('#show-map-btn').click();
        await expect(page.locator('#osm-map-container')).toBeVisible();
        const frame = page.locator('#osm-map');
        expect(await frame.getAttribute('src')).toContain('openstreetmap.org');
        // The embed needs allow-scripts and allow-same-origin to draw tiles at
        // all; the sandbox earns its keep through what it withholds — top-level
        // navigation, popups, forms, modals, downloads. Pinned here because the
        // attribute is one careless edit away from being dropped, and nothing
        // visible breaks when it is. (That tiles still render under it was
        // measured against the live OSM host; CI stays offline on purpose.)
        expect(await frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
        expect(await frame.getAttribute('referrerpolicy')).toBe('no-referrer');

        await expect(page.locator('#freundinnen')).toBeVisible();
        await expect(page.locator('#logo-slider-heading')).toContainText('Freund*innen');
        await page.locator('#freundinnen').scrollIntoViewIfNeeded();
        const firstLogo = page.locator('#freundinnen .logo-slider__item img.logo-slider__img').first();
        await expect(firstLogo).toBeVisible();
        await expect(firstLogo).toHaveAttribute('src', /images\/logo-slider\//);
    });
});

// ─── SEO & Meta ──────────────────────────────────────────────────────────────

test.describe('SEO meta tags', () => {
    test('home page has all required meta tags and structured data', async ({ page }) => {
        await page.goto('/');

        // Description
        const desc = await page.locator('meta[name="description"]').getAttribute('content');
        expect(desc).toBeTruthy();
        expect(desc.length).toBeGreaterThan(50);

        // Canonical
        const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
        expect(canonical).toContain('bitcircus101.de');

        // Open Graph
        const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
        expect(ogTitle).toContain('bitcircus101');

        // JSON-LD
        const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
        expect(jsonLd).toBeTruthy();
        const data = JSON.parse(jsonLd);
        expect(data['@type']).toBeTruthy();
        expect(data.name).toContain('bitcircus101');

        // Theme color
        const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
        expect(themeColor).toBeTruthy();
    });

    test('subpages have meta descriptions', async ({ page }) => {
        // Events
        await page.goto('/events.html');
        expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();

        // Donations
        await page.goto('/support.html');
        expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();

        // Raum nutzen
        await page.goto('/raum-nutzen.html');
        expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();
    });
});

// ─── Privacy ─────────────────────────────────────────────────────────────────

test.describe('Privacy – no external font loading', () => {
    test('no Google Fonts loaded via HTML or network', async ({ page }) => {
        const requests = [];
        page.on('request', (req) => requests.push(req.url()));
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // No link tags
        expect(await page.locator('link[href*="fonts.googleapis.com"]').count()).toBe(0);

        // No preconnect
        expect(await page.locator('link[rel="preconnect"][href*="google"]').count()).toBe(0);

        // No network requests
        const googleFontRequests = requests.filter(
            (url) => url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')
        );
        expect(googleFontRequests).toHaveLength(0);
    });
});

// ─── Navigation ──────────────────────────────────────────────────────────────

test.describe('Navigation', () => {
    // The whole utility cluster, in DOM order.
    const UTILS = [
        'nav a[href="feed.xml"]',
        'nav a[href="lite/"]',
        'nav a[href="kiosk/"]',
        '#theme-toggle',
    ];

    test('desktop nav links are inside the viewport and work', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/');
        // toBeInViewport, not toBeVisible: an element parked at x=1520 in a
        // 1280px window is "visible" to Playwright and unreachable to a person.
        for (const sel of ['nav a[href="events.html"]', 'nav a[href="support.html"]',
                           'nav a[href="raum-nutzen.html"]', ...UTILS]) {
            await expect(page.locator(sel), sel).toBeInViewport();
        }

        await page.locator('nav a[href="events.html"]').click();
        await expect(page).toHaveURL(/events\.html/);
    });

    test('mobile menu toggles, closes after a pick, and the anchor clears the header', async ({ page }) => {
        await page.setViewportSize({ width: 400, height: 800 });
        // /index.html, not / — from "/" the href "index.html#about" is a path
        // change and the browser reloads, which closes the menu on its own and
        // would make the assertion below pass with or without the handler.
        // Only from /index.html is the click a pure hash change.
        await page.goto('/index.html');
        const toggle = page.locator('#menu-toggle');
        const links = page.locator('nav ul.nav__links');
        // toBeInViewport for the two states where "reachable" is the claim —
        // a toggle or an opened menu parked off-screen is "visible" to
        // Playwright and useless to a person. The closed states stay
        // not.toBeVisible(): there the claim is display:none, not position.
        await expect(toggle).toBeInViewport();
        await expect(links).not.toBeVisible();
        await toggle.click();
        await expect(links).toBeInViewport();
        await toggle.click();
        await expect(links).not.toBeVisible();

        // Picking an entry must close the menu. "/wir" is a same-page hash link,
        // so nothing reloads — leave the menu open and it stays parked over the
        // section it just jumped to, which reads as a dead tap.
        await toggle.click();
        await expect(links).toBeInViewport();
        await page.locator('nav ul.nav__links a[href="index.html#about"]').click();
        await expect(links).not.toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        // ...and the section has to land clear of the sticky header. At this
        // width the condensed header wraps to two rows (~80px) while
        // scroll-padding-top was sized for one, so the heading used to arrive
        // 14px underneath it. Measure only once the smooth scroll has come to
        // rest: mid-flight the section is still far below and every clearance
        // check would pass, which is no check at all.
        await expect.poll(async () => {
            const a = await page.evaluate(() => Math.round(window.scrollY));
            await page.waitForTimeout(120);
            const b = await page.evaluate(() => Math.round(window.scrollY));
            return a === b && b > 0;
        }, { message: 'page never settled after the anchor jump' }).toBe(true);

        const clearance = await page.evaluate(() => {
            const header = document.querySelector('header').getBoundingClientRect().bottom;
            const about = document.querySelector('#about').getBoundingClientRect().top;
            return Math.round(about - header);
        });
        expect(clearance, '#about must not sit under the sticky header').toBeGreaterThanOrEqual(0);
    });

    test('the utility cluster stays hittable at every width and font size', async ({ page, browserName }) => {
        // Regression: the cluster (lite · RSS · kiosk · invert) used to be pushed
        // off-screen between ~700-1155px. It now shows inline on desktop and
        // drops to its own always-visible row in the condensed layout.
        await page.goto('/');
        for (const width of [1280, 1100, 900, 700, 400]) {
            await page.setViewportSize({ width, height: 800 });
            for (const sel of UTILS) {
                await expect(page.locator(sel), `${sel} @ ${width}px`).toBeInViewport();
            }
        }
        // Condensed layout: the cluster shows without opening the menu, while
        // the content links stay collapsed behind the toggle.
        await expect(page.locator('nav ul.nav__links')).not.toBeVisible();

        // 16px off-centre is outside the 24px box but inside the widened hit
        // area — a realistic finger miss, which used to land on nothing.
        for (const sel of UTILS) {
            for (const dy of [-16, 16]) {
                expect(await hitsAt(page, sel, 0, dy), `${sel} tapped ${dy}px off centre`).toBe(true);
            }
        }

        // A reader who turns the browser font up used to lose kiosk and the
        // invert toggle off the right edge between ~1010 and 1080px, because the
        // breakpoint was a fixed 1000px while the nav's contents scale in ch/rem.
        // Only the real browser setting reproduces this — a JS-set root
        // font-size does not move media-query em — hence CDP.
        test.skip(browserName !== 'chromium', 'Page.setFontSizes is Chromium-only');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Page.setFontSizes', { fontSizes: { standard: 24, fixed: 24 } });
        for (const width of [1010, 1040, 1080]) {
            await page.setViewportSize({ width, height: 800 });
            await page.goto('/');
            for (const sel of UTILS) {
                await expect(page.locator(sel), `${sel} @ ${width}px, 24px browser font`).toBeInViewport();
            }
        }
    });

    test('the green marker tracks the section being read, and anchors land at once', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/index.html');

        const marker = () => page.evaluate(() =>
            [...document.querySelectorAll('.nav__links a')]
                .filter((a) => a.classList.contains('nav__link--current'))
                .map((a) => a.textContent.trim())
                .join(','));

        // Park a section's top inside the spy's band (10–25% of the viewport) and
        // read back which entry lights up. The spy used to watch only #about and
        // #contact, so everything between them fell through to "no section in
        // view" and re-lit /wir — the marker claimed "wir" while the reader was
        // at "nächste termine" or "keep the lights on", two screens further down.
        const parkAt = async (id) => {
            await page.evaluate((sid) => {
                const top = document.getElementById(sid).getBoundingClientRect().top + scrollY;
                window.scrollTo({ top: top - innerHeight * 0.12, behavior: 'instant' });
            }, id);
            // The observer reports on the next rendering opportunity, not synchronously.
            await page.waitForTimeout(120);
            return marker();
        };

        expect(await parkAt('about'), '#about is what /wir points at').toBe('/wir');
        // Sections the nav has no entry for clear the marker rather than borrowing
        // someone else's. The claim under test is the negative one: not /wir.
        expect(await parkAt('next-events'), 'no nav entry owns #next-events').not.toBe('/wir');
        expect(await parkAt('support'), 'no nav entry owns #support on the homepage').not.toBe('/wir');
        expect(await parkAt('contact'), '#contact is what /kontakt points at').toBe('/kontakt');

        // Anchor jumps land instead of panning. Measured with no wait at all after
        // the click: `scroll-behavior: smooth` needed ~900ms for this distance and
        // was barely 100px in by now, so "already most of the way there" is a
        // claim only an instant jump can meet. Half the distance, not all of it,
        // keeps the gate off the exact landing offset (scroll-padding-top owns that).
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        const target = await page.evaluate(() =>
            document.getElementById('contact').getBoundingClientRect().top + scrollY);
        await page.locator('.nav__links a[href="index.html#contact"]').click();
        const landed = await page.evaluate(() => Math.round(scrollY));
        expect(landed, 'anchor jump must not animate').toBeGreaterThan(target / 2);
        // The marker is the one thing here that may NOT be read synchronously:
        // `hashchange` is delivered as its own task and the spy reports on the
        // next rendering opportunity, so a bare read right after the click is a
        // race — it caught "" once on an otherwise green run. The jump is what
        // has to be instant; the marker only has to arrive.
        await expect.poll(marker, { message: 'marker never caught up with the jump' })
            .toBe('/kontakt');
    });

    test('the marker survives the clean URLs production actually serves', async ({ page }) => {
        // Production 308-redirects /events.html → /events, so the address bar
        // never shows the extension. The local server hands out real .html
        // files, which is why this only ever broke live: normalizePageFile fell
        // through to "index.html" for anything without an extension, and on
        // "index.html" the matcher picks the homepage's own /wir link. Clicking
        // /termine landed you on /events with "wir" lit up.
        //
        // Rewrite the document request instead of teaching the test server clean
        // URLs: an in-page href must still be the .html form (see CLAUDE.md), and
        // a server that resolves both would quietly retire that rule.
        const clean = async (path, file) => {
            await page.route(`**${path}`, async (route) => {
                if (route.request().resourceType() !== 'document') return route.fallback();
                await route.fulfill({ path: file, contentType: 'text/html; charset=utf-8' });
            });
        };
        await clean('/events', 'events.html');
        await clean('/support', 'support.html');
        await clean('/raum-nutzen', 'raum-nutzen.html');

        const marker = () => page.evaluate(() =>
            [...document.querySelectorAll('.nav__links a')]
                .filter((a) => a.classList.contains('nav__link--current'))
                .map((a) => a.textContent.trim())
                .join(',') || '-');

        for (const [url, expected] of [
            ['/events', '/termine'],
            ['/support', '/support'],
            ['/raum-nutzen', '/raum'],
        ]) {
            await page.goto(url);
            await page.waitForLoadState('domcontentloaded');
            expect(await marker(), `${url} must light its own nav entry`).toBe(expected);
        }

        // Directory URLs keep resolving to their index — "/lite/" is index.html,
        // not lite.html, and nothing in the nav may claim it.
        await page.goto('/lite/');
        expect(await page.evaluate(() => document.querySelectorAll('.nav__link--current').length),
            '/lite/ has no shared nav to mark').toBe(0);
    });
});

// ─── Events Page ─────────────────────────────────────────────────────────────

test.describe('Events page', () => {
    test('loads with title, list section and subscribe links', async ({ page }) => {
        await page.goto('/events.html');
        await expect(page).toHaveTitle(/Veranstaltungen/);
        await expect(page.locator('#events-list')).toBeVisible();
        await expect(page.locator('.events-subscribe__btn').first()).toBeVisible();
        await expect(page.locator('#linkup-info-btn')).toBeVisible();

        // RSS feed link in head
        const href = await page.locator('link[type="application/rss+xml"]').getAttribute('href');
        expect(href).toContain('feed.xml');

        // Wait for JS to finish rendering
        await page.waitForFunction(() => {
            return document.querySelector('.event-card') ||
                   document.querySelector('.events-empty') ||
                   document.querySelector('.events-fallback');
        }, { timeout: 8000 });

        // Back link
        await expect(page.locator('.back-link a')).toBeVisible();
    });
});

// ─── Events Content & Functionality ──────────────────────────────────────────
// These tests serve a deterministic events-data.json (tests/fixtures) instead
// of whatever the live calendar returned. Before, a missing or empty file —
// every local checkout, and CI whenever the sync fetch failed — made them
// return early and pass without asserting anything.

test.describe('Events content', () => {
    test.beforeEach(async ({ page }) => {
        await useEventsFixture(page);
    });

    test('tags, filtering and month grouping work when events are loaded', async ({ page }) => {
        await page.goto('/events.html');
        await expect(page.locator('.event-card').first()).toBeVisible();

        // Tags present
        expect(await page.locator('.event-tag').count()).toBeGreaterThan(0);

        // Month groups
        expect(await page.locator('.events-month').count()).toBeGreaterThan(0);

        await expect(page.locator('.events-toolbar')).toBeVisible();
        await expect(page.locator('#events-only-bitcircus')).toBeVisible();

        // Filter bar
        await expect(page.locator('.events-filter')).toBeVisible();
        const countBefore = await page.locator('.event-card').count();
        const firstTag = page.locator('.events-filter__tag').first();
        await firstTag.click();
        await expect(firstTag).toHaveClass(/active/);
        const countAfter = await page.locator('.event-card').count();
        expect(countAfter).toBeGreaterThan(0);
        expect(countAfter).toBeLessThanOrEqual(countBefore);

        // Reset
        await page.locator('.events-filter__clear').click();
        expect(await page.locator('.event-card').count()).toBe(countBefore);

        // Type markers: classes are emitted AND the CSS is wired (guards the
        // dead-class regression — the classes existed unstyled for months)
        expect(
            await page.locator('.event-card--linkup, .event-card--workshop, .event-card--special').count()
        ).toBeGreaterThan(0);
        const borderStyle = await page.locator('.event-card').first()
            .evaluate((el) => getComputedStyle(el).borderLeftStyle);
        expect(borderStyle).not.toBe('none');

        // Tap zones. The one to watch is the toolbar LABEL, not the 16x16
        // checkbox inside it: the label is what a tap actually activates, so it
        // is the target whose size counts.
        //
        // The chips are gated at 25, not 24. Their bare 22.4px box already
        // measures 24 once this probe rounds to whole pixels, so a 24 threshold
        // would pass with the widening removed — a gate that cannot go red. 25
        // pins the +4px the CSS adds (measured: 26) with a pixel to spare. They
        // stop there because they wrap into rows only 4px apart; 44 would need
        // a visibly roomier row gap.
        await expectHitZones(page, [
            ['.events-toolbar__label', 44, 44],
            ['.events-filter__tag',    24, 25],
            ['a.event-card__location', 44, 44],
            ['.event-action',          44, 44],
        ]);
    });

    test('URL state and search round-trip, and survive the bitcircus toggle', async ({ page }) => {
        await page.goto('/events.html');
        await expect(page.locator('.event-card').first()).toBeVisible();

        // Chip click lands in the URL
        const countBefore = await page.locator('.event-card').count();
        const firstTag = page.locator('.events-filter__tag').first();
        const tagName = await firstTag.getAttribute('data-tag');
        await firstTag.click();
        await expect(page).toHaveURL(/[?&]tags=/);
        const filteredCount = await page.locator('.event-card').count();

        // Reloading the shared URL restores chip state and result set
        await page.goto(page.url());
        const restoredTag = page.locator(`.events-filter__tag[data-tag="${tagName}"]`);
        await expect(restoredTag).toHaveClass(/active/);
        await expect(restoredTag).toHaveAttribute('aria-pressed', 'true');
        expect(await page.locator('.event-card').count()).toBe(filteredCount);

        // Search narrows further and lands in the URL (debounced)
        const title = await page.locator('.event-card__title').first().textContent();
        const token = title.split(/\s+/).sort((a, b) => b.length - a.length)[0];
        await page.locator('#events-search').fill(token);
        await expect(page).toHaveURL(/[?&]q=/);
        expect(await page.locator('.event-card').count()).toBeGreaterThan(0);

        // Nonsense query shows the search empty state
        await page.locator('#events-search').fill('zzzqqqxyz');
        await expect(page.locator('.events-empty')).toBeVisible();

        // Reset clears tags + search and the URL query
        await page.locator('.events-filter__clear').click();
        await expect(page).toHaveURL(/\/events\.html(#.*)?$/);
        expect(await page.locator('.event-card').count()).toBe(countBefore);

        // Regression: the source toggle must not wipe an active tag filter
        // (removeFilterBar used to clear the filters as a side effect)
        await page.locator(`.events-filter__tag[data-tag="${tagName}"]`).click();
        await page.locator('#events-only-bitcircus').check();
        const survivor = page.locator(`.events-filter__tag[data-tag="${tagName}"]`);
        if (await survivor.count()) {
            await expect(survivor).toHaveClass(/active/);
        }
        await expect(page).toHaveURL(/[?&]tags=/);
        await expect(page).toHaveURL(/[?&]nur=bc/);
    });

    test('subscribe buttons follow the filter, and say so when no feed matches', async ({ page }) => {
        await page.goto('/events.html');
        await expect(page.locator('.event-card').first()).toBeVisible();

        const note = page.locator('#events-feed-scope');
        const split = page.locator('#events-feed-split');
        const rssBtn = page.locator('[data-feed="rss"]');
        const rssDefault = await rssBtn.getAttribute('href');

        // One listed tag → the buttons point at exactly that tag's feed
        await page.locator('.events-filter__tag[data-tag="#hardware"]').click();
        await expect(note).toBeVisible();
        expect(await rssBtn.getAttribute('href')).toBe('/feeds/tag/hardware.xml');
        await expect(split).toBeHidden();

        // Two tags are no single scope: defaults return and the box names the
        // per-tag feeds instead of quietly handing out the unfiltered one
        await page.locator('.events-filter__tag[data-tag="#linux"]').click();
        await expect(note).toBeHidden();
        expect(await rssBtn.getAttribute('href')).toBe(rssDefault);
        await expect(split).toBeVisible();
        const links = split.locator('.events-subscribe__scope-links a');
        await expect(links).toHaveCount(2);
        await expect(links.first()).toHaveAttribute('href', '/feeds/tag/hardware.xml');

        // The source toggle alone resolves to that source's feed
        await page.locator('.events-filter__clear').click();
        await page.locator('#events-only-bitcircus').check();
        await expect(note).toBeVisible();
        expect(await rssBtn.getAttribute('href')).toBe('/feeds/source/bitcircus.xml');
        await expect(split).toBeHidden();
    });

    test('sync status labels are shown when data is available', async ({ page }) => {
        await page.goto('/events.html');
        await expect(page.locator('.event-card').first()).toBeVisible();

        const syncEl = page.locator('#events-last-sync');
        await expect(syncEl).toBeVisible({ timeout: 5000 });
        const sources = syncEl.locator('.sync-source');
        expect(await sources.count()).toBeGreaterThan(0);
        const bar = await sources.first().locator('.sync-source__bar').textContent();
        expect(bar).toMatch(/^\[.*\]$/);
        const ago = await sources.first().locator('.sync-source__ago').textContent();
        expect(ago).toMatch(/jetzt|vor \d+ (min|h)/);
    });
});

// ─── Goals Page ──────────────────────────────────────────────────────────────

test.describe('Funding goals (fused into support.html)', () => {
    test('donations.html instant-redirects to support.html (kept for the search index)', async ({ request }) => {
        // donations.html is in the search index; it stays as an instant
        // meta-refresh redirect to the renamed support.html (deliberately no
        // noindex) so ranking and existing hits move over via refresh + canonical.
        const res = await request.get('/donations.html');
        expect(res.status()).toBe(200);
        const html = await res.text();
        // The refresh target stays relative (works on a plain local file server
        // too); the canonical must name the clean URL the site actually serves.
        expect(html).toMatch(/http-equiv=["']refresh["'][^>]*support\.html/i);
        expect(html).toMatch(/rel=["']canonical["'][^>]*bitcircus101\.de\/support["']/i);
    });

    test('support.html renders funding panels with ASCII bars, progressbar a11y and donate links', async ({ page }) => {
        await page.goto('/support.html');
        await expect(page).toHaveTitle(/Unterstütz/);

        // Wait for JS (finanz.js / projects.js) to render panels (or a fallback)
        // before asserting.
        await page.waitForFunction(() =>
            document.querySelector('.projekt-panel') ||
            document.querySelector('.projekte-fallback') ||
            document.querySelector('.projekte-empty'),
            { timeout: 8000 });

        // One-time funding panels live in #projekte-list; scope here so the bar
        // assertions can't accidentally pick up a barless monatlich card (which
        // also uses .projekt-panel) regardless of seed/DOM order.
        const panels = page.locator('#projekte-list .projekt-panel');
        const count = await panels.count();
        // This used to be `if (count === 0) return;` — a silent pass that turned
        // a broken renderer into a green run. finanz.json is tracked on main, so
        // every checkout and every CI job has seed data: zero panels is a defect,
        // not an environment.
        expect(count, 'finanz.json is tracked and seeded — zero panels means the renderer broke')
            .toBeGreaterThan(0);

        // Recurring monthly costs render as projekt-panel cards in their OWN
        // always-visible block, but with no progress bar — the type-split fix,
        // so a monthly cost is never folded into the one-time total (which
        // would mix one-off and recurring money).
        const monatlich = page.locator('#kosten-monatlich');
        await expect(monatlich.locator('.projekt-panel--monatlich').first()).toBeVisible();
        await expect(monatlich).toContainText('Monat');
        expect(await monatlich.locator('[role="progressbar"]').count()).toBe(0);

        // tuwat is its own always-visible section: Aufgaben / Vorhaben / Aktionen.
        await expect(page.locator('#tatkraft .tuwat-group')).toHaveCount(3);

        // progressbar exposes a numeric aria-valuenow
        const firstBar = panels.first().locator('.projekt-bar[role="progressbar"]');
        await expect(firstBar).toHaveAttribute('aria-valuenow', /^\d+$/);

        // bar is pure ASCII (block / shade glyphs), not an image
        const filled = await panels.first().locator('.projekt-bar__filled').textContent();
        const empty = await panels.first().locator('.projekt-bar__empty').textContent();
        expect(filled + empty).toMatch(/[█░]/);

        // Donate link follows the shared href policy (FinanzCore.donateTarget):
        // a project with its OWN Ko-fi page opens it rel-hardened in a new tab;
        // without one (the seed case) it stays on-site and jumps to #dauerhaft —
        // generic links never bounce to a bare Ko-fi profile out of context.
        const donate = panels.first().locator('.projekt-action--donate');
        const donateHref = await donate.getAttribute('href');
        if (/ko-fi\.com/.test(donateHref)) {
            expect(await donate.getAttribute('rel')).toContain('noopener');
            expect(await donate.getAttribute('target')).toBe('_blank');
        } else {
            expect(donateHref).toMatch(/#dauerhaft$/);
            expect(await donate.getAttribute('target')).toBeNull();
        }

        // back link present — there is deliberately NO grand-total bar: one-time
        // and recurring costs are shown per item and never summed into one figure.
        expect(await page.locator('.projekt-bar--total').count()).toBe(0);
        await expect(page.locator('.back-link a')).toBeVisible();
    });

    test('funding pulse stays hidden without data, and leaks no figures with it', async ({ page }) => {
        // No fixture: the seed finanz.json carries no `pulse`, so the block must
        // render nothing at all rather than an empty box or a bare prompt line.
        await page.goto('/support.html');
        await expect(page.locator('#projekte-list .projekt-panel').first()).toBeVisible();
        await expect(page.locator('#funding-pulse')).toBeHidden();
        expect((await page.locator('#funding-pulse').textContent()).trim()).toBe('');

        // With data, served through page.route so the assertions below cannot
        // silently pass on an absent element (a guarded test is a no-op test).
        await page.route('**/finanz.json', async (route) => {
            const res = await route.fetch();
            const data = await res.json();
            data.pulse = { updated: '2026-09-01', levels: [0, 3, 3, 5, 4, 6, 5, 7] };
            await route.fulfill({ response: res, json: data });
        });
        await page.goto('/support.html');

        const pulse = page.locator('#funding-pulse');
        await expect(pulse).toBeVisible();

        // The whole point of the pulse: rhythm, no readable figures. One glyph
        // per level, and nothing that could be mistaken for an amount.
        const glyphs = await pulse.locator('.pulse-sparkline__glyphs').textContent();
        expect(glyphs).toMatch(/^[▁▂▃▄▅▆▇█]{8}$/u);
        const text = await pulse.textContent();
        expect(text).not.toMatch(/\d/);
        expect(text).not.toContain('€');
        expect(text).not.toContain('%');

        // Screen readers get the caveat, not just eight anonymous blocks.
        expect(await pulse.getAttribute('aria-label')).toMatch(/keine exakten Beträge/);
        await expect(pulse.locator('.pulse-sparkline__glyphs')).toHaveAttribute('aria-hidden', 'true');
    });
});

// ─── Subpages ────────────────────────────────────────────────────────────────

test.describe('Support page', () => {
    test('online support options are directly visible — no consent gate, no embeds', async ({ page }) => {
        await page.goto('/support.html');
        await expect(page).toHaveTitle(/Unterstütz/);
        await expect(page.locator('#support-heading')).toContainText(
            /bitcircus101 unterstützen: Licht anlassen/,
        );

        // The consent banner and the embedded Ko-fi widget are gone: PayPal and
        // Ko-fi are plain outbound links now, so nothing third-party loads here.
        await expect(page.locator('#site-notice')).toHaveCount(0);
        await expect(page.locator('#kofiframe')).toHaveCount(0);

        // Both online options are reachable straight away — no click-through
        // gate — and open rel-hardened in a new tab.
        const paypal = page.locator('#donation-fallback a[href*="paypal.com/paypalme"]');
        await expect(paypal).toBeVisible();
        expect(await paypal.getAttribute('rel')).toContain('noopener');
        expect(await paypal.getAttribute('target')).toBe('_blank');
        await expect(
            page.locator('#donation-fallback a[href*="ko-fi.com/bmabma"]'),
        ).toBeVisible();
    });
});

test.describe('Raum nutzen page', () => {
    test('loads with title, structured data, and a collapsible room-rental note', async ({ page }) => {
        await page.goto('/raum-nutzen.html');
        await expect(page).toHaveTitle(/Raum nutzen/);
        await expect(page.locator('#show-map-btn')).toBeVisible();
        await expect(page.locator('.back-link a')).toBeVisible();

        // Second copy of the OSM embed — hardened like the home page's, and it
        // has to stay that way independently of it.
        const frame = page.locator('#osm-map');
        expect(await frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
        expect(await frame.getAttribute('referrerpolicy')).toBe('no-referrer');

        const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
        const data = JSON.parse(jsonLd);
        expect(data['@type']).toBe('EventVenue');

        // The de-emphasised room-rental note is a <details>, collapsed by default;
        // its mailto CTA only becomes reachable once the summary is expanded.
        const rentFold = page.locator('details.sidenote');
        const rentMail = rentFold.locator('a[href^="mailto:"][href*="Raumanfrage"]');
        await expect(rentMail).toBeHidden();
        await rentFold.locator('summary').click();
        await expect(rentMail).toBeVisible();
    });
});

test.describe('Impressum page', () => {
    test('loads with title and back link', async ({ page }) => {
        await page.goto('/impressum-datenschutz.html');
        await expect(page).toHaveTitle(/Impressum/);
        await expect(page.locator('.back-link a, a[href="index.html"]').first()).toBeVisible();
    });
});

test.describe('Danke page', () => {
    test('loads with title, noindex, correct content and back link', async ({ page }) => {
        await page.goto('/dankedankedanke.html');
        await expect(page).toHaveTitle(/Danke/);
        await expect(page.locator('h1')).toContainText('DANKE');

        // noindex (SEO)
        const robots = await page.locator('meta[name="robots"]').getAttribute('content');
        expect(robots).toContain('noindex');

        // No "Spende" in visible content (legal requirement)
        const mainText = await page.locator('main').textContent();
        expect(mainText).not.toContain('Spende');

        await expect(page.locator('.back-link a')).toBeVisible();
    });
});

// ─── Design – monochrome plain-text theme ────────────────────────────────────

test.describe('Monochrome theme', () => {
    test('dark background, monospace font, no inline styles', async ({ page }) => {
        await page.goto('/');

        // Dark background
        const bgColor = await page.evaluate(() =>
            window.getComputedStyle(document.body).backgroundColor
        );
        const [r, g, b] = bgColor.match(/\d+/g).map(Number);
        expect(r + g + b).toBeLessThan(60);

        // Monospace font
        const fontFamily = await page.evaluate(() =>
            window.getComputedStyle(document.body).fontFamily
        );
        const isMonospace =
            fontFamily.toLowerCase().includes('monospace') ||
            fontFamily.toLowerCase().includes('courier') ||
            fontFamily.toLowerCase().includes('menlo') ||
            fontFamily.toLowerCase().includes('consolas');
        expect(isMonospace).toBe(true);

        // No inline styles on key elements
        const donateP = page.locator('#support .text-center');
        await expect(donateP).toBeVisible();
        expect(await donateP.getAttribute('style')).toBeFalsy();
    });
});

// ─── No Console Errors ───────────────────────────────────────────────────────

test.describe('No JavaScript errors', () => {
    const pages = [
        ['/', 'Home'],
        ['/events.html', 'Events'],
        ['/support.html', 'Support'],
        ['/raum-nutzen.html', 'Raum nutzen'],
        ['/impressum-datenschutz.html', 'Impressum'],
        ['/dankedankedanke.html', 'Danke'],
        ['/ascii/', 'ASCII playground'],
        ['/chat/', 'Signal'],
        ['/lite/', 'Lite'],
        ['/kiosk/', 'Kiosk'],
        ['/404.html', '404'],
    ];

    for (const [url, name] of pages) {
        test(`${name} page has no JS errors`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', (err) => errors.push(err.message));
            await page.goto(url);
            await page.waitForLoadState('networkidle');
            expect(errors).toEqual([]);
        });
    }
});

// ─── Signal Redirect Stubs ───────────────────────────────────────────────────

test.describe('Signal redirect stubs', () => {
    // invite-*/join-* are 0-second redirects to Signal: reachable but noindex and out
    // of the sitemap. They redirect off-site to signal.group, so we fetch the static
    // HTML directly instead of adding them to the no-JS-errors page list (a browser
    // goto would follow the redirect off-site and hang on networkidle).
    const stubs = ['/join-info/', '/join-talk/', '/invite-info/', '/invite-talk/'];

    for (const url of stubs) {
        test(`${url} is noindex and redirects to Signal`, async ({ request }) => {
            const res = await request.get(url);
            expect(res.status()).toBe(200);
            const html = await res.text();
            expect(html).toMatch(/name=["']robots["'][^>]*noindex/i);
            expect(html).toMatch(/http-equiv=["']refresh["'][^>]*signal\.group/i);
            expect(html).toMatch(/window\.location\.replace\(['"]https:\/\/signal\.group\//);
        });
    }
});

// ─── Kiosk view ──────────────────────────────────────────────────────────────

test.describe('Kiosk view', () => {
    // The wall clock is pinned so the timing cases below are assertable at all.
    // Every event is dated against this instant, not against "now", so the test
    // means the same thing at 03:00 in CI as it does at noon locally.
    const NOW = new Date('2026-09-01T19:30:00');
    const DAY = '2026-09-01';
    const NEXT = '2026-09-02';

    /**
     * Four timing cases the old renderer got wrong or could not show at all.
     * The marker used to gate on "started less than 3 h ago" and ignore
     * endTime, so it dropped a long-running event and clung to a finished one.
     */
    function kioskData() {
        const ev = (o) => ({
            subtitle: '', description: '', location: '', endDate: o.date,
            tags: [], type: '', source: 'bitcircus101', uid: o.title, ...o,
        });
        return {
            lastSync: NOW.toISOString(),
            sources: [],
            events: [
                // runs 15:00–22:00 → started 4.5 h ago, still running.
                // The 3 h heuristic called this over.
                ev({
                    title: 'Läuft seit langem', date: DAY, time: '15:00', endTime: '22:00',
                    description: 'Kommt vorbei: https://matrix.to/#/!abc?via=x — wir haben Mate.',
                    location: 'Dorotheenstraße 101, Bonn',
                    tags: ['#offener-abend'],
                }),
                // ran 18:00–19:00 → over half an hour ago. Started 1.5 h ago,
                // so the 3 h heuristic still called this running.
                ev({ title: 'Schon vorbei', date: DAY, time: '18:00', endTime: '19:00' }),
                // 19:00–22:00 → running, and overlapping BOTH of the above
                ev({
                    title: 'Parallel dazu', date: DAY, time: '19:00', endTime: '22:00',
                    description: 'https://example.org/nur-ein-link',
                    source: 'Datenburg e.V.',
                }),
                // 23:00 → after the whole bundle, so its own group
                ev({ title: 'Später allein', date: DAY, time: '23:00', endTime: '23:30' }),
                ev({ title: 'Morgen früh', date: NEXT, time: '10:00', endTime: '12:00' }),
            ],
        };
    }

    test('shows the events with their info texts, marks what runs and what is parallel', async ({ page }) => {
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        // rows=8 keeps everything on one page — paging has its own test below
        await page.goto('/kiosk/?rows=8');

        // Unlisted wall display: noindex, and none of the site chrome
        const robots = await page.locator('meta[name="robots"]').getAttribute('content');
        expect(robots).toContain('noindex');
        expect(await page.locator('nav, .footer__grid').count()).toBe(0);
        await expect(page.locator('#kiosk-clock')).toHaveText(/^19:30/);

        await expect(page.locator('.kiosk-ev')).toHaveCount(5);

        // The info text is the point of the view: it renders, and the raw URL
        // inside it does not — nobody reads a matrix.to link off a wall.
        const desc = page.locator('.kiosk-ev').filter({ hasText: 'Läuft seit langem' })
            .locator('.kiosk-ev__desc');
        await expect(desc).toHaveText('Kommt vorbei — wir haben Mate.');
        await expect(page.locator('.kiosk-ev__loc').first()).toContainText('Dorotheenstraße 101');

        // A description that is nothing BUT a link leaves no empty paragraph
        await expect(
            page.locator('.kiosk-ev').filter({ hasText: 'Parallel dazu' }).locator('.kiosk-ev__desc')
        ).toHaveCount(0);

        // Nothing anywhere on the wall renders a raw URL
        expect(await page.locator('.kiosk__list').innerText()).not.toMatch(/https?:\/\//);

        // "läuft" gates on the real end, both directions: the 4.5 h-old event
        // still runs, the one that ended half an hour ago does not.
        await expect(page.locator('.kiosk-ev--now .kiosk-ev__title'))
            .toHaveText(['Läuft seit langem', 'Parallel dazu']);

        // Parallel events are bracketed as such — all three overlap the long
        // one, including the short one that already ended inside it.
        await expect(page.locator('.kiosk-par')).toHaveCount(1);
        await expect(page.locator('.kiosk-par .kiosk-ev')).toHaveCount(3);
        await expect(page.locator('.kiosk-par__label')).toHaveCount(2);
        // "Später allein" starts after the bundle ends → not bracketed
        await expect(page.locator('.kiosk-par').filter({ hasText: 'Später allein' })).toHaveCount(0);

        // Days are labelled, today reverse-video via its own badge
        await expect(page.locator('.kiosk-day__label')).toHaveText(['HEUTE', 'MORGEN']);
        await expect(page.locator('.kiosk-day--today')).toHaveCount(1);

        await expect(page.locator('#kiosk-status')).toHaveText(/stand:.*quelle:/);
    });

    test('pages through the events without splitting a parallel bundle', async ({ page }) => {
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        // 3 fits the parallel bundle exactly; the bundle must never be cut
        await page.goto('/kiosk/?rows=3');

        await expect(page.locator('#kiosk-status')).toContainText('seite 1/2');
        await expect(page.locator('.kiosk-par .kiosk-ev')).toHaveCount(3);
        await expect(page.locator('.kiosk-ev')).toHaveCount(3);

        await page.clock.runFor(21_000);
        await expect(page.locator('#kiosk-status')).toContainText('seite 2/2');
        await expect(page.locator('.kiosk-ev__title').first()).toHaveText('Später allein');
    });

    test('rotates through every page with a page count that holds still', async ({ page }) => {
        // The pages are deliberately UNEVEN in height: short entries first,
        // long descriptions after. Measuring the fit against whichever page
        // happens to be up recomputes the page count on every flip, which
        // resets the index and strands the wall — and it only shows up when
        // pages differ in height, so an even fixture would pass either way.
        await page.clock.install({ time: NOW });
        const long = 'Ein absichtlich langer Infotext, der über mehrere Zeilen läuft und damit '
            + 'so viel Platz frisst wie die echten Beschreibungen aus dem Kalender, die bei '
            + 'zweihundert Zeichen gekappt werden.';
        await useEventsFixture(page, {
            lastSync: NOW.toISOString(),
            sources: [],
            events: Array.from({ length: 8 }, (_, i) => ({
                title: `Termin ${i + 1}`,
                subtitle: '',
                description: i < 4 ? '' : long,
                location: '',
                date: `2026-09-${String(10 + i).padStart(2, '0')}`,
                time: '19:00',
                endDate: `2026-09-${String(10 + i).padStart(2, '0')}`,
                endTime: '22:00',
                tags: [], type: '', source: 'bitcircus101', uid: `mixed-${i}`,
            })),
        });
        await page.setViewportSize({ width: 1000, height: 520 });
        await page.goto('/kiosk/?rows=4');

        const readPage = async () => {
            const m = /seite (\d+)\/(\d+)/.exec(await page.locator('#kiosk-status').innerText());
            expect(m, 'status line must report a page').not.toBeNull();
            return [Number(m[1]), Number(m[2])];
        };

        const [, total] = await readPage();
        expect(total).toBeGreaterThan(1);

        const seen = [];
        const shown = [];
        for (let i = 0; i < total; i++) {
            const [current, reported] = await readPage();
            // the count must not move under the rotation
            expect(reported).toBe(total);
            seen.push(current);
            shown.push(...await page.locator('.kiosk-ev__title').allInnerTexts());
            await page.clock.runFor(21_000);
        }
        // every page came up exactly once, in order, and it wrapped back to 1
        expect(seen).toEqual(Array.from({ length: total }, (_, i) => i + 1));
        expect((await readPage())[0]).toBe(1);

        // and one full rotation shows every event exactly once — a page break
        // must not drop an event or repeat it
        expect(shown).toEqual(Array.from({ length: 8 }, (_, i) => `Termin ${i + 1}`));
    });

    test('never pushes the status bar off a small screen, however long the texts', async ({ page }) => {
        // The status bar is the wall's honesty channel — "⚠ daten alt",
        // "⚠ offline seit N min". A long list must page, not shove it past the
        // bottom edge, so the renderer measures the fit instead of trusting a
        // hard-coded row count.
        await page.clock.install({ time: NOW });
        const many = {
            lastSync: NOW.toISOString(),
            sources: [],
            events: Array.from({ length: 12 }, (_, i) => ({
                title: `Termin ${i + 1}`,
                subtitle: '',
                description: 'Ein absichtlich langer Infotext, der über mehrere Zeilen läuft und '
                    + 'damit genau so viel Platz frisst wie die echten Beschreibungen aus dem '
                    + 'Kalender, die bei 200 Zeichen gekappt werden.',
                location: 'Dorotheenstraße 101, Bonn',
                date: `2026-09-${String(10 + i).padStart(2, '0')}`,
                time: '19:00',
                endDate: `2026-09-${String(10 + i).padStart(2, '0')}`,
                endTime: '22:00',
                tags: [], type: '', source: 'bitcircus101', uid: `many-${i}`,
            })),
        };
        await useEventsFixture(page, many);
        await page.setViewportSize({ width: 1000, height: 500 });
        // rows=12 asks for everything at once — the fit must overrule it
        await page.goto('/kiosk/?rows=12');

        await expect(page.locator('#kiosk-status')).toContainText('seite 1/');
        // toBeInViewport, not toBeVisible: an element pushed below the fold is
        // still "visible" to Playwright.
        await expect(page.locator('#kiosk-status')).toBeInViewport();
        await expect(page.locator('.kiosk-ev').first()).toBeInViewport();

        const overflow = await page.locator('.kiosk__list')
            .evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(overflow).toBeLessThanOrEqual(0);
        // and it really did drop events rather than squeeze them
        expect(await page.locator('.kiosk-ev').count()).toBeLessThan(12);
    });

    // ── settings: URL, panel, and the two staying in step ────────────────────

    test('a URL pins every setting, and the panel reflects what is on screen', async ({ page }) => {
        // The URL is how a wall gets pinned — hand a screen this link and it
        // must come up that way whatever anyone clicked on it before.
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        await page.goto('/kiosk/?palette=amber&theme=light&info=off&source=bitcircus101&dwell=45&rows=6');

        const root = page.locator('html');
        await expect(root).toHaveAttribute('data-palette', 'amber');
        await expect(root).toHaveAttribute('data-theme', 'light');
        // info=off drops the paragraph from the DOM, it does not merely hide it:
        // the page fit is measured, so a hidden one would still cost a break
        await expect(page.locator('.kiosk-ev__desc')).toHaveCount(0);
        // source=bitcircus101 hides the friendly spaces. Asserted on the event,
        // not on the source label: narrow screens drop the side column by
        // design, so a label check would pass for the wrong reason there.
        await expect(page.locator('.kiosk-ev').filter({ hasText: 'Parallel dazu' })).toHaveCount(0);

        // the panel opens from the ⚙ and shows the live values, not defaults
        await page.locator('#kiosk-settings-open').click();
        await expect(page.locator('#kiosk-settings')).toBeVisible();
        await expect(page.locator('#kiosk-set-palette .kiosk-set__opt--on')).toHaveText('bernstein');
        await expect(page.locator('#kiosk-set-info .kiosk-set__opt--on')).toHaveText('aus');
        await expect(page.locator('#kiosk-set-source .kiosk-set__opt--on')).toHaveText('nur bitcircus101');
        await expect(page.locator('#kiosk-set-dwell')).toHaveValue('45');
        await expect(page.locator('#kiosk-set-rows')).toHaveValue('6');

        // Escape closes it — a wall must not sit on an open settings panel
        await page.keyboard.press('Escape');
        await expect(page.locator('#kiosk-settings')).toBeHidden();

        // The promise only means something on a screen someone already fiddled
        // with — with an empty store, URL-first and storage-first look
        // identical. So put something in the store by hand (a URL alone does
        // NOT persist: a pinned link must not silently overwrite the local
        // choice) and only then check that a URL still overrules it.
        await page.locator('#kiosk-settings-open').click();
        await page.locator('#kiosk-set-palette .kiosk-set__opt', { hasText: 'weiß' }).click();
        await page.locator('#kiosk-set-info .kiosk-set__opt', { hasText: 'kurz' }).click();
        expect(await page.evaluate(() => localStorage.getItem('bc.kiosk.palette'))).toBe('mono');

        await page.goto('/kiosk/?palette=green&theme=dark&info=full&source=all');
        await expect(root).toHaveAttribute('data-palette', 'green');
        await expect(root).not.toHaveAttribute('data-theme', 'light');
        await expect(page.locator('.kiosk-ev__desc').first()).toBeVisible();
        await expect(page.locator('.kiosk-ev').filter({ hasText: 'Parallel dazu' })).toHaveCount(1);
    });

    test('the panel writes back to the URL, so the screen stays copyable', async ({ page }) => {
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        await page.goto('/kiosk/');

        // a default URL stays clean — no parameters for values nobody changed
        expect(new URL(page.url()).search).toBe('');

        await page.locator('#kiosk-settings-open').click();
        await page.locator('#kiosk-set-info .kiosk-set__opt', { hasText: 'kurz' }).click();
        await page.locator('#kiosk-set-palette .kiosk-set__opt', { hasText: 'rainbow' }).click();

        const q = new URL(page.url()).searchParams;
        expect(q.get('info')).toBe('short');
        expect(q.get('palette')).toBe('pride');
        // only the changed ones — theme was never touched
        expect(q.get('theme')).toBeNull();

        await expect(page.locator('html')).toHaveAttribute('data-palette', 'pride');
        await expect(page.locator('.kiosk__list')).toHaveClass(/kiosk__list--info-short/);

        // and it survives a reload without the URL, through storage
        await page.goto('/kiosk/');
        await expect(page.locator('html')).toHaveAttribute('data-palette', 'pride');

        // reset puts everything back and empties the URL again
        await page.locator('#kiosk-settings-open').click();
        await page.locator('#kiosk-set-reset').click();
        await expect(page.locator('html')).toHaveAttribute('data-palette', 'standard');
        expect(new URL(page.url()).search).toBe('');
    });

    test('the footer icons cycle colour and invert, and dwell really re-times the flip', async ({ page }) => {
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        await page.goto('/kiosk/?rows=3');

        // ◉ steps through the palettes and wraps
        const order = ['green', 'amber', 'mono', 'pride', 'standard'];
        for (const want of order) {
            await page.locator('#kiosk-palette').click();
            await expect(page.locator('html')).toHaveAttribute('data-palette', want);
        }

        // ◐ inverts and says so to assistive tech
        await page.locator('#kiosk-theme').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await expect(page.locator('#kiosk-theme')).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#kiosk-theme').click();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');

        // dwell must re-arm the running interval, not just be stored: at 60 s
        // the page must NOT have flipped after the old 20 s.
        await page.locator('#kiosk-settings-open').click();
        await page.locator('#kiosk-set-dwell').fill('60');
        await page.locator('#kiosk-set-dwell').blur();
        await page.keyboard.press('Escape');
        await expect(page.locator('#kiosk-status')).toContainText('seite 1/');

        await page.clock.runFor(25_000);
        await expect(page.locator('#kiosk-status')).toContainText('seite 1/');
        await page.clock.runFor(40_000);
        await expect(page.locator('#kiosk-status')).toContainText('seite 2/');
    });

    test('auto mode steps the colour and inverts once per full trip', async ({ page }) => {
        // Burn-in protection: a wall shows near-static text for weeks. Rotating
        // the hue alone leaves the same pixels lit, so a full trip through the
        // palettes must also flip light/dark — that is the part that helps.
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        await page.goto('/kiosk/?cycle=on&palette=standard&theme=dark');

        const root = page.locator('html');
        const STEP = 20 * 60_000; // CYCLE_MS
        // fastForward, not runFor: runFor replays every intermediate tick, and
        // the 1 s clock alone is 8000+ round trips across this much simulated
        // time. Here only the 20 min step matters.
        const step = () => page.clock.fastForward(STEP);

        for (const want of ['green', 'amber', 'mono', 'pride']) {
            await step();
            await expect(root).toHaveAttribute('data-palette', want);
            // no inversion mid-trip
            await expect(root).not.toHaveAttribute('data-theme', 'light');
        }

        // the step that wraps back to the first palette also inverts
        await step();
        await expect(root).toHaveAttribute('data-palette', 'standard');
        await expect(root).toHaveAttribute('data-theme', 'light');

        // and it is genuinely opt-in: off means nothing moves
        await page.goto('/kiosk/?cycle=off&palette=standard&theme=dark');
        await step();
        await step();
        await expect(root).toHaveAttribute('data-palette', 'standard');
        await expect(root).not.toHaveAttribute('data-theme', 'light');
    });

    test('rainbow mode colours the structure but leaves the text readable', async ({ page }) => {
        // Six-colour body text is a flag, not a timetable. The day labels and
        // rules take the stripes; the entries keep the normal ink.
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        await page.goto('/kiosk/?palette=pride&rows=12');

        const dayColors = await page.locator('.kiosk-day__label')
            .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
        expect(dayColors.length).toBeGreaterThan(1);
        // consecutive days differ — that is the whole point of the mode
        expect(new Set(dayColors).size).toBe(dayColors.length);

        // the event text does NOT take a stripe
        const titleColors = await page.locator('.kiosk-ev__title')
            .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
        expect(new Set(titleColors).size).toBe(1);
        expect(dayColors).not.toContain(titleColors[0]);
    });

    test('every control is big enough to tap on a phone', async ({ page }) => {
        // The kiosk is a wall display, but it is reached from a phone to set it
        // up — and that is the only time anyone touches these at all. Measured
        // before this gate existed: the footer icons came out 23x23, under the
        // WCAG 2.5.8 floor, and the settings rows 27-29px.
        //
        // Unlike .nav__util and the carousel dots, these do NOT keep a small
        // visible box with a grown ::after zone: those have neighbours within a
        // finger's width, so a wider zone would eat the next control's taps.
        // Here there is room, so the visible box is the zone.
        await page.setViewportSize({ width: 393, height: 727 });
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        await page.goto('/kiosk/');

        await expectHitZones(page, [
            ['#kiosk-theme', 40, 40],
            ['#kiosk-palette', 40, 40],
            ['#kiosk-settings-open', 40, 40],
        ]);

        await page.locator('#kiosk-settings-open').click();
        await expect(page.locator('#kiosk-settings')).toBeVisible();

        // The panel used to be anchored to the viewport, which laid it over the
        // very buttons that open and close it. Stated as geometry rather than
        // as a tap zone on purpose: a zone measurement shrinks by however much
        // the overlap happens to be, so it reads as "a bit small" — a partly
        // buried close button is not a sizing problem, and a gate that phrases
        // it as one lets a small overlap through.
        const clash = await page.evaluate(() => {
            const p = document.querySelector('.kiosk-settings').getBoundingClientRect();
            return [...document.querySelectorAll('.kiosk__ctl')]
                .map((el) => ({ el, b: el.getBoundingClientRect() }))
                .filter(({ b }) => b.left < p.right && b.right > p.left &&
                                   b.top < p.bottom && b.bottom > p.top)
                .map(({ el }) => el.id);
        });
        expect(clash, 'the open panel covers the controls that operate it').toEqual([]);

        await expectHitZones(page, [
            ['#kiosk-theme', 40, 40],
            ['#kiosk-palette', 40, 40],
            ['#kiosk-settings-open', 40, 40],
        ]);

        // Controls INSIDE the panel are scrolled in first — it is a scroll
        // container on a phone, and probing something clipped at its edge
        // measures the scroll position, not the control.
        for (const sel of ['#kiosk-set-rows', '#kiosk-set-dwell',
                           '#kiosk-set-reset', '#kiosk-settings-close']) {
            await page.locator(sel).scrollIntoViewIfNeeded();
            await expectHitZones(page, [[sel, 40, 40]]);
        }

        // The 16px checkbox is NOT the target — the label wraps it, so a tap
        // anywhere on the row toggles it, the same reading the events toolbar
        // takes. Measuring the input would fail on a control that is perfectly
        // tappable, so the labels are what gets swept.
        await page.locator('.kiosk-set__check').first().scrollIntoViewIfNeeded();
        const rows = await hitBoxes(page, '.kiosk-set__check, .kiosk-set__field');
        expect(rows.length, 'no settings rows measured').toBeGreaterThan(3);
        expect(
            rows.filter((z) => z.w < 40 || z.h < 40).map((z) => `${z.w}x${z.h} "${z.text}"`),
            'settings rows under the tap floor',
        ).toEqual([]);

        // The option chips are swept rather than listed, so a new one inherits
        // the gate. Row by row, each scrolled in first: the panel is a scroll
        // container on a phone, and a chip clipped at its edge genuinely has
        // less to hit right then — measured 29px instead of 43 that way, which
        // says where the panel was scrolled, not how big the chip is. A finger
        // scrolls before it taps; so does this.
        let measured = 0;
        for (const row of ['#kiosk-set-palette', '#kiosk-set-info', '#kiosk-set-source']) {
            await page.locator(row).scrollIntoViewIfNeeded();
            const chips = await hitBoxes(page, `${row} .kiosk-set__opt`);
            expect(chips.length, `${row}: no chips measured`).toBeGreaterThan(1);
            measured += chips.length;
            expect(
                chips.filter((z) => z.w < 40 || z.h < 40).map((z) => `${z.w}x${z.h} "${z.text}"`),
                `${row}: chips under the tap floor`,
            ).toEqual([]);
        }
        expect(measured, 'the sweep would be vacuous').toBeGreaterThan(8);
    });

    test('a junk URL parameter falls back instead of breaking the wall', async ({ page }) => {
        await page.clock.install({ time: NOW });
        await useEventsFixture(page, kioskData());
        await page.goto('/kiosk/?palette=chartreuse&info=maybe&rows=999&dwell=-3');

        await expect(page.locator('html')).toHaveAttribute('data-palette', 'standard');
        await expect(page.locator('.kiosk-ev__desc').first()).toBeVisible();
        // numbers clamp to their range rather than being taken literally
        await page.locator('#kiosk-settings-open').click();
        await expect(page.locator('#kiosk-set-rows')).toHaveValue('12');
        await expect(page.locator('#kiosk-set-dwell')).toHaveValue('5');
    });
});

// ─── Lite version ────────────────────────────────────────────────────────────

test.describe('Lite version', () => {
    // /lite/ is the ultra-light, zero-JS text view of the homepage. The point is
    // that it stays minimal — so we pin the invariants, not the prose.
    test('/lite/ is self-contained, script-free and noindex', async ({ request }) => {
        const res = await request.get('/lite/');
        expect(res.status()).toBe(200);
        const html = await res.text();
        // Alternate view of the homepage → kept out of the index
        expect(html).toMatch(/name=["']robots["'][^>]*noindex/i);
        // Minimal forever: no scripts, no external stylesheet (all CSS inline)
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
        // Always offers the way back to the full site
        expect(html).toMatch(/href=["']\.\.\/index\.html["']/);
    });

    test('every link on /lite/ is big enough to tap', async ({ page }) => {
        // The page is nothing but links, and each one is a single line of a 27px
        // line box carrying only ~19px of ink. The CSS spends that reserved
        // slack on the tap zone, which is why this is a sweep and not a list:
        // any new link inherits the rule, and any edit that drops it fails here.
        await page.goto('/lite/');
        const zones = await hitBoxes(page, 'a[href]:not(footer a)');
        // A sweep that measured nothing would pass without testing anything.
        expect(zones.length, 'no links measured — the sweep would be vacuous').toBeGreaterThan(15);
        const small = zones.filter((z) => z.w < 24 || z.h < 24);
        expect(small.map((z) => `${z.w}x${z.h} "${z.text}"`), 'links under the 24px WCAG floor').toEqual([]);

        // The footer is the one place 24 is out of reach. Its two links sit 7px
        // apart inside a run of text — "(große Grafik, Karte, Live-Termine) · …
        // · …" — so 23px is the hard ceiling before their zones start stealing
        // from each other, and only a visibly roomier footer would buy the last
        // pixel. WCAG 2.5.8 exempts a target inside a sentence for exactly this
        // reason. They are still measured, at the height the CSS does reach, so
        // they cannot quietly collapse back to bare text either.
        // Not "both": at a desktop width the second one wraps across two lines,
        // which puts its centre in the gap between them — the probe's blind spot,
        // and a link that tall needs no help anyway.
        const foot = await hitBoxes(page, 'footer a[href]');
        expect(foot.length, 'no footer links measured').toBeGreaterThan(0);
        // 20, not 23: bare footer links measure 17px and the rule takes them to
        // 23-25 depending on the font's metrics (CI's monospace reads a pixel
        // narrower than a local one — that spread is what made the first version
        // of this gate fail on the machine rather than on the page). Anything
        // from 18 to 23 tells those two states apart; 20 sits in the middle, so
        // the gate neither trips on a font nor sleeps through the rule going away.
        expect(foot.filter((z) => z.w < 24 || z.h < 20).map((z) => `${z.w}x${z.h} "${z.text}"`),
            'footer links below what the line box allows').toEqual([]);
    });
});

// ─── Internal Links ──────────────────────────────────────────────────────────

test.describe('Internal links', () => {
    test('all internal links and <link>/manifest resources resolve', async ({ page }) => {
        const pagesToCheck = [
            '/', '/events.html', '/support.html',
            '/raum-nutzen.html', '/impressum-datenschutz.html',
            '/dankedankedanke.html',
        ];
        const checked = new Set();
        const broken = [];

        for (const p of pagesToCheck) {
            await page.goto(p);
            const links = await page.locator('a[href]').evaluateAll((els) =>
                els
                    .map((el) => el.getAttribute('href'))
                    .filter((h) =>
                        h &&
                        !h.startsWith('http') &&
                        !h.startsWith('mailto:') &&
                        !h.startsWith('webcal:') &&
                        !h.startsWith('#') &&
                        !h.startsWith('tel:') &&
                        !h.endsWith('.ics') &&
                        !h.endsWith('.xml')
                    )
            );

            for (const href of links) {
                const clean = href.split('#')[0].split('?')[0];
                if (!clean || checked.has(clean)) continue;
                checked.add(clean);
                const res = await page.goto(clean);
                if (!res || res.status() >= 400) {
                    broken.push(`${p} → ${clean} (${res?.status() || 'no response'})`);
                }
            }
        }

        // <link href> resources + manifest-internal icons — a[href] above only
        // covers anchors, so favicon / apple-touch-icon / manifest / stylesheet
        // and the PWA icons referenced inside the manifest JSON went unchecked.
        // request.get probes each asset without navigating; serve.mjs strips ?v=.
        await page.goto('/');
        const resources = [];
        const linkHrefs = await page.locator('link[href]').evaluateAll((els) =>
            els
                .map((el) => el.getAttribute('href'))
                .filter((h) => h && !h.startsWith('http')) // canonical is absolute
        );
        for (const h of linkHrefs) resources.push(new URL(h, page.url()).href);

        const manifestHref = await page
            .locator('link[rel="manifest"]')
            .getAttribute('href');
        const manifestUrl = new URL(manifestHref, page.url()).href;
        const manifest = await (await page.request.get(manifestUrl)).json();
        for (const icon of manifest.icons || []) {
            resources.push(new URL(icon.src, manifestUrl).href);
        }

        for (const url of resources) {
            if (checked.has(url)) continue;
            checked.add(url);
            const res = await page.request.get(url);
            if (!res || res.status() >= 400) {
                broken.push(`resource → ${url} (${res?.status() || 'no response'})`);
            }
        }

        expect(broken).toEqual([]);
    });
});

// ─── Accessibility ───────────────────────────────────────────────────────────

test.describe('Accessibility', () => {
    test('aria-labels, alt texts and landmark roles', async ({ page }) => {
        await page.goto('/');

        // Carousel buttons
        await expect(page.locator('.carousel-button.prev')).toHaveAttribute('aria-label');
        await expect(page.locator('.carousel-button.next')).toHaveAttribute('aria-label');

        // Nav landmark
        await expect(page.locator('nav[aria-label]')).toBeVisible();

        // All images have alt
        const images = page.locator('img');
        const count = await images.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            expect(await images.nth(i).getAttribute('alt')).not.toBeNull();
        }

        // Footer landmark
        await expect(page.locator('[role="contentinfo"]')).toBeVisible();

        // Keyboard focus must stay visible on form controls: no outline:none
        // may swallow the global :focus-visible ring (the ascii editor is the
        // one form control that always exists without CI-generated data)
        await page.goto('/ascii/');
        const editor = page.locator('#ascii-editor');
        await expect(editor).toBeVisible();
        await editor.focus();
        expect(await editor.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
        expect(await editor.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');

        // Same page, so no extra navigation: the chrome links are 15-23px of ink
        // and carry the zone instead. Named one by one because the page has
        // exactly three links — a sweep would be ceremony. (The skip link is
        // off-screen until focused, which is the whole point of it.)
        //
        // Height 44, width 24: the CSS grows these zones vertically only, so the
        // width is however wide the words happen to render. Asserting 44 there
        // pinned a number the stylesheet does not control — "github" is 48px in
        // a local monospace and 40px in CI's, and the gate failed on the font
        // rather than on anything being hard to hit. 24 is the WCAG floor and
        // is what these actually have to clear.
        await expectHitZones(page, [
            ['.ascii-playground__home', 24, 44],
            ['.ascii-playground__foot a[href*="impressum"]', 24, 44],
            ['.ascii-playground__foot a[href*="github"]', 24, 44],
        ]);
    });
});

// ─── Light Theme Toggle (◐ invert) ───────────────────────────────────────────

test.describe('Light theme toggle', () => {
    test('toggles data-theme, persists across reload, inverts the page', async ({ page, context }) => {
        const errors = [];
        page.on('pageerror', (err) => errors.push(err.message));

        // Desktop viewport so the nav toggle isn't inside the collapsed mobile menu
        await page.setViewportSize({ width: 1280, height: 800 });
        await context.clearCookies();
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.removeItem('bc.theme'); } catch (e) {} });
        await page.reload();

        const toggle = page.locator('#theme-toggle');
        // A nav control: the claim is that it can be reached without scrolling,
        // which toBeVisible() does not check (see the utility-cluster test).
        await expect(toggle).toBeInViewport();
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        // Discriminating signal: the actual painted body background flips
        // between dark (sum < 60) and light (sum > 600), not just a token name.
        const bgSum = () => page.evaluate(() => {
            const [r, g, b] = getComputedStyle(document.body)
                .backgroundColor.match(/\d+/g).map(Number);
            return r + g + b;
        });
        expect(await bgSum()).toBeLessThan(60);

        // Switch to light: attribute, localStorage, aria-pressed all flip…
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
        expect(await page.evaluate(() => localStorage.getItem('bc.theme'))).toBe('light');
        // …and the light token block is actually painted
        expect(await bgSum()).toBeGreaterThan(600);

        // Persists across reload without flashing back to dark (no-flash head script)
        await page.reload();
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
        await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'true');
        expect(await bgSum()).toBeGreaterThan(600);

        // Toggle back to dark
        await page.locator('#theme-toggle').click();
        await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'false');
        expect(await page.evaluate(() => localStorage.getItem('bc.theme'))).toBe('dark');
        expect(await page.evaluate(() => document.documentElement.dataset.theme || '')).toBe('');
        expect(await bgSum()).toBeLessThan(60);

        expect(errors).toEqual([]);
    });
});
