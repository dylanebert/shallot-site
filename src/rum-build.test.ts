import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    applicationBuildId,
    formatSourceMapUploadCommand,
    sourceMapUploadPlan,
    validateSourceMaps,
} from "./rum-build";

test("runtime and source-map service version is deterministic and changes with installed Shallot version", () => {
    expect(applicationBuildId("0.10.0-next.1")).toBe(applicationBuildId("0.10.0-next.1"));
    expect(applicationBuildId("0.10.0-next.1")).not.toBe(applicationBuildId("0.10.0-next.2"));
}, 250);

test("upload preparation uses the exact runtime identity and deployed asset prefix without a network call", () => {
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
        const plan = sourceMapUploadPlan("first-person", "staging", "build-123", ["rum.js.map"]);
        expect(plan).toEqual({
            service: "shallot-site",
            version: "build-123",
            minifiedPathPrefix: "https://shallot-staging.pages.dev/first-person/assets/",
            mapFiles: ["rum.js.map"],
        });
        expect(formatSourceMapUploadCommand("out/site/first-person/assets", plan)).toBe(
            'datadog-ci sourcemaps upload "out/site/first-person/assets" --service "shallot-site" --release-version "build-123" --minified-path-prefix "https://shallot-staging.pages.dev/first-person/assets/"',
        );
        expect(() =>
            sourceMapUploadPlan("first-person", "staging", "build-123", [], "bad.example"),
        ).toThrow("invalid staging Pages hostname");
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
}, 250);
