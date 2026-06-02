// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: 'list',

    use: {
        // Serve from local filesystem via static file server
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
    },

    webServer: {
        // Python's stdlib server (preinstalled on macOS/CI, ThreadingHTTPServer
        // since 3.7) — same server the README documents for local dev. Avoids
        // depending on `npx http-server` being fetchable/usable at run time.
        command: 'python3 -m http.server 8080',
        url: 'http://localhost:8080',
        stdout: 'ignore',
        // Reuse :8080 when already serving (avoids bind errors if CI=1 is set locally).
        // GitHub Actions always sets GITHUB_ACTIONS — there we always start a fresh server.
        reuseExistingServer: !process.env.GITHUB_ACTIONS,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'mobile-chrome',
            use: { ...devices['Pixel 5'] },
        },
    ],
});
