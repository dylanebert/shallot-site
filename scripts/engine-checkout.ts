import { existsSync, rmSync } from "node:fs";
import { engineRoot, engineTag } from "../src/engine";

// `bun run engine [--ref <ref>]` — clones dylanebert/shallot into `.engine/` at the tag
// `engine.json` pins (production) or at `--ref` (staging uses `main`). The showcases and any
// workspace extensions build from this checkout; docs and the CLI come from the npm package.

const REPO = "https://github.com/dylanebert/shallot";

const args = process.argv.slice(2);
const idx = args.indexOf("--ref");
const ref = idx !== -1 ? args[idx + 1] : engineTag;
if (!ref) {
    console.error("--ref needs a value");
    process.exit(2);
}

rmSync(engineRoot, { recursive: true, force: true });
const clone = Bun.spawnSync(
    ["git", "clone", "--quiet", "--depth", "1", "--branch", ref, REPO, engineRoot],
    { stdout: "inherit", stderr: "inherit" },
);
if (clone.exitCode !== 0 || !existsSync(engineRoot)) {
    console.error(`✗ could not clone ${REPO} at ${ref}`);
    process.exit(1);
}
console.log(`engine: ${REPO} at ${ref} → ${engineRoot}`);
