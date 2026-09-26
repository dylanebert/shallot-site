import { resolve } from "node:path";
import { root } from "../src/engine";
import type { PreparedSourceMaps } from "./prepare-sourcemaps";
import { prepareSourceMaps } from "./prepare-sourcemaps";

type Invoke = (args: string[], env: NodeJS.ProcessEnv) => number;

/** The external boundary is unreachable unless this operation was explicitly opted into. */
export function uploadSourceMaps(
    prepared: PreparedSourceMaps[],
    explicitlyOptedIn: boolean,
    invoke: Invoke = (args, env) =>
        Bun.spawnSync(args, { cwd: root, env, stdout: "inherit", stderr: "inherit" }).exitCode,
    env: NodeJS.ProcessEnv = process.env,
): void {
    if (!explicitlyOptedIn) throw new Error("source-map upload requires explicit --upload opt-in");
    if (!env.DD_API_KEY) throw new Error("DD_API_KEY is required for source-map upload");
    for (const { assets, plan } of prepared) {
        const exitCode = invoke(
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
            env,
        );
        if (exitCode !== 0) throw new Error(`Datadog source-map upload failed for ${assets}`);
    }
}

if (import.meta.main) {
    const [optIn, artifactDir, hostname] = process.argv.slice(2);
    if (optIn !== "--upload")
        throw new Error("source-map upload requires explicit --upload opt-in");
    if (!hostname) throw new Error("pass the checked staging Pages hostname");
    const prepared = await prepareSourceMaps(resolve(root, artifactDir ?? "out/site"), hostname);
    uploadSourceMaps(prepared, true);
}
