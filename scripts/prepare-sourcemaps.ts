import { relative, resolve, sep } from "node:path";
import { engineCandidate, engineCommit, engineExamples, engineRoot, root } from "../src/engine";
import { ROSTER } from "../src/roster";
import {
    applicationBuildId,
    formatSourceMapUploadCommand,
    type SourceMapUploadPlan,
    sourceMapUploadPlan,
    validateSourceMaps,
} from "../src/rum-build";
import { readStamp, staleDemos } from "../src/site-stamp";
import {
    assertPinnedCandidateInputs,
    candidateInputScopes,
    workspaceExtensionDependencies,
} from "./build-site-logic";

export interface PreparedSourceMaps {
    assets: string;
    plan: SourceMapUploadPlan;
}

/** Injectable checkout identities keep preparation tests hermetic; production uses pinned defaults. */
export interface SourceMapPreparationContext {
    engineRoot: string;
    engineExamples: string;
    engineCandidate: string;
    engineCommit: string;
    slugs: string[];
}

/** Validate one stamped candidate artifact and produce its upload plans without external effects. */
export async function prepareSourceMaps(
    artifactDir = resolve(root, "out/site"),
    hostname = "shallot-staging.pages.dev",
    context: Partial<SourceMapPreparationContext> = {},
): Promise<PreparedSourceMaps[]> {
    const checkout = context.engineRoot ?? engineRoot;
    const examples = context.engineExamples ?? engineExamples();
    const candidate = context.engineCandidate ?? engineCandidate;
    const commit = context.engineCommit ?? engineCommit();
    const slugs = context.slugs ?? ROSTER.map(({ slug }) => slug);
    const outDir = resolve(artifactDir);
    const stamp = readStamp(outDir);
    if (!stamp) throw new Error(`no valid build stamp at ${outDir}`);
    if (stamp.mode.kind !== "staging")
        throw new Error("source-map preparation requires a staging artifact");
    if (stamp.mode.commit !== candidate || commit !== candidate) {
        throw new Error("staging artifact does not name the pinned engine candidate");
    }
    const extensionNames = new Set<string>();
    for (const slug of slugs) {
        const pkg = (await Bun.file(resolve(examples, slug, "package.json")).json()) as {
            dependencies?: Record<string, string>;
        };
        for (const name of workspaceExtensionDependencies(pkg)) extensionNames.add(name);
    }
    const showcasePrefix = `${relative(checkout, examples).split(sep).join("/")}/`;
    assertPinnedCandidateInputs(
        checkout,
        candidate,
        candidateInputScopes(showcasePrefix, extensionNames),
    );
    if (stamp.buildId !== applicationBuildId(commit)) {
        throw new Error("build stamp version does not match the current site and engine inputs");
    }
    const stale = staleDemos(checkout, outDir, slugs, root);
    if (stale.length > 0)
        throw new Error(`refusing stale source maps: ${stale.map(({ slug }) => slug).join(", ")}`);

    return Object.keys(stamp.demos)
        .sort()
        .map((slug) => {
            const assets = resolve(outDir, slug, "assets");
            const mapFiles = validateSourceMaps(assets);
            return {
                assets,
                plan: sourceMapUploadPlan(slug, "staging", stamp.buildId, mapFiles, hostname),
            };
        });
}

if (import.meta.main) {
    const outDir = process.argv[2] ?? "out/site";
    const hostname = process.argv[3] ?? "shallot-staging.pages.dev";
    for (const { assets, plan } of await prepareSourceMaps(outDir, hostname)) {
        console.log(formatSourceMapUploadCommand(assets, plan));
    }
}
