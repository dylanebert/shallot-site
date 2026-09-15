import { existsSync, rmSync } from "node:fs";
import { engineCandidate, engineRoot, engineTag } from "../src/engine";

// `bun run engine` enters the stable release used by deployment. `bun run engine --candidate`
// enters the qualified full-SHA source used by unreleased carrier and demo proof. No moving ref or
// host checkout can silently become the site's engine identity.

const REPO = "https://github.com/dylanebert/shallot";

const args = process.argv.slice(2);
const candidate = args.includes("--candidate");
const ref = candidate ? engineCandidate : engineTag;
const unsupported = args.filter((arg) => arg !== "--candidate");
if (unsupported.length > 0 || args.filter((arg) => arg === "--candidate").length > 1) {
    console.error("usage: bun run engine [--candidate]");
    process.exit(2);
}

rmSync(engineRoot, { recursive: true, force: true });
const clone = Bun.spawnSync(["git", "clone", "--quiet", "--depth", "1", REPO, engineRoot], {
    stdout: "inherit",
    stderr: "inherit",
});
if (clone.exitCode !== 0 || !existsSync(engineRoot)) {
    console.error(`✗ could not clone ${REPO}`);
    process.exit(1);
}
const fetchRef = ref.startsWith("v") ? `refs/tags/${ref}:refs/tags/${ref}` : ref;
const pin = Bun.spawnSync(["git", "fetch", "--quiet", "--depth", "1", "origin", fetchRef], {
    cwd: engineRoot,
    stdout: "inherit",
    stderr: "inherit",
});
const checkoutRef = ref.startsWith("v") ? `refs/tags/${ref}` : ref;
const checkout =
    pin.exitCode === 0
        ? Bun.spawnSync(["git", "checkout", "--quiet", checkoutRef], {
              cwd: engineRoot,
              stdout: "inherit",
              stderr: "inherit",
          })
        : pin;
if (checkout.exitCode !== 0) {
    console.error(`✗ could not enter ${REPO} at immutable ref ${ref}`);
    process.exit(1);
}
console.log(`engine: ${REPO} at ${ref} → ${engineRoot}`);
