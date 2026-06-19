// @ts-check
const { test, expect } = require('@playwright/test');

// ─── Home Page ───────────────────────────────────────────────────────────────

test.describe('Home page', () => {
    test('loads with title, heading and ASCII art', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/bitcircus101/);
        await expect(page.locator('h1')).toContainText('bitcircus101');
        await expect(page.locator('.ascii-art')).toBeVisible();
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

        // Map
        await page.locator('#show-map-btn').click();
        await expect(page.locator('#osm-map-container')).toBeVisible();
        const iframeSrc = await page.locator('#osm-map').getAttribute('src');
        expect(iframeSrc).toContain('openstreetmap.org');

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
    test('desktop nav links are visible and work', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/');
        await expect(page.locator('nav a[href="events.html"]')).toBeVisible();
        await expect(page.locator('nav a[href="support.html"]')).toBeVisible();
        await expect(page.locator('nav a[href="raum-nutzen.html"]')).toBeVisible();
        // Utility cluster: the lite link sits beside RSS/calm
        await expect(page.locator('nav a[href="lite/"]')).toBeVisible();

        await page.locator('nav a[href="events.html"]').click();
        await expect(page).toHaveURL(/events\.html/);
    });

    test('mobile menu toggle shows/hides nav', async ({ page }) => {
        await page.setViewportSize({ width: 400, height: 800 });
        await page.goto('/');
        const toggle = page.locator('#menu-toggle');
        await expect(toggle).toBeVisible();
        await expect(page.locator('nav ul')).not.toBeVisible();
        await toggle.click();
        await expect(page.locator('nav ul')).toBeVisible();
        await toggle.click();
        await expect(page.locator('nav ul')).not.toBeVisible();
    });

    test('lite link stays reachable at every width', async ({ page }) => {
        // Regression: the utility cluster (lite · RSS · calm) used to be pushed
        // off-screen between ~700-1155px. It now shows inline on desktop and
        // drops to its own always-visible row in the condensed layout.
        await page.goto('/');
        const lite = page.locator('nav a[href="lite/"]');
        for (const width of [1280, 900, 400]) {
            await page.setViewportSize({ width, height: 800 });
            await expect(lite).toBeVisible();
        }
        // Condensed layout: the cluster shows without opening the menu, while
        // the content links stay collapsed behind the toggle.
        await expect(page.locator('nav ul.nav__links')).not.toBeVisible();
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
// These tests require events-data.json with real calendar data.
// In CI, the sync script may fail (network), producing an empty fixture.
// Tests that need real events check for their presence first.

test.describe('Events content', () => {
    test('tags, filtering and month grouping work when events are loaded', async ({ page }) => {
        await page.goto('/events.html');
        const card = page.locator('.event-card').first();
        if (!await card.isVisible({ timeout: 5000 }).catch(() => false)) return;

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
    });

    test('sync status labels are shown when data is available', async ({ page }) => {
        await page.goto('/events.html');
        const card = page.locator('.event-card').first();
        if (!await card.isVisible({ timeout: 5000 }).catch(() => false)) return;

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
        expect(html).toMatch(/http-equiv=["']refresh["'][^>]*support\.html/i);
        expect(html).toMatch(/rel=["']canonical["'][^>]*support\.html/i);
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
        if (count === 0) return; // no seed data in this environment

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

// ─── Design – Terminal Theme ─────────────────────────────────────────────────

test.describe('Terminal theme', () => {
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
    });
});

// ─── Calm Theme Toggle ───────────────────────────────────────────────────────

test.describe('Calm theme toggle', () => {
    test('toggles data-theme, persists across reload, applies calm tokens', async ({ page, context }) => {
        const errors = [];
        page.on('pageerror', (err) => errors.push(err.message));

        // Desktop viewport so the nav toggle isn't inside the collapsed mobile menu
        await page.setViewportSize({ width: 1280, height: 800 });
        await context.clearCookies();
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.removeItem('bc.theme'); } catch (e) {} });
        await page.reload();

        const toggle = page.locator('#theme-toggle');
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');

        // Default (loud): green accent token
        const accent = () => page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase()
        );
        expect(await accent()).toBe('#00d97e');

        // Switch to calm: attribute, localStorage, aria-pressed all flip…
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('calm');
        expect(await page.evaluate(() => localStorage.getItem('bc.theme'))).toBe('calm');
        // …and the calm token block is actually in effect (teal accent)
        expect(await accent()).toBe('#5fb89a');

        // Persists across reload without flashing back to loud (no-flash head script)
        await page.reload();
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('calm');
        await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'true');
        expect(await accent()).toBe('#5fb89a');

        // Toggle back to loud
        await page.locator('#theme-toggle').click();
        await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'false');
        expect(await page.evaluate(() => localStorage.getItem('bc.theme'))).toBe('loud');
        expect(await page.evaluate(() => document.documentElement.dataset.theme || '')).toBe('');
        expect(await accent()).toBe('#00d97e');

        expect(errors).toEqual([]);
    });
});
