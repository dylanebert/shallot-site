// Pure build-site decisions remain testable without the absent engine checkout or generated site.
// The integration build and artifact population belong to S8; these rows only cover the pure
// mode/dependency guards that can run against authored inputs.

import { expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { check } from "@dylanebert/shallot/harness/check";
import { llmsTxt } from "../src/home";
import { datadogInitSnippet, RUM_ENV_SNIPPET, RUM_ENV_SNIPPET_STAGING } from "../src/rum-config";
import {
    assertPinnedCandidateInputs,
    candidateInputScopes,
    rewriteSiteDependencies,
    shallotDependencies,
    workspaceExtensionDependencies,
} from "./build-site-logic";

check(
    "llms entry points at consumer references",
    {
        claim: "the agent entry points at the installed README and examples index, not contributor instructions",
    },
    () => {
        const text = llmsTxt("0.9.5", "abc123", "prod");
        expect(text).toContain(
            "[README](https://raw.githubusercontent.com/dylanebert/shallot/v0.9.5/README.md): setup, CLI, recipes, live demos and build targets.",
        );
        expect(text).toContain(
            "[Examples index](https://raw.githubusercontent.com/dylanebert/shallot/v0.9.5/examples/AGENTS.md): one line per recipe and showcase project, with the concept each teaches.",
        );
        expect(text).not.toContain("Consumer contract");
        expect(text).not.toContain("raw.githubusercontent.com/dylanebert/shallot/v0.9.5/AGENTS.md");
    },
);

// S1 (staging build mode) — datadogInitSnippet is a pure function, so its mode selection is
// armed behaviorally.
check(
    "build-site — datadogInitSnippet selects the env constant by mode, mutually exclusive",
    {
        claim: "build mode selects exactly one corresponding RUM environment snippet",
    },
    () => {
        const prod = datadogInitSnippet("prod");
        const staging = datadogInitSnippet("staging");
        expect(prod).toContain(RUM_ENV_SNIPPET);
        expect(prod).not.toContain(RUM_ENV_SNIPPET_STAGING);
        expect(staging).toContain(RUM_ENV_SNIPPET_STAGING);
        expect(staging).not.toContain(RUM_ENV_SNIPPET);
        // no mode arg defaults to prod — the prod build path stays byte-unchanged for a caller that
        // never learns about `--staging`
        expect(datadogInitSnippet()).toBe(prod);
    },
);

check(
    "RUM init — local previews and unapproved hosts never load the SDK",
    { claim: "no local or ordinary preview initializes/transmits RUM by default" },
    () => {
        for (const [mode, hostname, protocol] of [
            ["prod", "localhost", "http:"],
            ["prod", "192.168.1.8", "http:"],
            ["staging", "preview.example.test", "https:"],
            ["staging", "localhost", "http:"],
        ] as const) {
            const source = datadogInitSnippet(mode).match(/<script>([\s\S]*?)<\/script>/)?.[1];
            expect(source).toBeDefined();
            const document = {
                createElement() {
                    throw new Error("SDK must not load on this host");
                },
                getElementsByTagName() {
                    throw new Error("SDK must not load on this host");
                },
            };
            expect(() =>
                new Function("window", "document", "location", source!)({}, document, {
                    hostname,
                    protocol,
                }),
            ).not.toThrow();
        }
        for (const [mode, hostname] of [
            ["prod", "dylanebert.com"],
            ["prod", "sub.dylanebert.com"],
            ["staging", "main.shallot-staging.pages.dev"],
        ] as const) {
            let loaded = false;
            const document = {
                createElement() {
                    return {};
                },
                getElementsByTagName() {
                    return [
                        {
                            parentNode: {
                                insertBefore() {
                                    loaded = true;
                                },
                            },
                        },
                    ];
                },
            };
            const match = datadogInitSnippet(mode).match(/<script>([\s\S]*?)<\/script>/);
            expect(match).not.toBeNull();
            const source = match?.[1] ?? "";
            new Function("window", "document", "location", source)({}, document, {
                hostname,
                protocol: "https:",
            });
            expect(loaded).toBe(true);
        }
    },
);

check(
    "build-site — discovers workspace extensions and rewrites them in both engine modes",
    {
        claim: "ejected site dependencies rewrite the engine and every workspace extension pin",
    },
    () => {
        const authored = {
            dependencies: {
                "@dylanebert/shallot": "workspace:*",
                "@dylanebert/shallot-wave": "workspace:*",
                "@dylanebert/shallot-fixed": "1.2.3",
                typegpu: "~0.12.4",
            },
        };
        expect(shallotDependencies(authored)).toEqual([
            ["@dylanebert/shallot", "workspace:*"],
            ["@dylanebert/shallot-fixed", "1.2.3"],
            ["@dylanebert/shallot-wave", "workspace:*"],
        ]);
        expect(workspaceExtensionDependencies(authored)).toEqual(["@dylanebert/shallot-wave"]);

        for (const enginePin of ["0.8.0", "file:/tmp/shallot.tgz"]) {
            const pkg = structuredClone(authored);
            rewriteSiteDependencies(
                pkg,
                enginePin,
                new Map([["@dylanebert/shallot-wave", "file:/tmp/wave.tgz"]]),
            );
            expect(pkg.dependencies["@dylanebert/shallot"]).toBe(enginePin);
            expect(pkg.dependencies["@dylanebert/shallot-wave"]).toBe("file:/tmp/wave.tgz");
            expect(pkg.dependencies["@dylanebert/shallot-fixed"]).toBe("1.2.3");
        }
    },
);

check(
    "candidate build inputs — accepts clean pinned sources and refuses dirty copied or packed sources",
    { claim: "clean pinned inputs pass; copied or packed edits, deletions, and additions refuse" },
    () => {
        const repo = mkdtempSync(join(tmpdir(), "candidate-inputs-"));
        const run = (...args: string[]) => {
            const result = Bun.spawnSync(args, { cwd: repo });
            if (result.exitCode !== 0) throw new Error(result.stderr.toString());
        };
        const demoPrefix = "examples/showcase/demo/";
        const extensionPrefix = "packages/shallot-wave/";
        const scopes = candidateInputScopes("examples/showcase/", ["@dylanebert/shallot-wave"]);
        try {
            run("git", "init", "-q");
            run("git", "config", "user.email", "test@example.invalid");
            run("git", "config", "user.name", "Candidate input test");
            for (const dir of [
                resolve(repo, demoPrefix, "src"),
                resolve(repo, extensionPrefix, "src"),
            ])
                mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(repo, demoPrefix, ".gitignore"), "src/ignored.ts\n");
            writeFileSync(resolve(repo, demoPrefix, "src/index.ts"), "export const demo = 1;\n");
            writeFileSync(
                resolve(repo, extensionPrefix, "src/index.ts"),
                "export const wave = 1;\n",
            );
            run("git", "add", "-A");
            run("git", "commit", "-qm", "pinned input");
            const pinnedSha = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo })
                .stdout.toString()
                .trim();

            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).not.toThrow();
            writeFileSync(resolve(repo, demoPrefix, "src/index.ts"), "export const demo = 2;\n");
            expect(
                Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repo }).stdout.toString().trim(),
            ).toBe(pinnedSha);
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).toThrow(
                "examples/showcase/demo/src/index.ts",
            );
            writeFileSync(resolve(repo, demoPrefix, "src/index.ts"), "export const demo = 1;\n");
            rmSync(resolve(repo, demoPrefix, "src/index.ts"));
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).toThrow(
                "examples/showcase/demo/src/index.ts",
            );
            writeFileSync(resolve(repo, demoPrefix, "src/index.ts"), "export const demo = 1;\n");
            writeFileSync(
                resolve(repo, demoPrefix, "src/added.ts"),
                "export const added = true;\n",
            );
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).toThrow(
                "examples/showcase/demo/src/added.ts",
            );
            rmSync(resolve(repo, demoPrefix, "src/added.ts"));
            writeFileSync(
                resolve(repo, extensionPrefix, "src/added.ts"),
                "export const added = true;\n",
            );
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).toThrow(
                "packages/shallot-wave/src/added.ts",
            );
            rmSync(resolve(repo, extensionPrefix, "src/added.ts"));
            writeFileSync(
                resolve(repo, extensionPrefix, "src/index.ts"),
                "export const wave = 2;\n",
            );
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).toThrow(
                "packages/shallot-wave/src/index.ts",
            );
            rmSync(resolve(repo, extensionPrefix, "src/index.ts"));
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).toThrow(
                "packages/shallot-wave/src/index.ts",
            );
            writeFileSync(
                resolve(repo, extensionPrefix, "src/index.ts"),
                "export const wave = 1;\n",
            );

            const ignoredDemoSource = resolve(repo, demoPrefix, "src/ignored.ts");
            writeFileSync(ignoredDemoSource, "export const ignoredButCopied = true;\n");
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).toThrow(
                "examples/showcase/demo/src/ignored.ts",
            );
            rmSync(ignoredDemoSource);

            // Dependency and output trees are excluded from copying; dependency trees are not packed.
            for (const path of [
                resolve(repo, demoPrefix, "node_modules/pkg/index.js"),
                resolve(repo, demoPrefix, "dist/index.js"),
                resolve(repo, extensionPrefix, "node_modules/pkg/index.js"),
            ]) {
                mkdirSync(join(path, ".."), { recursive: true });
                writeFileSync(path, "generated");
            }
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).not.toThrow();

            // A new, untracked directory is not in the tracked roster and won't be copied. Once
            // staged, it becomes a candidate input and must refuse just like a tracked addition.
            const newDemo = resolve(repo, "examples/showcase/new-demo/src/index.ts");
            mkdirSync(join(newDemo, ".."), { recursive: true });
            writeFileSync(newDemo, "export const newDemo = true;\n");
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).not.toThrow();
            run("git", "add", "examples/showcase/new-demo/src/index.ts");
            expect(() => assertPinnedCandidateInputs(repo, pinnedSha, scopes)).toThrow(
                "examples/showcase/new-demo/src/index.ts",
            );
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    },
);

check(
    "build-site — refuses to leave a discovered workspace extension unpinned",
    {
        claim: "site ejection refuses an undiscovered workspace extension tarball",
    },
    () => {
        expect(() =>
            rewriteSiteDependencies(
                { dependencies: { "@dylanebert/shallot-wave": "workspace:*" } },
                "0.8.0",
                new Map(),
            ),
        ).toThrow("no packed tarball");
    },
);
