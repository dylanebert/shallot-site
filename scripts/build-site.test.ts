import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { llmsTxt, siteIndex } from "../src/home";
import { ROSTER } from "../src/roster";
import { root, shallotPackage, shallotVersion } from "../src/site";

test("the demo roster is exactly the installed package's addable examples", () => {
    const result = Bun.spawnSync(
        [process.execPath, resolve(shallotPackage, "bin/shallot.ts"), "add"],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).toBe(0);
    const listed = [...result.stdout.toString().matchAll(/^ {2}([a-z0-9-]+) — /gm)].map(
        ([, slug]) => slug,
    );
    expect(ROSTER.map(({ slug }) => slug)).toEqual(listed);
}, 20000);

test("site labels and source links identify the installed Shallot version", () => {
    const index = siteIndex(ROSTER, shallotVersion, "staging");
    const docs = llmsTxt(shallotVersion);
    expect(index).toContain(`/tree/v${shallotVersion}/examples/first-person`);
    expect(index).toContain(`/releases/tag/v${shallotVersion}`);
    expect(index).not.toContain("/commit/");
    expect(docs).toContain(`/shallot/v${shallotVersion}/README.md`);
});

test("shallot add writes the installed Shallot version into an ejected example manifest", () => {
    const temp = mkdtempSync(join(tmpdir(), "shallot-site-add-"));
    const slug = ROSTER[0]!.slug;
    const destination = join(temp, slug);
    try {
        const result = Bun.spawnSync(
            [process.execPath, resolve(shallotPackage, "bin/shallot.ts"), "add", slug, destination],
            { cwd: root, stdout: "pipe", stderr: "pipe" },
        );
        expect(result.exitCode).toBe(0);
        const manifest = JSON.parse(readFileSync(join(destination, "package.json"), "utf8")) as {
            dependencies: Record<string, string>;
        };
        expect(manifest.dependencies["@dylanebert/shallot"]).toBe(shallotVersion);
        expect(realpathSync(shallotPackage)).toBe(
            realpathSync(resolve(root, "node_modules/@dylanebert/shallot")),
        );
        expect(readFileSync(join(destination, "index.html"), "utf8")).toContain("<title>");
    } finally {
        rmSync(temp, { recursive: true, force: true });
    }
}, 20000);
