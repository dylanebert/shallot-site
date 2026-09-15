import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** the site repo root */
export const root = resolve(import.meta.dir, "..");

/** the engine checkout `scripts/engine-checkout.ts` clones; showcases build from here */
export const engineRoot = resolve(root, ".engine");

/** The engine identities owned by this site: stable release for deployment, qualified source
 * candidate for unreleased carrier and demo proof. */
const engineConfig = JSON.parse(readFileSync(resolve(root, "engine.json"), "utf8")) as {
    tag: string;
    release: string;
    candidate: string;
};

/** the engine tag `engine.json` pins for production builds */
export const engineTag = engineConfig.tag;

/** the qualified full-SHA source candidate used for unreleased proof */
export const engineCandidate = engineConfig.candidate;

/** the stable published engine version written into production ejected demos */
export const engineVersion: string = engineConfig.release;

/** the engine package inside the checkout: the repo root, or `packages/shallot` before the hoist */
export function enginePackage(): string {
    const nested = resolve(engineRoot, "packages/shallot");
    return existsSync(resolve(nested, "package.json")) ? nested : engineRoot;
}

/** The engine's demo root. Candidate 0.10 flattened `examples/showcase/` to `examples/`; the
 * site keeps the stable release layout and candidate layout under one explicit identity check. */
export function engineExamples(): string {
    const showcase = resolve(engineRoot, "examples/showcase");
    return existsSync(showcase) ? showcase : resolve(engineRoot, "examples");
}

/** the checkout's short commit, for page labels and source links */
export function engineRef(): string {
    const ref = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: engineRoot });
    return ref.stdout.toString().trim() || "unknown";
}

/** the checkout's complete commit, for candidate identity checks */
export function engineCommit(): string {
    const ref = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: engineRoot });
    return ref.stdout.toString().trim() || "unknown";
}

/** the exact tag the checkout sits on, or null off a tag */
export function checkoutTag(): string | null {
    const tag = Bun.spawnSync(["git", "describe", "--exact-match", "--tags", "HEAD"], {
        cwd: engineRoot,
    });
    return tag.success ? tag.stdout.toString().trim() : null;
}
