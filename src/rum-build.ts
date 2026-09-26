import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Glob } from "bun";
import { root } from "./engine";
import { RUM_CONFIG } from "./rum-config";

const SITE_BUILD_INPUTS = [
    "package.json",
    "bun.lock",
    "engine.json",
    "scripts/build-site.ts",
    "scripts/build-pages.ts",
    "scripts/build-site-logic.ts",
    "src/home.ts",
    "src/roster.ts",
    "src/brand/client.ts",
    "src/brand/page.ts",
    "src/brand/theme.ts",
    "src/brand/png.ts",
    "src/rum-build.ts",
    "src/rum-config.ts",
    "src/rum-runtime.ts",
    "src/rum-sampler.ts",
    "src/rum-loaf.ts",
    "src/rum-compile-vitals.ts",
    "src/site-stamp.ts",
];

/** Immutable service version from the checked-out engine revision and exact site build inputs. */
export function applicationBuildId(engineCommit: string, siteRoot = root): string {
    const hash = new Bun.CryptoHasher("sha256");
    hash.update(`shallot-site-rum-build-v1\0${engineCommit}\0`);
    for (const path of SITE_BUILD_INPUTS) {
        const full = resolve(siteRoot, path);
        if (!existsSync(full)) throw new Error(`missing application build input: ${path}`);
        hash.update(`\0${path}\0`);
        hash.update(readFileSync(full));
    }
    return hash.digest("hex");
}

export function validateSourceMaps(assetDir: string): string[] {
    const maps = [...new Glob("**/*.js.map").scanSync({ cwd: assetDir })].sort();
    if (maps.length === 0) throw new Error(`no JavaScript source maps found under ${assetDir}`);
    for (const mapPath of maps) {
        const bundlePath = mapPath.slice(0, -4);
        if (!existsSync(resolve(assetDir, bundlePath))) {
            throw new Error(`source map has no matching bundle: ${mapPath}`);
        }
        const parsed = JSON.parse(readFileSync(resolve(assetDir, mapPath), "utf8")) as {
            sourcesContent?: unknown[];
        };
        if (!parsed.sourcesContent?.some((source) => typeof source === "string")) {
            throw new Error(`source map has no sourcesContent: ${mapPath}`);
        }
    }
    return maps;
}

export interface SourceMapUploadPlan {
    service: string;
    version: string;
    minifiedPathPrefix: string;
    mapFiles: string[];
}

/** Pure upload preparation. No credentials, network or uploader invocation is involved. */
export function formatSourceMapUploadCommand(assetsDir: string, plan: SourceMapUploadPlan): string {
    return [
        "datadog-ci sourcemaps upload",
        JSON.stringify(assetsDir),
        "--service",
        JSON.stringify(plan.service),
        "--release-version",
        JSON.stringify(plan.version),
        "--minified-path-prefix",
        JSON.stringify(plan.minifiedPathPrefix),
    ].join(" ");
}

export function sourceMapUploadPlan(
    slug: string,
    mode: "prod" | "staging",
    buildId: string,
    mapFiles: string[],
    stagingHostname = "shallot-staging.pages.dev",
): SourceMapUploadPlan {
    if (mode === "staging" && !/^[a-z0-9-]+\.pages\.dev$/.test(stagingHostname)) {
        throw new Error(`invalid staging Pages hostname: ${stagingHostname}`);
    }
    const base = mode === "prod" ? "https://dylanebert.com/shallot" : `https://${stagingHostname}`;
    return {
        service: RUM_CONFIG.service,
        version: buildId,
        minifiedPathPrefix: `${base}/${slug}/assets/`,
        mapFiles: [...mapFiles].sort(),
    };
}
