// Pure build-site decisions remain testable without the absent engine checkout or generated site.
// The integration build and artifact population belong to S8; these rows only cover the pure
// mode/dependency guards that can run against authored inputs.

import { expect } from "bun:test";
import { check } from "@dylanebert/shallot/harness/check";
import { llmsTxt } from "../src/home";
import { datadogInitSnippet, RUM_ENV_SNIPPET, RUM_ENV_SNIPPET_STAGING } from "../src/rum-config";
import {
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
