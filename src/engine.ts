import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** the site repo root */
export const root = resolve(import.meta.dir, "..");

/** the engine checkout `scripts/engine-checkout.ts` clones; showcases build from here */
export const engineRoot = resolve(root, ".engine");

/** the engine tag `engine.json` pins for production builds */
export const engineTag: string = (
    JSON.parse(readFileSync(resolve(root, "engine.json"), "utf8")) as { tag: string }
).tag;

/** the published engine version this site pins in its own `package.json` */
export const engineVersion: string = (
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
    }
).dependencies["@dylanebert/shallot"];

/** the engine package inside the checkout: the repo root, or `packages/shallot` before the hoist */
export function enginePackage(): string {
    const nested = resolve(engineRoot, "packages/shallot");
    return existsSync(resolve(nested, "package.json")) ? nested : engineRoot;
}

/** the checkout's short commit, for page labels and source links */
export function engineRef(): string {
    const ref = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: engineRoot });
    return ref.stdout.toString().trim() || "unknown";
}

/** the exact tag the checkout sits on, or null off a tag */
export function checkoutTag(): string | null {
    const tag = Bun.spawnSync(["git", "describe", "--exact-match", "--tags", "HEAD"], {
        cwd: engineRoot,
    });
    return tag.success ? tag.stdout.toString().trim() : null;
}
