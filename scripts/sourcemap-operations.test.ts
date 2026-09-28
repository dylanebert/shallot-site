import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { PreparedSourceMaps } from "./prepare-sourcemaps";
import { uploadSourceMaps } from "./upload-sourcemaps";

const prepared: PreparedSourceMaps[] = [
    {
        assets: "out/site/first-person/assets",
        plan: {
            service: "shallot-site",
            version: "build-test",
            minifiedPathPrefix: "https://shallot-staging.pages.dev/first-person/assets/",
            mapFiles: ["runtime.js.map"],
        },
    },
];

test("without explicit opt-in, upload refuses and never invokes its external boundary", () => {
    let boundaryCalls = 0;
    expect(() =>
        uploadSourceMaps(
            prepared,
            false,
            () => {
                boundaryCalls += 1;
                return 0;
            },
            { DATADOG_API_KEY: "dummy-not-a-secret" },
        ),
    ).toThrow("explicit --upload opt-in");
    expect(boundaryCalls).toBe(0);
}, 250);

test("the real child process sees only a dummy DATADOG_API_KEY marker through a local bunx shim", () => {
    const temp = mkdtempSync(join(tmpdir(), "sourcemap-upload-boundary-"));
    const marker = join(temp, "child-environment");
    const shim = join(temp, "bunx");
    writeFileSync(
        shim,
        '#!/bin/sh\nprintf \'%s\' "$DATADOG_API_KEY" > "$BOUNDARY_MARKER"\n[ "$DATADOG_API_KEY" = \'dummy-not-a-secret\' ]\n',
    );
    chmodSync(shim, 0o755);
    try {
        expect(() =>
            uploadSourceMaps(prepared, true, undefined, {
                DATADOG_API_KEY: "dummy-not-a-secret",
                BOUNDARY_MARKER: marker,
                PATH: `${temp}${delimiter}${process.env.PATH ?? ""}`,
            }),
        ).not.toThrow();
        expect(readFileSync(marker, "utf8")).toBe("dummy-not-a-secret");
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}, 20000);

test("an opted-in upload forwards the prepared build identity without a network call", () => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    uploadSourceMaps(
        prepared,
        true,
        (args, env) => {
            calls.push({ args, env });
            return 0;
        },
        { DATADOG_API_KEY: "dummy-not-a-secret" },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("datadog-ci");
    expect(calls[0]?.args).toContain("build-test");
    expect(calls[0]?.env.DATADOG_API_KEY).toBe("dummy-not-a-secret");
}, 250);
