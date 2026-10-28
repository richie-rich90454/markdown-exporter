import { defineConfig, devices } from "@playwright/test";

const browserMatrix = process.env.PLAYWRIGHT_BROWSER_MATRIX === "1";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:4173"
    },
    webServer: {
        command: "pnpm run build:test && pnpm run preview:test",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 180000
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] }
        },
        ...(browserMatrix
            ? [
                  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
                  { name: "webkit", use: { ...devices["Desktop Safari"] } }
              ]
            : [])
    ]
});
