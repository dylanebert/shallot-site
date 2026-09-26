import { resolve } from "node:path";
import { engineCommit, engineRoot, root } from "../src/engine";
import { ROSTER } from "../src/roster";
import {
    applicationBuildId,
    formatSourceMapUploadCommand,
    sourceMapUploadPlan,
    validateSourceMaps,
} from "../src/rum-build";
import { readStamp, staleDemos } from "../src/site-stamp";

const outDir = resolve(root, process.argv[2] ?? "out/site");
const stamp = readStamp(outDir);
if (!stamp) throw new Error(`no valid build stamp at ${outDir}`);
if (stamp.mode.kind !== "staging")
    throw new Error("source-map preparation requires a staging artifact");
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
    const plan = sourceMapUploadPlan(slug, "staging", stamp.buildId, mapFiles);
    console.log(formatSourceMapUploadCommand(assets, plan));
}
