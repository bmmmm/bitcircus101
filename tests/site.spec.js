// @ts-check
const { test, expect } = require('@playwright/test');

// ─── Home Page ───────────────────────────────────────────────────────────────

test.describe('Home page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('loads and shows title', async ({ page }) => {
        await expect(page).toHaveTitle(/bitcircus101/);
    });

    test('title contains Hackspace', async ({ page }) => {
        await expect(page).toHaveTitle(/Hackspace/);
    });

    test('has correct h1', async ({ page }) => {
        await expect(page.locator('h1')).toContainText('bitcircus101');
    });

    test('shows ASCII art', async ({ page }) => {
        await expect(page.locator('.ascii-art')).toBeVisible();
    });

    test('shows carousel with images', async ({ page }) => {
        await expect(page.locator('.carousel-container')).toBeVisible();
        await expect(page.locator('.carousel-item.active img')).toBeVisible();
    });

    test('carousel next/prev buttons work', async ({ page }) => {
        const activeDotBefore = await page.locator('.dot.active').getAttribute('aria-label');
        await page.locator('.carousel-button.next').click();
        // Wait for transition
        await page.waitForTimeout(200);
        const activeDotAfter = await page.locator('.dot.active').getAttribute('aria-label');
        expect(activeDotAfter).not.toBe(activeDotBefore);
    });

    test('shows support section with donation and rental CTAs', async ({ page }) => {
        await expect(page.locator('#support')).toBeVisible();
        await expect(page.locator('#support a[href="donations.html"]')).toBeVisible();
        await expect(page.locator('#support a[href="raum-mieten.html"]')).toBeVisible();
    });

    test('shows contact section', async ({ page }) => {
        await expect(page.locator('#contact')).toBeVisible();
        await expect(page.locator('#contact a[href^="mailto:"]')).toBeVisible();
    });

    test('has map button', async ({ page }) => {
        await expect(page.locator('#show-map-btn')).toBeVisible();
    });

    test('map loads on button click', async ({ page }) => {
        await page.locator('#show-map-btn').click();
        await expect(page.locator('#osm-map-container')).toBeVisible();
        const iframeSrc = await page.locator('#osm-map').getAttribute('src');
        expect(iframeSrc).toContain('openstreetmap.org');
    });
});

// ─── SEO & Meta ──────────────────────────────────────────────────────────────

test.describe('SEO meta tags', () => {
    test('home page has meta description', async ({ page }) => {
        await page.goto('/');
        const desc = await page.locator('meta[name="description"]').getAttribute('content');
        expect(desc).toBeTruthy();
        expect(desc.length).toBeGreaterThan(50);
    });

    test('home page has canonical URL', async ({ page }) => {
        await page.goto('/');
        const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
        expect(canonical).toContain('bitcircus101.de');
    });

    test('home page has Open Graph tags', async ({ page }) => {
        await page.goto('/');
        const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
        expect(ogTitle).toContain('bitcircus101');
    });

    test('home page has JSON-LD structured data', async ({ page }) => {
        await page.goto('/');
        const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
        expect(jsonLd).toBeTruthy();
        const data = JSON.parse(jsonLd);
        expect(data['@type']).toBeTruthy();
        expect(data.name).toContain('bitcircus101');
    });

    test('home page has theme-color meta', async ({ page }) => {
        await page.goto('/');
        const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
        expect(themeColor).toBeTruthy();
    });

    test('home page keywords include Hackspace Bonn', async ({ page }) => {
        await page.goto('/');
        const keywords = await page.locator('meta[name="keywords"]').getAttribute('content');
        expect(keywords.toLowerCase()).toContain('hackspace bonn');
    });

    test('home page body text mentions Hackspace', async ({ page }) => {
        await page.goto('/');
        const bodyText = await page.locator('main').innerText();
        expect(bodyText.toLowerCase()).toContain('hackspace');
    });

    test('raum-mieten page has rental keywords', async ({ page }) => {
        await page.goto('/raum-mieten.html');
        const keywords = await page.locator('meta[name="keywords"]').getAttribute('content');
        expect(keywords.toLowerCase()).toContain('raum mieten bonn');
    });

    test('events page has meta description', async ({ page }) => {
        await page.goto('/events.html');
        const desc = await page.locator('meta[name="description"]').getAttribute('content');
        expect(desc).toBeTruthy();
    });

    test('donations page has meta description', async ({ page }) => {
        await page.goto('/donations.html');
        const desc = await page.locator('meta[name="description"]').getAttribute('content');
        expect(desc).toBeTruthy();
    });
});

