import { expect } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { check } from "@dylanebert/shallot/harness/check";
import { root } from "../src/engine";
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

check(
    "sourcemaps:prepare — a dummy API key does not make local preparation mutate or upload",
    {
        claim: "the established prepare command only validates and prints, even when DD_API_KEY is set",
        size: "integration",
        budget: 20_000,
        subject: "scripts/prepare-sourcemaps.ts",
    },
    () => {
        const outDir = resolve(root, "out/site");
        const stampPath = resolve(outDir, "build-stamp.json");
        const before = createHash("sha256").update(readFileSync(stampPath)).digest("hex");
        const temp = mkdtempSync(join(tmpdir(), "sourcemap-dry-run-"));
        const marker = join(temp, "unexpected-upload");
        const shim = join(temp, "bunx");
        writeFileSync(shim, `#!/bin/sh\ntouch "$BOUNDARY_MARKER"\nexit 97\n`);
        chmodSync(shim, 0o755);
        try {
            const result = Bun.spawnSync([process.execPath, "run", "sourcemaps:prepare"], {
                cwd: root,
                env: {
                    ...process.env,
                    DD_API_KEY: "dummy-not-a-secret",
                    BOUNDARY_MARKER: marker,
                    PATH: `${temp}${delimiter}${process.env.PATH ?? ""}`,
                },
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(result.exitCode).toBe(0);
            expect(result.stdout.toString()).toContain("datadog-ci sourcemaps upload");
            expect(result.stdout.toString()).not.toContain("dummy-not-a-secret");
            expect(existsSync(marker)).toBe(false);
            const after = createHash("sha256").update(readFileSync(stampPath)).digest("hex");
            expect(after).toBe(before);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    },
);

check(
    "sourcemaps:upload — absent opt-in refuses before the uploader boundary",
    { claim: "without explicit opt-in, upload refuses and never invokes its external boundary" },
    () => {
        let boundaryCalls = 0;
        expect(() =>
            uploadSourceMaps(
                prepared,
                false,
                () => {
                    boundaryCalls += 1;
                    return 0;
                },
                { DD_API_KEY: "dummy-not-a-secret" },
            ),
        ).toThrow("explicit --upload opt-in");
        expect(boundaryCalls).toBe(0);
    },
);

check(
    "sourcemaps:upload — tests replace the real upload boundary",
    { claim: "an opted-in unit path exercises arguments through a fake and makes no network call" },
    () => {
        const calls: string[][] = [];
        uploadSourceMaps(
            prepared,
            true,
            (args) => {
                calls.push(args);
                return 0;
            },
            { DD_API_KEY: "dummy-not-a-secret" },
        );
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain("datadog-ci");
        expect(calls[0]).toContain("build-test");
    },
);
