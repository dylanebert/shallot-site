import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { root } from "../src/engine";
import { applicationBuildId } from "../src/rum-build";
import { demoFingerprints, writeStamp } from "../src/site-stamp";
import type { PreparedSourceMaps } from "./prepare-sourcemaps";
import { prepareSourceMaps } from "./prepare-sourcemaps";
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

test("the real preparation path checks candidate identity, freshness and embedded source maps using only a local fixture", async () => {
    const temp = mkdtempSync(join(tmpdir(), "sourcemap-prepare-fixture-"));
    const engineRoot = join(temp, "engine");
    const examples = join(engineRoot, "examples");
    const outDir = join(temp, "out", "site");
    const slug = "fixture";
    mkdirSync(join(examples, slug), { recursive: true });
    mkdirSync(join(outDir, slug, "assets"), { recursive: true });
    writeFileSync(
        join(examples, slug, "package.json"),
        JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    const git = (args: string[]) => {
        const result = Bun.spawnSync(["git", ...args], {
            cwd: engineRoot,
            stdout: "pipe",
            stderr: "pipe",
        });
        if (result.exitCode !== 0) throw new Error(result.stderr.toString());
        return result.stdout.toString().trim();
    };
    try {
        git(["init"]);
        git(["config", "user.name", "Fixture"]);
        git(["config", "user.email", "fixture@example.invalid"]);
        git(["add", "."]);
        git([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "fixture",
        ]);
        const commit = git(["rev-parse", "HEAD"]);
        writeFileSync(join(outDir, slug, "assets", "app.js"), "throw new Error('fixture');\n");
        writeFileSync(
            join(outDir, slug, "assets", "app.js.map"),
            JSON.stringify({
                version: 3,
                sources: ["app.ts"],
                sourcesContent: ["throw new Error('fixture');"],
                mappings: "",
            }),
        );
        const buildId = applicationBuildId(commit);
        writeStamp(
            outDir,
            demoFingerprints(engineRoot, [slug], root),
            { kind: "staging", pin: commit, commit },
            buildId,
        );
        const beforeStamp = readFileSync(join(outDir, "build-stamp.json"), "utf8");
        const result = await prepareSourceMaps(outDir, "shallot-staging.pages.dev", {
            engineRoot,
            engineExamples: examples,
            engineCandidate: commit,
            engineCommit: commit,
            slugs: [slug],
        });
        expect(result).toHaveLength(1);
        expect(result[0]?.plan).toEqual({
            service: "shallot-site",
            version: buildId,
            minifiedPathPrefix: "https://shallot-staging.pages.dev/fixture/assets/",
            mapFiles: ["app.js.map"],
        });
        expect(readFileSync(join(outDir, "build-stamp.json"), "utf8")).toBe(beforeStamp);
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}, 20000);

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

test("an opted-in unit path exercises arguments through a fake and makes no network call", () => {
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
