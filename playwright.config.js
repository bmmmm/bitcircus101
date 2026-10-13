// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// One port per checkout. With reuseExistingServer a second checkout on :8080
// would silently test the first checkout's files, so a linked worktree (its
// .git is a file, not a directory) gets a port derived from its path. No env
// var: a prefix in front of `pnpm run test:e2e` breaks its sandbox exclusion.
// tests/global-setup.js refuses a server that serves another checkout.
function checkoutPort() {
    try {
        if (!fs.statSync(path.join(__dirname, '.git')).isFile()) return 8080;
    } catch {
        return 8080;
    }
    let hash = 0;
    for (const ch of __dirname) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return 8100 + (hash % 800);
}
const PORT = checkoutPort();

module.exports = defineConfig({
    testDir: './tests',
    // Only site.spec.js is a Playwright suite. The *.spec.mjs files are
    // node:test units — without this scope Playwright imports them during
    // collection, which executes them as a side effect.
    testMatch: 'site.spec.js',
    // Generates the live-only event pages (e/<id>/, archiv/) from the events
    // fixture so the suite can open and link-check them — see the file.
    globalSetup: require.resolve('./tests/global-setup.js'),
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: 'list',

    use: {
        // Serve from local filesystem via static file server
        baseURL: `http://localhost:${PORT}`,
        trace: 'on-first-retry',
    },

    webServer: {
        // Node static server (tests/serve.mjs). Node is present everywhere we run —
        // including the Playwright Docker image CI uses, which ships no python3.
        command: `node tests/serve.mjs ${PORT}`,
        url: `http://localhost:${PORT}`,
        stdout: 'ignore',
        // Reuse the port when already serving (avoids bind errors if CI=1 is set locally).
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
