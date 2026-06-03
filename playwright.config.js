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
        // Node static server (tests/serve.mjs). Node is present everywhere we run —
        // including the Playwright Docker image CI uses, which ships no python3.
        command: 'node tests/serve.mjs 8080',
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
