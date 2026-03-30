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
        await expect(page.locator('#support a[href="donations.html"]')).toBeVisible();
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
        await page.waitForTimeout(200);
        const activeDotAfter = await page.locator('.dot.active').getAttribute('aria-label');
        expect(activeDotAfter).not.toBe(activeDotBefore);

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

        // Keywords
        const keywords = await page.locator('meta[name="keywords"]').getAttribute('content');
        expect(keywords.toLowerCase()).toContain('hackspace bonn');
    });

    test('subpages have meta descriptions and keywords', async ({ page }) => {
        // Events
        await page.goto('/events.html');
        expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();

        // Donations
        await page.goto('/donations.html');
        expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();

        // Raum nutzen
        await page.goto('/raum-nutzen.html');
        const keywords = await page.locator('meta[name="keywords"]').getAttribute('content');
        expect(keywords.toLowerCase()).toContain('raum mieten bonn');
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
        await expect(page.locator('nav a[href="donations.html"]')).toBeVisible();
        await expect(page.locator('nav a[href="raum-nutzen.html"]')).toBeVisible();

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

// ─── Subpages ────────────────────────────────────────────────────────────────

test.describe('Donations page', () => {
    test('consent, embedded widgets, decline fallbacks, and remembered consent', async ({ page, context }) => {
        await context.clearCookies();
        await page.goto('/donations.html');
        await page.evaluate(() => localStorage.removeItem('bitcircus-cookie-consent'));
        await page.reload();
        await expect(page).toHaveTitle(/Unterstütz/);
        await expect(page.locator('#site-notice')).toBeVisible();
        await expect(page.locator('#donations-heading')).toContainText(
            /bitcircus101 unterstützen: Licht anlassen/,
        );

        await page.locator('#cookie-consent-accept').click();
        await expect(page.locator('#site-notice')).not.toBeVisible();
        await expect(page.locator('#donation-content')).toBeVisible();
        await expect(page.locator('#donation-content a[href*="paypal.com/paypalme"]')).toBeVisible();
        const kofiIframe = page.locator('#kofiframe');
        await expect(kofiIframe).toBeVisible();
        expect(await kofiIframe.getAttribute('loading')).toBe('lazy');

        await page.goto('/donations.html');
        await expect(page.locator('#site-notice')).not.toBeVisible();
        await expect(page.locator('#donation-content')).toBeVisible();

        await page.evaluate(() => localStorage.removeItem('bitcircus-cookie-consent'));
        await page.reload();
        await expect(page.locator('#site-notice')).toBeVisible();
        await page.locator('#cookie-consent-decline').click();
        await expect(page.locator('#donation-fallback')).toBeVisible();
        await expect(page.locator('#donation-fallback a[href*="ko-fi.com/bmabma"]')).toBeVisible();
        await expect(page.locator('#donation-content')).toBeHidden();

        await page.locator('#show-map-btn').click();
        await expect(page.locator('#osm-map')).toHaveAttribute('src', /openstreetmap\.org\/export\/embed/);
    });

    test('loads widgets when consent was already saved (new session)', async ({ page, context }) => {
        const fresh = await context.newPage();
        await fresh.addInitScript(() => {
            localStorage.setItem('bitcircus-cookie-consent', 'accepted');
        });
        await fresh.goto('/donations.html');
        await expect(fresh.locator('#site-notice')).not.toBeVisible();
        await expect(fresh.locator('#donation-content')).toBeVisible();
        await fresh.close();
    });
});

test.describe('Raum nutzen page', () => {
    test('loads with title, CTA and structured data', async ({ page }) => {
        await page.goto('/raum-nutzen.html');
        await expect(page).toHaveTitle(/Raum nutzen|Raum mieten/);
        await expect(page.locator('a[href^="mailto:"][class*="btn"]')).toBeVisible();
        await expect(page.locator('#show-map-btn')).toBeVisible();
        await expect(page.locator('.back-link a')).toBeVisible();

        const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
        const data = JSON.parse(jsonLd);
        expect(data['@type']).toBe('EventVenue');
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
        ['/donations.html', 'Donations'],
        ['/raum-nutzen.html', 'Raum nutzen'],
        ['/impressum-datenschutz.html', 'Impressum'],
        ['/dankedankedanke.html', 'Danke'],
        ['/ascii/', 'ASCII playground'],
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

// ─── Internal Links ──────────────────────────────────────────────────────────

test.describe('Internal links', () => {
    test('all internal links resolve to valid pages', async ({ page }) => {
        const pagesToCheck = [
            '/', '/events.html', '/donations.html',
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
