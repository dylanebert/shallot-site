import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "@dylanebert/shallot/harness/check";
import {
    applicationBuildId,
    formatSourceMapUploadCommand,
    sourceMapUploadPlan,
    validateSourceMaps,
} from "./rum-build";

check(
    "RUM build identity covers the pinned engine and site inputs",
    {
        claim: "runtime and source-map service version is deterministic and changes with engine identity",
    },
    () => {
        expect(applicationBuildId("engine-a")).toBe(applicationBuildId("engine-a"));
        expect(applicationBuildId("engine-a")).not.toBe(applicationBuildId("engine-b"));
    },
);

check(
    "RUM source-map preparation validates pairs and preserves service/version/path",
    {
        claim: "upload preparation uses the exact runtime identity and deployed asset prefix without a network call",
    },
    () => {
        const dir = mkdtempSync(join(tmpdir(), "rum-maps-"));
        try {
            mkdirSync(join(dir, "assets"), { recursive: true });
            writeFileSync(join(dir, "assets", "rum.js"), "throw new Error();\n");
            writeFileSync(
                join(dir, "assets", "rum.js.map"),
                JSON.stringify({
                    sources: ["src/rum-runtime.ts"],
                    sourcesContent: ["throw new Error();"],
                }),
            );
            expect(validateSourceMaps(join(dir, "assets"))).toEqual(["rum.js.map"]);
            const plan = sourceMapUploadPlan("first-person", "staging", "build-123", [
                "rum.js.map",
            ]);
            expect(plan).toEqual({
                service: "shallot-site",
                version: "build-123",
                minifiedPathPrefix: "https://main.shallot-staging.pages.dev/first-person/assets/",
                mapFiles: ["rum.js.map"],
            });
            expect(formatSourceMapUploadCommand("out/site/first-person/assets", plan)).toBe(
                'datadog-ci sourcemaps upload "out/site/first-person/assets" --service "shallot-site" --release-version "build-123" --minified-path-prefix "https://main.shallot-staging.pages.dev/first-person/assets/"',
            );
            writeFileSync(
                join(dir, "assets", "rum.js.map"),
                JSON.stringify({ sourcesContent: [null] }),
            );
            expect(() => validateSourceMaps(join(dir, "assets"))).toThrow("sourcesContent");
            rmSync(join(dir, "assets", "rum.js"));
            expect(() => validateSourceMaps(join(dir, "assets"))).toThrow("matching bundle");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
);