// ─── No Google Fonts ─────────────────────────────────────────────────────────

test.describe('Privacy – no external font loading', () => {
    test('no Google Fonts link tags', async ({ page }) => {
        await page.goto('/');
        const gFontsLinks = await page.locator('link[href*="fonts.googleapis.com"]').count();
        expect(gFontsLinks).toBe(0);
    });

    test('no Google Fonts preconnect', async ({ page }) => {
        await page.goto('/');
        const preconnects = await page.locator('link[rel="preconnect"][href*="google"]').count();
        expect(preconnects).toBe(0);
    });

    test('stylesheet does not load Google Fonts', async ({ page }) => {
        const requests = [];
        page.on('request', (req) => requests.push(req.url()));
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        const googleFontRequests = requests.filter(
            (url) => url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')
        );
        expect(googleFontRequests).toHaveLength(0);
    });
});

// ─── Navigation ──────────────────────────────────────────────────────────────

test.describe('Navigation', () => {
    test('desktop nav links are visible', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/');
        await expect(page.locator('nav a[href="events.html"]')).toBeVisible();
        await expect(page.locator('nav a[href="donations.html"]')).toBeVisible();
        await expect(page.locator('nav a[href="raum-mieten.html"]')).toBeVisible();
    });

    test('mobile menu toggle shows/hides nav', async ({ page }) => {
        await page.setViewportSize({ width: 400, height: 800 });
        await page.goto('/');
        const toggle = page.locator('#menu-toggle');
        await expect(toggle).toBeVisible();
        // nav ul starts hidden
        await expect(page.locator('nav ul')).not.toBeVisible();
        await toggle.click();
        await expect(page.locator('nav ul')).toBeVisible();
        await toggle.click();
        await expect(page.locator('nav ul')).not.toBeVisible();
    });

    test('nav links navigate correctly', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/');
        await page.locator('nav a[href="events.html"]').click();
        await expect(page).toHaveURL(/events\.html/);
    });
});

// ─── Events Page ─────────────────────────────────────────────────────────────

test.describe('Events page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/events.html');
    });

    test('loads with correct title', async ({ page }) => {
        await expect(page).toHaveTitle(/Veranstaltungen/);
    });

    test('shows events list section', async ({ page }) => {
        await expect(page.locator('#events-list')).toBeVisible();
        // Wait for events to load from JSON
        await expect(page.locator('.event-card').first()).toBeVisible({ timeout: 5000 });
    });

    test('shows subscribe and download links', async ({ page }) => {
        await expect(page.locator('.events-actions a').first()).toBeVisible();
    });

    test('shows linkup description', async ({ page }) => {
        await expect(page.locator('.linkup-description')).toBeVisible();
    });

    test('has RSS feed link', async ({ page }) => {
        const rssLink = page.locator('link[type="application/rss+xml"]');
        const href = await rssLink.getAttribute('href');
        expect(href).toContain('feed.xml');
    });

    test('has back link to home', async ({ page }) => {
        await expect(page.locator('.back-link a')).toBeVisible();
        await page.locator('.back-link a').click();
        await expect(page).toHaveURL(/index\.html|\/$/);
    });
});

// ─── Donations Page ───────────────────────────────────────────────────────────

