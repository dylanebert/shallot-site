import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);

if (args.includes("--integration")) {
    const candidate = Bun.spawnSync(["bun", "run", "candidate"], {
        cwd: root,
        stdout: "inherit",
        stderr: "inherit",
    });
    if (candidate.exitCode !== 0) process.exit(candidate.exitCode ?? 1);
}

const test = Bun.spawnSync(["bunx", "shallot", "test", ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
});
process.exit(test.exitCode ?? 1);
