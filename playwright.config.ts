import { BROWSER_CONFIG, TIMEOUT, WEB_SERVER_CONFIG } from "@dylanebert/shallot/testing";
import { defineConfig } from "playwright/test";

export default defineConfig({
    ...BROWSER_CONFIG,
    testDir: "./tests",
    timeout: TIMEOUT.browser,
    workers: 1,
    use: { ...BROWSER_CONFIG.use, baseURL: "http://127.0.0.1:4175/shallot/" },
    webServer: {
        ...WEB_SERVER_CONFIG,
        command: "bun scripts/serve-site.ts",
        url: "http://127.0.0.1:4175/shallot/",
    },
});
