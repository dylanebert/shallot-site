import { resolve } from "node:path";
import { ROSTER } from "../src/roster";
import {
    applicationBuildId,
    formatSourceMapUploadCommand,
    type SourceMapUploadPlan,
    sourceMapUploadPlan,
    validateSourceMaps,
} from "../src/rum-build";
import { root, shallotExamples, shallotVersion } from "../src/site";
import { readStamp, staleDemos } from "../src/site-stamp";

export interface PreparedSourceMaps {
    assets: string;
    plan: SourceMapUploadPlan;
}

export interface SourceMapPreparationContext {
    examplesRoot: string;
    version: string;
    slugs: string[];
}

/** Validate a stamped staging artifact and produce upload plans without external effects. */
export async function prepareSourceMaps(
    artifactDir = resolve(root, "out/site"),
    hostname = "shallot-staging.pages.dev",
    context: Partial<SourceMapPreparationContext> = {},
): Promise<PreparedSourceMaps[]> {
    const examples = context.examplesRoot ?? shallotExamples;
    const version = context.version ?? shallotVersion;
    const slugs = context.slugs ?? ROSTER.map(({ slug }) => slug);
    const outDir = resolve(artifactDir);
    const stamp = readStamp(outDir);
    if (!stamp) throw new Error(`no valid build stamp at ${outDir}`);
    if (stamp.mode.kind !== "staging")
        throw new Error("source-map preparation requires a staging artifact");
    if (stamp.mode.version !== version) {
        throw new Error(`staging artifact uses Shallot ${stamp.mode.version}, expected ${version}`);
    }
    if (stamp.buildId !== applicationBuildId(version)) {
        throw new Error("build stamp does not match the current site inputs and installed package");
    }
    const stale = staleDemos(examples, outDir, slugs, root);
    if (stale.length > 0) {
        throw new Error(`refusing stale source maps: ${stale.map(({ slug }) => slug).join(", ")}`);
    }

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
