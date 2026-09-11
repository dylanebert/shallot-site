// Pure build-site decisions remain testable without the absent engine checkout or generated site.
// The integration build and artifact population belong to S8; these rows only cover the pure
// mode/dependency guards that can run against authored inputs.

import { expect, test } from "bun:test";
import { datadogInitSnippet, RUM_ENV_SNIPPET, RUM_ENV_SNIPPET_STAGING } from "../src/rum-config";
import {
    rewriteSiteDependencies,
    shallotDependencies,
    workspaceExtensionDependencies,
} from "./build-site-logic";

// S1 (staging build mode) — datadogInitSnippet is a pure function, so its mode selection is
// armed behaviorally.
test("build-site — datadogInitSnippet selects the env constant by mode, mutually exclusive", () => {
    const prod = datadogInitSnippet("prod");
    const staging = datadogInitSnippet("staging");
    expect(prod).toContain(RUM_ENV_SNIPPET);
    expect(prod).not.toContain(RUM_ENV_SNIPPET_STAGING);
    expect(staging).toContain(RUM_ENV_SNIPPET_STAGING);
    expect(staging).not.toContain(RUM_ENV_SNIPPET);
    // no mode arg defaults to prod — the prod build path stays byte-unchanged for a caller that
    // never learns about `--staging`
    expect(datadogInitSnippet()).toBe(prod);
});

test("build-site — discovers workspace extensions and rewrites them in both engine modes", () => {
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
});

test("build-site — refuses to leave a discovered workspace extension unpinned", () => {
    expect(() =>
        rewriteSiteDependencies(
            { dependencies: { "@dylanebert/shallot-wave": "workspace:*" } },
            "0.8.0",
            new Map(),
        ),
    ).toThrow("no packed tarball");
});
