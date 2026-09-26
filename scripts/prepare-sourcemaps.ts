import { relative, resolve, sep } from "node:path";
import { engineCandidate, engineCommit, engineExamples, engineRoot, root } from "../src/engine";
import { ROSTER } from "../src/roster";
import { applicationBuildId, sourceMapUploadPlan, validateSourceMaps } from "../src/rum-build";
import { readStamp, staleDemos } from "../src/site-stamp";
import {
    assertPinnedCandidateInputs,
    candidateInputScopes,
    workspaceExtensionDependencies,
} from "./build-site-logic";

const outDir = resolve(root, process.argv[2] ?? "out/site");
const hostname = process.argv[3];
if (!hostname) throw new Error("pass the checked staging Pages hostname as argument 2");
if (!process.env.DD_API_KEY) throw new Error("DD_API_KEY is required for source-map upload");
const stamp = readStamp(outDir);
if (!stamp) throw new Error(`no valid build stamp at ${outDir}`);
if (stamp.mode.kind !== "staging")
    throw new Error("source-map preparation requires a staging artifact");
if (stamp.mode.commit !== engineCandidate || engineCommit() !== engineCandidate) {
    throw new Error("staging artifact does not name the pinned engine candidate");
}
const extensionNames = new Set<string>();
for (const { slug } of ROSTER) {
    const pkg = (await Bun.file(resolve(engineExamples(), slug, "package.json")).json()) as {
        dependencies?: Record<string, string>;
    };
    for (const name of workspaceExtensionDependencies(pkg)) extensionNames.add(name);
}
const showcasePrefix = `${relative(engineRoot, engineExamples()).split(sep).join("/")}/`;
assertPinnedCandidateInputs(
    engineRoot,
    engineCandidate,
    candidateInputScopes(showcasePrefix, extensionNames),
);
if (stamp.buildId !== applicationBuildId(engineCommit())) {
    throw new Error("build stamp version does not match the current site and engine inputs");
}
const stale = staleDemos(
    engineRoot,
    outDir,
    ROSTER.map(({ slug }) => slug),
    root,
);
if (stale.length > 0)
    throw new Error(`refusing stale source maps: ${stale.map(({ slug }) => slug).join(", ")}`);

for (const slug of Object.keys(stamp.demos).sort()) {
    const assets = resolve(outDir, slug, "assets");
    const mapFiles = validateSourceMaps(assets);
    const plan = sourceMapUploadPlan(slug, "staging", stamp.buildId, mapFiles, hostname);
    const result = Bun.spawnSync(
        [
            "bunx",
            "--no-install",
            "datadog-ci",
            "sourcemaps",
            "upload",
            assets,
            "--service",
            plan.service,
            "--release-version",
            plan.version,
            "--minified-path-prefix",
            plan.minifiedPathPrefix,
        ],
        { cwd: root, env: process.env, stdout: "inherit", stderr: "inherit" },
    );
    if (result.exitCode !== 0) throw new Error(`Datadog source-map upload failed for ${slug}`);
}