test.describe('Donations page', () => {
    test('loads with correct title', async ({ page }) => {
        await page.goto('/donations.html');
        await expect(page).toHaveTitle(/Spenden/);
    });

    test('shows consent banner on load', async ({ page }) => {
        await page.goto('/donations.html');
        await expect(page.locator('#site-notice')).toBeVisible();
    });

    test('accept button dismisses banner', async ({ page }) => {
        await page.goto('/donations.html');
        const acceptBtn = page.locator('#site-notice button').first();
        await acceptBtn.click();
        await expect(page.locator('#site-notice')).not.toBeVisible();
    });
});

// ─── Raum Mieten Page ────────────────────────────────────────────────────────

test.describe('Raum mieten page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/raum-mieten.html');
    });

    test('loads with correct title', async ({ page }) => {
        await expect(page).toHaveTitle(/Raum nutzen|Raum mieten/);
    });

    test('title contains Bonn', async ({ page }) => {
        await expect(page).toHaveTitle(/Bonn/);
    });

    test('has contact CTA', async ({ page }) => {
        await expect(page.locator('a[href^="mailto:"][class*="btn"]')).toBeVisible();
    });

    test('has map button', async ({ page }) => {
        await expect(page.locator('#show-map-btn')).toBeVisible();
    });

    test('has JSON-LD structured data', async ({ page }) => {
        const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
        const data = JSON.parse(jsonLd);
        expect(data['@type']).toBe('EventVenue');
    });

    test('has back link', async ({ page }) => {
        await expect(page.locator('.back-link a')).toBeVisible();
    });
});

// ─── Impressum Page ───────────────────────────────────────────────────────────

test.describe('Impressum & Datenschutz page', () => {
    test('loads correctly', async ({ page }) => {
        await page.goto('/impressum-datenschutz.html');
        await expect(page).toHaveTitle(/Impressum/);
    });

    test('has back link', async ({ page }) => {
        await page.goto('/impressum-datenschutz.html');
        await expect(page.locator('.back-link a, a[href="index.html"]').first()).toBeVisible();
    });
});

// ─── Design – Terminal Theme ──────────────────────────────────────────────────

test.describe('Terminal theme', () => {
    test('body has dark background', async ({ page }) => {
        await page.goto('/');
        const bgColor = await page.evaluate(() =>
            window.getComputedStyle(document.body).backgroundColor
        );
        // dark background – rgb values should all be low
        const [r, g, b] = bgColor.match(/\d+/g).map(Number);
        expect(r + g + b).toBeLessThan(60); // very dark
    });

    test('uses monospace font', async ({ page }) => {
        await page.goto('/');
        const fontFamily = await page.evaluate(() =>
            window.getComputedStyle(document.body).fontFamily
        );
        // Should contain monospace keyword or a mono font name
        const isMonospace =
            fontFamily.toLowerCase().includes('monospace') ||
            fontFamily.toLowerCase().includes('courier') ||
            fontFamily.toLowerCase().includes('menlo') ||
            fontFamily.toLowerCase().includes('consolas');
        expect(isMonospace).toBe(true);
    });

    test('no inline styles remain on key elements', async ({ page }) => {
        await page.goto('/');
        // Check support CTA paragraph
        const donateP = page.locator('#support .text-center');
        await expect(donateP).toBeVisible();
        const inlineStyle = await donateP.getAttribute('style');
        expect(inlineStyle).toBeFalsy();
    });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

test.describe('Accessibility', () => {
    test('carousel buttons have aria-labels', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.carousel-button.prev')).toHaveAttribute('aria-label');
        await expect(page.locator('.carousel-button.next')).toHaveAttribute('aria-label');
    });

    test('nav has aria-label', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('nav[aria-label]')).toBeVisible();
    });

    test('images have alt attributes', async ({ page }) => {
        await page.goto('/');
        const images = page.locator('img');
        const count = await images.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const alt = await images.nth(i).getAttribute('alt');
            expect(alt).not.toBeNull();
        }
    });

    test('footer has contentinfo role', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('[role="contentinfo"]')).toBeVisible();
    });
});
