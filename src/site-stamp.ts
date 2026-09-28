import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { ShallotIdentity } from "./site";

/** The stamp lives at the root of the output dir, next to `index.html`. */
export const STAMP_FILE = "build-stamp.json";

/** Which site mode produced the artifact and the installed Shallot version it used. */
export interface SiteMode {
    kind: "prod" | "staging";
    version: string;
}

function isSiteMode(value: unknown): value is SiteMode {
    if (typeof value !== "object" || value === null) return false;
    const mode = value as Record<string, unknown>;
    return (mode.kind === "prod" || mode.kind === "staging") && typeof mode.version === "string";
}

export interface SiteStamp {
    recipe: 2;
    buildId: string;
    mode: SiteMode;
    demos: Record<string, string>;
    shallot: Record<string, ShallotIdentity>;
}

const RECIPE: SiteStamp["recipe"] = 2;

function isShallotIdentity(value: unknown): value is ShallotIdentity {
    if (typeof value !== "object" || value === null) return false;
    const identity = value as Record<string, unknown>;
    return (
        typeof identity.version === "string" &&
        typeof identity.contentHash === "string" &&
        /^[a-f0-9]{64}$/.test(identity.contentHash)
    );
}

function isShallotIdentityMap(value: unknown): value is Record<string, ShallotIdentity> {
    return (
        typeof value === "object" && value !== null && Object.values(value).every(isShallotIdentity)
    );
}

const BUILDER_FILES = [
    "package.json",
    "bun.lock",
    "scripts/build-site.ts",
    "scripts/build-pages.ts",
    "src/home.ts",
    "src/roster.ts",
    "src/site.ts",
    "src/site-stamp.ts",
    "src/rum-build.ts",
    "src/rum-config.ts",
    "src/rum-runtime.ts",
    "src/rum-sampler.ts",
    "src/rum-loaf.ts",
    "src/rum-compile-vitals.ts",
    "scripts/demos.ts",
    "node_modules/@dylanebert/shallot/package.json",
    "node_modules/@dylanebert/shallot/bin/shallot.ts",
    "node_modules/@dylanebert/shallot/src/cli/add.ts",
    "node_modules/@dylanebert/shallot/src/cli/add-fragments.ts",
];

function filesUnder(rootDir: string): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if ([".git", "node_modules", "dist", "build", "target"].includes(entry.name)) continue;
            const full = resolve(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) files.push(full);
        }
    };
    if (existsSync(rootDir)) walk(rootDir);
    return files.sort();
}

function hashFile(hasher: Bun.CryptoHasher, base: string, path: string): void {
    const full = resolve(base, path);
    hasher.update(`\0${path}\0`);
    hasher.update(existsSync(full) ? readFileSync(full) : "missing");
}

/** Fingerprints each example's source and the shared builder inputs that affect its output. */
export function demoFingerprints(
    examplesRoot: string,
    slugs: string[],
    builderRoot: string,
): Record<string, string> {
    const shared = new Bun.CryptoHasher("sha256");
    shared.update(`recipe:${RECIPE}\0`);
    for (const path of BUILDER_FILES) hashFile(shared, builderRoot, path);
    const sharedDigest = shared.digest("hex");

    const out: Record<string, string> = {};
    for (const slug of slugs) {
        const directory = resolve(examplesRoot, slug);
        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(`${sharedDigest}\0${slug}\0`);
        for (const full of filesUnder(directory)) {
            const path = full
                .slice(examplesRoot.length + 1)
                .split(sep)
                .join("/");
            hashFile(hasher, examplesRoot, path);
        }
        out[slug] = hasher.digest("hex").slice(0, 32);
    }
    return out;
}

export function readStamp(outDirPath: string): SiteStamp | null {
    const path = resolve(outDirPath, STAMP_FILE);
    if (!existsSync(path)) return null;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SiteStamp>;
        if (
            parsed.recipe !== RECIPE ||
            typeof parsed.buildId !== "string" ||
            typeof parsed.demos !== "object" ||
            parsed.demos === null ||
            !isSiteMode(parsed.mode) ||
            !isShallotIdentityMap(parsed.shallot)
        ) {
            return null;
        }
        return {
            recipe: RECIPE,
            buildId: parsed.buildId,
            mode: parsed.mode,
            demos: parsed.demos as Record<string, string>,
            shallot: parsed.shallot,
        };
    } catch {
        return null;
    }
}

export interface StaleDemo {
    slug: string;
    reason: string;
}

/** Demo slots built from a different Shallot tree than the site currently resolves. */
export function mismatchedShallotDemos(
    stamp: SiteStamp,
    outDirPath: string,
    slugs: string[],
    resolved: ShallotIdentity,
): string[] {
    return slugs.flatMap((slug) => {
        if (!existsSync(resolve(outDirPath, slug))) return [];
        const built = stamp.shallot[slug];
        if (!built) return [`${slug}: no Shallot identity in build stamp`];
        if (built.version !== resolved.version || built.contentHash !== resolved.contentHash) {
            return [
                `${slug}: built with Shallot ${built.version} sha256:${built.contentHash}, site resolves ${resolved.version} sha256:${resolved.contentHash}`,
            ];
        }
        return [];
    });
}

export function staleDemos(
    examplesRoot: string,
    outDirPath: string,
    slugs: string[],
    builderRoot: string,
): StaleDemo[] {
    const present = slugs.filter((slug) => existsSync(resolve(outDirPath, slug)));
    if (present.length === 0) return [];
    const stamp = readStamp(outDirPath);
    if (!stamp) {
        return present.map((slug) => ({
            slug,
            reason: `no readable ${STAMP_FILE}`,
        }));
    }
    const current = demoFingerprints(examplesRoot, present, builderRoot);
    const stale: StaleDemo[] = [];
    for (const slug of present) {
        const built = stamp.demos[slug];
        if (!built) {
            stale.push({ slug, reason: "no stamp entry" });
        } else if (built !== current[slug]) {
            stale.push({ slug, reason: `built from ${built}, current sources ${current[slug]}` });
        }
    }
    return stale;
}

export function writeStamp(
    outDirPath: string,
    entries: Record<string, string>,
    mode: SiteMode,
    buildId: string,
    shallot: ShallotIdentity,
): void {
    const prior = readStamp(outDirPath);
    const stamp: SiteStamp = {
        recipe: RECIPE,
        buildId,
        mode,
        demos: { ...(prior?.demos ?? {}), ...entries },
        shallot: {
            ...(prior?.shallot ?? {}),
            ...Object.fromEntries(Object.keys(entries).map((slug) => [slug, shallot])),
        },
    };
    writeFileSync(resolve(outDirPath, STAMP_FILE), `${JSON.stringify(stamp, null, 4)}\n`);
}
