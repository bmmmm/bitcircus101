const fs = require('node:fs');
const { join } = require('node:path');
const { test, expect } = require('@playwright/test');

test.describe('On rails', () => {
    test('turns visible wheel spokes around fixed axles and stops them on arrival', async ({ page }) => {
        await page.goto('/anmeldung/');
        const wheels = page.locator('.rail-bogies .rail-wheel');
        await expect(wheels).toHaveCount(12);
        const sample = await page.evaluate(() => {
            document.getAnimations().forEach((animation) => animation.pause());
            document.querySelector('.rail-train').getAnimations()[0].currentTime = 2400;
            const wheel = [...document.querySelectorAll('.rail-bogies .rail-wheel')].at(-1);
            const animation = wheel.getAnimations()[0];
            const read = () => {
                const matrix = wheel.getScreenCTM();
                const center = new DOMPoint(0, 0).matrixTransform(matrix);
                return { x: center.x, y: center.y, a: matrix.a, b: matrix.b };
            };
            animation.currentTime = 1800;
            const before = read();
            animation.currentTime = 1900;
            const after = read();
            return { before, after };
        });
        expect(sample.after.x).toBeCloseTo(sample.before.x, 4);
        expect(sample.after.y).toBeCloseTo(sample.before.y, 4);
        expect(Math.abs(sample.after.a - sample.before.a) + Math.abs(sample.after.b - sample.before.b)).toBeGreaterThan(0.05);
        // Compare the same rendered axle area at two wheel angles: checking a
        // definition's animation alone missed the stationary SVG instances.
        const clip = { x: Math.floor(sample.after.x) - 12, y: Math.floor(sample.after.y) - 12, width: 24, height: 24 };
        const firstFrame = await page.screenshot({ clip });
        await wheels.last().evaluate((wheel) => { wheel.getAnimations()[0].currentTime = 2000; });
        const nextFrame = await page.screenshot({ clip });
        expect(firstFrame.equals(nextFrame)).toBe(false);
        await page.evaluate(() => document.getAnimations().forEach((animation) => animation.finish()));
        await expect(page.locator('.rail-train')).not.toHaveClass(/is-arriving/);
        expect(await wheels.evaluateAll((items) => items.every((wheel) => wheel.getAnimations().length === 0))).toBe(true);
    });

    test('validates, previews a ticket and downloads a calendar without sending data', async ({ page }, testInfo) => {
        const desktop = testInfo.project.name === 'chromium';
        await page.setViewportSize(desktop ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
        const apiCalls = [];
        page.on('request', (request) => { if (request.url().includes('/api/anmelden')) apiCalls.push(request.url()); });
        await page.goto('/anmeldung/');
        await expect(page.locator('#rail-submit')).toBeEnabled();
        await expect(page.locator('.rail-train')).not.toHaveClass(/is-arriving/);
        await expect(page.locator('#vorname')).not.toHaveAttribute('aria-invalid');
        const shot = testInfo.project.name === 'chromium' ? 'desktop' : 'mobile';
        fs.mkdirSync(join(__dirname, '../.impeccable/review'), { recursive: true });
        await page.screenshot({ path: join(__dirname, `../.impeccable/review/${shot}.png`), fullPage: true });
        if (desktop) {
            await page.setViewportSize({ width: 984, height: 972 });
            await page.screenshot({ path: join(__dirname, '../.impeccable/review/user-984.png'), fullPage: true });
            await page.setViewportSize({ width: 1440, height: 1000 });
        }
        await page.locator('#rail-submit').click();
        await expect(page.locator('#vorname')).toBeFocused();
        await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
        await page.getByLabel('Vorname', { exact: true }).fill('<b>Ada</b>');
        await page.getByLabel('Nachname', { exact: true }).fill('Lovelace');
        await page.getByLabel('E-Mail', { exact: true }).fill('ada@example.test');
        await page.locator('#rail-submit').click();
        await page.waitForURL('**/anmeldung/danke.html');
        await expect(page.locator('#rail-welcome')).toHaveText('Willkommen an Bord, <b>Ada</b>.');
        await expect(page.locator('#rail-welcome b')).toHaveCount(0);
        await expect(page.locator('#rail-ticket-preview')).toBeVisible();
        await expect(page.locator('#rail-confirmation-mail')).toBeHidden();
        expect(apiCalls).toEqual([]);
        expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
        expect(page.url()).not.toContain('?');
        await page.screenshot({ path: join(__dirname, `../.impeccable/review/ticket-${shot}.png`), fullPage: true });
        const downloaded = page.waitForEvent('download');
        await page.locator('#rail-calendar').click();
        const file = await downloaded;
        expect(file.suggestedFilename()).toBe('bitcircus101-on-rails.ics');
        expect(fs.readFileSync(await file.path(), 'utf8')).toContain('DTSTART:20270123T100000Z');
        const response = await page.reload();
        expect(response.headers()['cache-control']).toBe('no-store');
        await expect(page.locator('#rail-welcome')).toHaveText('Dein nächster Halt.');
        await page.locator('.rail-theme').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await expect(page.locator('#rail-calendar')).toBeEnabled();
        await expect(page.locator('#rail-calendar')).toHaveCSS('color', 'rgb(245, 245, 242)');
        await expect(page.locator('#rail-calendar')).toHaveCSS('background-color', 'rgb(21, 128, 61)');
        await page.screenshot({ path: join(__dirname, `../.impeccable/review/ticket-light-${shot}.png`), fullPage: true });
    });

    test('preserves input on API errors and confirms only after server success', async ({ page }) => {
        await page.route('**/anmeldung/event.mjs', async (route) => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace("registrationMode: 'preview'", "registrationMode: 'live'") });
        });
        let attempts = 0;
        await page.route('**/api/anmelden', async (route) => {
            attempts++;
            const payload = route.request().postDataJSON();
            expect(payload.eventId).toBe('bitcircus101-on-rails-2027');
            expect(payload.startedAt).toBeLessThanOrEqual(Date.now() - 3000);
            await route.fulfill({ status: attempts === 1 ? 503 : attempts === 2 ? 409 : 200, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { ok: false, error: 'Bitte später erneut versuchen.' } : attempts === 2 ? { ok: false, error: 'Du stehst schon auf der Liste.' } : { ok: true }) });
        });
        await page.goto('/anmeldung/');
        await expect(page.locator('#rail-preview-note')).toBeHidden();
        await page.getByLabel('Vorname', { exact: true }).fill('Ada');
        await page.getByLabel('Nachname', { exact: true }).fill('Lovelace');
        await page.getByLabel('E-Mail', { exact: true }).fill('ada@example.test');
        await page.locator('#rail-submit').click();
        await expect(page.locator('#rail-form-status')).toHaveText('Bitte später erneut versuchen.');
        await expect(page.locator('#email')).toHaveValue('ada@example.test');
        await page.locator('#rail-submit').click();
        await expect(page.locator('#rail-form-status')).toHaveText('Du stehst schon auf der Liste.');
        await page.locator('#rail-submit').click();
        await page.waitForURL('**/anmeldung/danke.html');
        await expect(page.locator('#rail-ticket-state')).toHaveText('ANGEMELDET');
        await expect(page.locator('#rail-ticket-preview')).toBeHidden();
        await expect(page.locator('#rail-confirmation-mail')).toBeVisible();
        expect(attempts).toBe(3);
    });

    test('parks with reduced motion and works without storage or JavaScript', async ({ browser, page, baseURL }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript(() => {
            Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
            Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
        });
        await page.goto('/anmeldung/');
        await expect(page.locator('.rail-train')).not.toHaveClass(/is-arriving/);
        for (const width of [320, 390, 540, 768, 914, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
            const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth, overflow: [...document.querySelectorAll('body *')].filter((el) => !el.closest('.rail-scene')).filter((el) => el.getBoundingClientRect().right > innerWidth).map((el) => `${el.tagName}.${el.className}: ${el.getBoundingClientRect().right}`).slice(0, 8), fields: [...document.querySelectorAll('.rail-field input')].map((el) => ({ x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right, height: el.getBoundingClientRect().height, font: getComputedStyle(el).fontSize })), animations: document.querySelector('.rail-train').getAnimations().length }));
            expect(dimensions.scroll, JSON.stringify(dimensions.overflow)).toBe(dimensions.viewport);
            expect(dimensions.animations).toBe(0);
            for (const field of dimensions.fields) { expect(field.x).toBeGreaterThanOrEqual(0); expect(field.right).toBeLessThanOrEqual(width); expect(field.height).toBeGreaterThanOrEqual(44); expect(field.font).toBe('16px'); }
        }
        await page.getByLabel('Vorname', { exact: true }).fill('Ada');
        await page.getByLabel('Nachname', { exact: true }).fill('Lovelace');
        await page.getByLabel('E-Mail', { exact: true }).fill('ada@example.test');
        await page.locator('#rail-submit').click();
        await page.waitForURL('**/anmeldung/danke.html');
        await expect(page.locator('#rail-welcome')).toHaveText('Dein nächster Halt.');
        await expect(page.locator('#rail-ticket-preview')).toBeVisible();
        await page.locator('.rail-theme').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
        const noJs = await context.newPage();
        await noJs.goto(`${baseURL}/anmeldung/`);
        await expect(noJs.locator('noscript')).toBeVisible();
        await expect(noJs.locator('#rail-submit')).toBeDisabled();
        await expect(noJs.locator('.rail-train')).toBeVisible();
        await context.close();
    });
});
